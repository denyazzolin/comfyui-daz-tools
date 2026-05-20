class AbsInt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("INT", {"default": 0, "min": -(2**31), "max": 2**31 - 1}),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("abs_value",)
    FUNCTION = "calculate"
    CATEGORY = "math"

    def calculate(self, value):
        return (abs(value),)
