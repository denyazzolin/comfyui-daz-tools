from .prompt_stack_base import (
    load_stacks, stack_labels, all_sequences, make_label,
    _get_active_sequence, _normalize_prompt, MAX_PROMPTS,
)

_NO_STACKS = "(no prompt stacks)"


class PromptStackManager:
    @classmethod
    def INPUT_TYPES(cls):
        labels    = stack_labels()
        sequences = all_sequences()
        return {
            "required": {
                "fps":         ("FLOAT", {"default": 0.0, "min": 0.0, "max": 240.0, "step": 0.1}),
                "frame_count": ("INT", {"default": 0, "min": 0, "max": 100000}),
                "stack":       (labels if labels else [_NO_STACKS],),
                "sequence":    (sequences,),
            }
        }

    RETURN_TYPES = ("DX_PROMPT_SET",) * MAX_PROMPTS
    RETURN_NAMES = tuple(f"prompt_seq_{i}" for i in range(1, MAX_PROMPTS + 1))
    FUNCTION     = "load_stack"
    CATEGORY     = "utils"
    OUTPUT_NODE  = False

    @classmethod
    def VALIDATE_INPUTS(cls, stack: str, sequence: str):
        if stack not in set(stack_labels()):
            return f"Value not in list: stack: '{stack}' not in valid options"
        return True

    def load_stack(self, stack: str, sequence: str, fps: float, frame_count: int):
        stacks = load_stacks()
        name = next(
            (n for n, e in stacks.items() if make_label(n, e.get("created_at", "")) == stack),
            None,
        )
        if name is None:
            raise ValueError(f"[DAZ TOOLS] PromptStackManager: '{stack}' not found")

        entry   = stacks[name]
        active  = _get_active_sequence(entry, sequence)
        prompts = [_normalize_prompt(p) for p in active.get("prompts", [])][:MAX_PROMPTS]
        for p in prompts:
            p["fps"]         = fps
            p["frame_count"] = frame_count

        return tuple(prompts[i] if i < len(prompts) else None for i in range(MAX_PROMPTS))
