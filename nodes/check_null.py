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
