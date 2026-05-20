class NullAudioChecker:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
            },
        }

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("is_empty",)
    FUNCTION = "check"
    CATEGORY = "audio"
    DESCRIPTION = "Returns True if the audio has no samples (video had no audio track)."

    def check(self, audio):
        try:
            waveform = audio["waveform"]
            return (waveform.shape[-1] == 0,)
        except Exception:
            return (True,)
