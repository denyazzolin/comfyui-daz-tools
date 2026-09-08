"""Shared PyAV-based audio file decoding.

Used by the WorkflowConfig nodes (which resolve a path from a JSON config
field) and the Sound Mixer (which resolves a path via folder_paths' annotated
filename convention) — each keeps its own path-resolution rules, but they all
decode the same way once they have a real file path.
"""
import torch


def decode_audio_file(full_path: str, error_prefix: str,
                      start_s: float = 0.0, end_s: float = 0.0) -> dict:
    """Decode the audio file at `full_path` into a ComfyUI AUDIO dict
    ({"waveform": [1, C, T], "sample_rate": int}) via PyAV.

    start_s and end_s bound the window that is kept, in seconds from the start of
    the track, with end 0 meaning "to the end of it" — the pair an audio slot
    taking its track off a video is trimmed by, so it comes out matching the
    window that video's own frames were decoded with. The default pair is the
    whole track, which is what every caller that has no window asks for.

    The window is reached by decoding up to it and keeping only what falls
    inside, rather than by seeking — the same way decode_video_frames counts its
    way to start_frame. It costs the decode of what is skipped, which for audio
    is small, and in exchange the two windows are worked out the same way and
    nothing outside the window is ever held.
    """
    import av
    with av.open(full_path) as af:
        if not af.streams.audio:
            raise ValueError(f"[DAZ TOOLS] {error_prefix}: no audio stream in '{full_path}'")
        stream = af.streams.audio[0]
        sr = stream.codec_context.sample_rate
        n_channels = stream.channels

        # The window in samples: first is the one to start on, last the one to
        # stop before. 0 for last stands for the end of the track, the way
        # cap_frames 0 does for a clip.
        first = max(0, int(round(start_s * sr))) if start_s > 0 else 0
        last  = max(0, int(round(end_s   * sr))) if end_s   > 0 else 0
        if last and last <= first:
            raise ValueError(f"[DAZ TOOLS] {error_prefix}: empty audio window "
                             f"({start_s:.3f}s-{end_s:.3f}s) in '{full_path}'")

        frames, at = [], 0
        for frame in af.decode(streams=stream.index):
            buf = torch.from_numpy(frame.to_ndarray())
            if buf.shape[0] != n_channels:
                buf = buf.view(-1, n_channels).t()
            n = buf.shape[1]
            # Where this frame overlaps the window. A frame wholly before it is
            # dropped without being kept, which is what holds the cost of a late
            # window to the window itself.
            take_from = max(0, first - at)
            take_to   = n if not last else min(n, last - at)
            if take_from < take_to:
                frames.append(buf[:, take_from:take_to])
            at += n
            if last and at >= last:
                break
        if not frames:
            where = (f" between {start_s:.3f}s and {end_s or at / sr:.3f}s"
                     if (first or last) else "")
            raise ValueError(f"[DAZ TOOLS] {error_prefix}: no audio frames"
                             f"{where} in '{full_path}'")
        wav = torch.cat(frames, dim=1)
        if not wav.dtype.is_floating_point:
            wav = wav.float() / (2 ** 15 if wav.dtype == torch.int16 else 2 ** 31)
    return {"waveform": wav.unsqueeze(0), "sample_rate": sr}
