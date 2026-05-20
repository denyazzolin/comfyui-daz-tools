class MarkdownDisplay:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "markdown": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "display"
    CATEGORY = "utils"
    OUTPUT_NODE = True

    def display(self, markdown: str):
        return {"ui": {"markdown": [markdown]}}
