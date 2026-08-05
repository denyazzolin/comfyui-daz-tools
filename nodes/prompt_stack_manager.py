import hashlib
import json

from .prompt_stack_base import (
    load_stacks, stack_labels, all_sequences, all_prompt_labels, make_label,
    _get_active_sequence, _normalize_prompt, MAX_PROMPTS, EXTERNAL_PROMPT_LABEL,
)

_NO_STACKS = "(no prompt stacks)"


class PromptStackManager:
    @classmethod
    def INPUT_TYPES(cls):
        labels    = stack_labels()
        sequences = all_sequences()
        prompts   = all_prompt_labels()
        return {
            "required": {
                "fps":         ("FLOAT", {"default": 0.0, "min": 0.0, "max": 240.0, "step": 0.1}),
                "frame_count": ("INT", {"default": 0, "min": 0, "max": 100000}),
                "stack":       (labels if labels else [_NO_STACKS],),
                "sequence":    (sequences,),
                "prompt":      (prompts,),
            },
            "optional": {
                "external_prompt":          ("STRING", {"forceInput": True}),
                "external_negative_prompt": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("DX_PROMPT_SET",) * (MAX_PROMPTS + 1)
    RETURN_NAMES = ("selected_prompt",) + tuple(f"prompt_seq_{i}" for i in range(1, MAX_PROMPTS + 1))
    FUNCTION     = "load_stack"
    CATEGORY     = "utils"
    OUTPUT_NODE  = False

    @classmethod
    def VALIDATE_INPUTS(cls, stack: str, sequence: str):
        if stack not in set(stack_labels()):
            return f"Value not in list: stack: '{stack}' not in valid options"
        return True

    @classmethod
    def IS_CHANGED(cls, stack: str, sequence: str, fps: float, frame_count: int):
        stacks = load_stacks()
        name = next(
            (n for n, e in stacks.items() if make_label(n, e.get("created_at", "")) == stack),
            None,
        )
        if name is None:
            return stack
        active = _get_active_sequence(stacks[name], sequence)
        fingerprint = json.dumps(active.get("prompts", []), sort_keys=True)
        return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()

    def load_stack(self, stack: str, sequence: str, prompt: str, fps: float, frame_count: int,
                    external_prompt: str = None, external_negative_prompt: str = None):
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

        raw = str(prompt or "").split(" - ")[0].strip()
        if raw == EXTERNAL_PROMPT_LABEL:
            text = str(external_prompt) if external_prompt is not None else ""
            if not text.strip():
                raise ValueError(
                    f"[DAZ TOOLS] PromptStackManager: '{EXTERNAL_PROMPT_LABEL}' is selected "
                    "but the external_prompt input is empty or not connected."
                )
            neg_text = str(external_negative_prompt) if external_negative_prompt is not None else ""
            selected = _normalize_prompt({
                "label":           EXTERNAL_PROMPT_LABEL,
                "positive_prompt": {"text": text, "type": "simple"},
                "negative_prompt": {"text": neg_text},
            })
            selected["fps"]         = fps
            selected["frame_count"] = frame_count
        else:
            selected_idx = None
            if raw != "All" and raw.isdigit():
                idx = int(raw) - 1
                if 0 <= idx < len(prompts):
                    selected_idx = idx
            selected = prompts[selected_idx] if selected_idx is not None else (prompts[0] if prompts else None)

        return (selected,) + tuple(prompts[i] if i < len(prompts) else None for i in range(MAX_PROMPTS))
