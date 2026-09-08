"""
Video frame decoding for the WorkflowConfig extended media block.

video_utils probes a file (fps, duration, frame count) without touching pixels;
this decodes an actual window of frames out of one into a ComfyUI IMAGE batch,
optionally scaling it as it goes.
Both use PyAV, imported lazily so this module stays importable without it.
"""
import os

# Decoded frames are float32 RGB — 12 bytes per pixel — so a frame count on its
# own bounds nothing: 600 frames is ~6.6 GB at 720p and ~60 GB at 4K. The byte
# budget is what actually keeps a run alive; the frame ceiling is the number a
# person thinks in. Whichever is reached first stops the decode, and the console
# says which one it was.
MAX_VIDEO_FRAMES        = 600
MAX_VIDEO_DECODED_BYTES = 4 * 1024 ** 3

# How much of a clip is converted to float32 at a time when it is being
# scaled. This is the only part of the window that exists at its source
# resolution once the conversion starts, so it is the figure that decides how
# much a downscale actually saves. Small enough not to matter beside the batch
# that survives, large enough that a 4K frame still goes through in company.
MAX_SCALE_CHUNK_BYTES   = 256 * 1024 ** 2


def decode_video_frames(full_path: str, error_prefix: str, start_frame: int = 0,
                        cap_frames: int = 0, scale=None):
    """Decode a window of a video into (IMAGE batch, fps, frame count).

    start_frame is 1-based and 0 means the same as 1, and cap_frames is how many
    to take from there, with 0 meaning "to the end of the clip" — the pair the
    handles under the editor's video preview set. The fps returned is the file's
    own. The frames are an [N, H, W, 3] float32 tensor in 0..1, the same layout
    every other image output in the plugin uses.

    scale, if given, is applied to the frames on their way out — an
    [n, H, W, 3] batch in, the scaled batch back. It is taken as a callable
    rather than a size so this module keeps knowing nothing about the take's
    dimensions rule; the caller passes the rule it has already worked out. It is
    called on each chunk in turn rather than on the whole window, which is what
    keeps the clip from ever existing whole at its source resolution — so it
    must scale each frame on its own, as a resize filter does, and not read
    across the batch.

    The ceilings above are measured on the source frame either way. What comes
    back is bounded by the window they allow, not by what scale leaves of it.
    """
    try:
        import av
    except ImportError as e:
        raise ValueError(f"[DAZ TOOLS] {error_prefix}: PyAV is required to read video files ({e})")
    import numpy as np
    import torch

    if not os.path.exists(full_path):
        raise ValueError(f"[DAZ TOOLS] {error_prefix}: video not found at '{full_path}'")

    start_index = max(0, int(start_frame or 0) - 1)

    try:
        container = av.open(full_path)
    except Exception as e:
        raise ValueError(f"[DAZ TOOLS] {error_prefix}: could not open '{full_path}' ({e})")

    with container:
        if not container.streams.video:
            raise ValueError(f"[DAZ TOOLS] {error_prefix}: '{full_path}' has no video stream")
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        fps = float(stream.average_rate) if stream.average_rate else 0.0

        # The requested window, in frames, 0 standing for "to the end of the
        # clip" — the ceilings below are what bounds the window then.
        wanted = max(0, int(cap_frames or 0))

        frames, limit, capped_by = [], None, ""
        for index, frame in enumerate(container.decode(stream)):
            if index < start_index:
                continue
            arr = frame.to_ndarray(format="rgb24")
            if limit is None:
                # The first frame is what tells us how much a frame costs, so the
                # ceilings can only be worked out once decoding has begun.
                per_frame = max(1, arr.shape[0] * arr.shape[1] * 3 * 4)
                by_bytes  = max(1, int(MAX_VIDEO_DECODED_BYTES // per_frame))
                ceiling   = min(MAX_VIDEO_FRAMES, by_bytes)
                limit     = ceiling if wanted == 0 else min(wanted, ceiling)
                if limit == ceiling and (wanted == 0 or wanted > ceiling):
                    capped_by = ("the %d frame ceiling" % MAX_VIDEO_FRAMES
                                 if ceiling == MAX_VIDEO_FRAMES
                                 else "the %.1f GB decoded-size ceiling"
                                      % (MAX_VIDEO_DECODED_BYTES / 1024 ** 3))
            frames.append(arr)
            if len(frames) >= limit:
                break

    if not frames:
        raise ValueError(f"[DAZ TOOLS] {error_prefix}: no frames decoded from '{full_path}' "
                         f"(start_frame {start_frame} may be past the end of the clip)")

    if capped_by and len(frames) >= limit:
        print(f"[DAZ TOOLS] {error_prefix}: stopped at {len(frames)} frames — hit {capped_by}")

    # Converted a chunk at a time, straight into the batch that is returned.
    # Done whole - np.stack(frames).astype(np.float32) / 255.0 - four copies of
    # the clip are alive at the peak: the per-frame list, the stacked uint8, the
    # float32 the conversion makes and the second float32 the divide makes.
    # Scaling afterwards then adds a fifth, the source-resolution float32 being
    # held while the scaled copy is built, and at 4K that copy is tens of
    # gigabytes that no output ever sees. Going a chunk at a time, and releasing
    # each one as it is spent, holds the source-resolution cost to the uint8
    # frames still waiting plus the chunk in hand. An unscaled decode is left
    # costing what it did before: the same conversion, in pieces.
    #
    # The list is decoded in full first, so the frame count is known before any
    # float32 exists and the batch can be allocated once, at its final size.
    # Growing it by concatenation instead would hold the finished clip twice.
    count     = len(frames)
    per_frame = max(1, frames[0].shape[0] * frames[0].shape[1] * 3 * 4)
    step      = max(1, int(MAX_SCALE_CHUNK_BYTES // per_frame))
    batch, at = None, 0
    for first in range(0, count, step):
        last  = min(first + step, count)
        chunk = np.stack(frames[first:last])
        # Dropped as they are consumed, so the uint8 list shrinks as the float32
        # batch fills rather than both being held whole.
        for i in range(first, last):
            frames[i] = None
        chunk = chunk.astype(np.float32)
        chunk /= 255.0
        piece = torch.from_numpy(chunk)
        del chunk
        if scale is not None:
            piece = scale(piece)
        if batch is None:
            # The first scaled chunk is what says how big the result is, so the
            # caller's rule does not have to be asked for a size as well.
            batch = torch.empty((count,) + tuple(piece.shape[1:]), dtype=piece.dtype)
        batch[at:at + piece.shape[0]] = piece
        at += piece.shape[0]
        del piece
    frames.clear()
    return batch, fps, count
