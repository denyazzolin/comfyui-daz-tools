from .workflow_config_base import resolve_prompt_output


class PromptStackSplitter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt_set": ("DX_PROMPT_SET",),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "BOOLEAN", "STRING")
    RETURN_NAMES = ("master_prmt", "pos_prompt", "neg_prompt", "is_relay_prompt", "trail_prmt")
    FUNCTION     = "split"
    CATEGORY     = "utils"
    OUTPUT_NODE  = False

    def split(self, prompt_set):
        if not prompt_set:
            return ("", "", "", False, "")
        return resolve_prompt_output(prompt_set)
