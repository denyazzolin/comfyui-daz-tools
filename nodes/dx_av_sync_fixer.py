from .workflow_config_base import _fit_audio_to_video
from .workflow_config_minimaxh3 import _AUDIO_GRID as _H3_AUDIO_GRID

# What the audio is fitted to, by the class it is going to be encoded for. A
# grid is the class's own (audio latent rate, video rate), taken from its
# WorkflowConfig node so the two never disagree; None fits to the clip's
# duration at the fps given, which is what the other classes' nodes do.
_TARGETS = {
    "Wan2.2 / LTX2.3 / LTX2.5 (video duration)": None,
    f"MiniMax H3 ({_H3_AUDIO_GRID[0]} Hz audio tokens)": _H3_AUDIO_GRID,
}


class AVSyncFixer:
    """Fit an audio track to a batch of frames, the fix the WorkflowConfig nodes
    apply to audio taken off a video slot, for frames and audio that come from
    any other loader.

    The frames are handed on untouched. The audio is padded with silence or cut
    at its tail to exactly the length the frames call for — never resampled, so
    what is kept stays where it was.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "audio":  ("AUDIO",),
                # A batch of frames carries no rate of its own, so it is asked
                # for: the loader's own fps output is what goes here.
                "fps":    ("FLOAT", {"default": 24.0, "min": 0.01, "max": 240.0, "step": 0.001}),
                "target": (list(_TARGETS), {"default": next(iter(_TARGETS))}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO")
    RETURN_NAMES = ("images", "audio")
    FUNCTION     = "fix"
    CATEGORY     = "utils"

    def fix(self, images, audio, fps, target):
        if images is None or not hasattr(images, "shape"):
            raise ValueError("[DAZ TOOLS] AV Sync Fixer: no frames came in on images")
        if not isinstance(audio, dict) or audio.get("waveform") is None or "sample_rate" not in audio:
            raise ValueError("[DAZ TOOLS] AV Sync Fixer: no audio came in — "
                             "the loader wired to audio handed on nothing")
        # A copy, so the fit never reaches back into the loader's own output —
        # the fit replaces the waveform rather than writing into it.
        fixed = dict(audio)
        have  = fixed["waveform"].shape[-1]
        _fit_audio_to_video(fixed, (int(images.shape[0]), float(fps), "input"),
                            _TARGETS.get(target), "AV Sync Fixer")
        if fixed["waveform"].shape[-1] == have:
            print(f"[DAZ TOOLS] AV Sync Fixer: already in sync — "
                  f"{int(images.shape[0])} frames, {have} samples")
        return (images, fixed)
