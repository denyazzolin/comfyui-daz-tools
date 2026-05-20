# --- Null Checker ---

_any_type = type("AnyType", (str,), {"__ne__": lambda self, other: True})
ANY = _any_type("*")


class CheckNullNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "value": (ANY,),
            },
        }

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("is_null",)
    FUNCTION = "check_null"
    CATEGORY = "utils"
    OUTPUT_NODE = False

    def check_null(self, value=None):
        is_null = (
            value is None
            or (isinstance(value, float) and value != value)  # NaN
            or (isinstance(value, str) and value.strip().lower() in ("none", "null", ""))
        )
        return (is_null,)


# --- Null Audio Checker ---

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


# --- Abs Int ---

class AbsInt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("INT", {"default": 0, "min": -(2**31 - 1), "max": 2**31 - 1}),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("abs_value",)
    FUNCTION = "calculate"
    CATEGORY = "math"

    def calculate(self, value):
        return (abs(value),)


# --- Mappings ---

NODE_CLASS_MAPPINGS = {
    "CheckNull": CheckNullNode,
    "NullAudioChecker": NullAudioChecker,
    "AbsInt": AbsInt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CheckNull": "Check Null",
    "NullAudioChecker": "Null Audio Checker",
    "AbsInt": "Abs Int",
}
