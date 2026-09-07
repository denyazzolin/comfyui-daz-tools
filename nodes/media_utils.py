"""
Video frame decoding for the WorkflowConfig extended media block.

video_utils probes a file (fps, duration, frame count) without touching pixels;
this decodes an actual window of frames out of one into a ComfyUI IMAGE batch.
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


def decode_video_frames(full_path: str, error_prefix: str, start_frame: int = 0,
                        cap_frames: int = 0):
    """Decode a window of a video into (IMAGE batch, fps, frame count).

    start_frame is 1-based and 0 means the same as 1, and cap_frames is how many
    to take from there, with 0 meaning "to the end of the clip" — the pair the
    handles under the editor's video preview set. The fps returned is the file's
    own. The frames are an [N, H, W, 3] float32 tensor in 0..1, the same layout
    every other image output in the plugin uses.
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

    # Built in three deliberate steps rather than as one expression. Written as
    # np.stack(frames).astype(np.float32) / 255.0, four copies of the clip are
    # alive at the peak - the per-frame list, the stacked uint8, the float32 the
    # conversion makes and the second float32 the divide makes - roughly twice
    # the batch that survives, on top of a window that may already be at the
    # ceiling. Releasing each one as soon as it is spent, and scaling in place,
    # holds the peak to the float32 batch plus the uint8 it was converted from.
    count = len(frames)
    batch = np.stack(frames)
    frames.clear()
    batch = batch.astype(np.float32)
    batch /= 255.0
    return torch.from_numpy(batch), fps, count
