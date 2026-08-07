"""Shared PyAV-based audio file decoding.

Used by the WorkflowConfig nodes (which resolve a path from a JSON config
field) and the Sound Mixer (which resolves a path via folder_paths' annotated
filename convention) — each keeps its own path-resolution rules, but they all
decode the same way once they have a real file path.
"""
import torch


def decode_audio_file(full_path: str, error_prefix: str) -> dict:
    """Decode the audio file at `full_path` into a ComfyUI AUDIO dict
    ({"waveform": [1, C, T], "sample_rate": int}) via PyAV."""
    import av
    with av.open(full_path) as af:
        if not af.streams.audio:
            raise ValueError(f"[DAZ TOOLS] {error_prefix}: no audio stream in '{full_path}'")
        stream = af.streams.audio[0]
        sr = stream.codec_context.sample_rate
        n_channels = stream.channels
        frames = []
        for frame in af.decode(streams=stream.index):
            buf = torch.from_numpy(frame.to_ndarray())
            if buf.shape[0] != n_channels:
                buf = buf.view(-1, n_channels).t()
            frames.append(buf)
        if not frames:
            raise ValueError(f"[DAZ TOOLS] {error_prefix}: no audio frames in '{full_path}'")
        wav = torch.cat(frames, dim=1)
        if not wav.dtype.is_floating_point:
            wav = wav.float() / (2 ** 15 if wav.dtype == torch.int16 else 2 ** 31)
    return {"waveform": wav.unsqueeze(0), "sample_rate": sr}
