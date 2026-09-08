"""Shared PyAV-based video file probing (fps/duration/frame count/size/audio).

Used by the Sound Mixer's movie panel to compute exact per-frame timestamps
for its scrubber. No frame images are extracted server-side — the browser's
own <video> element handles seeking/display once it has the real fps.
"""


def probe_video_file(full_path: str, error_prefix: str) -> dict:
    import av

    with av.open(full_path) as vf:
        if not vf.streams.video:
            raise ValueError(f"[DAZ TOOLS] {error_prefix}: no video stream in '{full_path}'")
        stream = vf.streams.video[0]

        fps = float(stream.average_rate) if stream.average_rate else 0.0

        if stream.duration is not None and stream.time_base is not None:
            duration = float(stream.duration * stream.time_base)
        elif vf.duration is not None:
            # Container-level duration is in AV_TIME_BASE units (microseconds),
            # a fixed FFmpeg constant — not `av.time_base`, which isn't a
            # reliable top-level attribute across PyAV versions.
            duration = vf.duration / 1_000_000
        else:
            duration = 0.0

        frame_count = stream.frames or (round(duration * fps) if fps > 0 else 0)
        # Coded size, which is what a decoded frame comes out as. Read off
        # the codec context, which is None for a stream PyAV has no decoder for
        # — and the rate and duration above come from the container either way,
        # so an unknown size reports 0 rather than failing the whole probe.
        cc     = stream.codec_context
        width  = int(getattr(cc, "width",  0) or 0)
        height = int(getattr(cc, "height", 0) or 0)

        # Whether the file has a track an audio slot could be pointed at. Read
        # here rather than in a probe of its own: the container is already open,
        # and the stream list costs nothing beyond the look.
        has_audio = bool(vf.streams.audio)

    if fps <= 0 or duration <= 0:
        raise ValueError(f"[DAZ TOOLS] {error_prefix}: could not determine fps/duration for '{full_path}'")

    return {"fps": fps, "duration": duration, "frame_count": max(1, int(frame_count)),
            "width": width, "height": height, "has_audio": has_audio}
