from .check_null import CheckNullNode
from .null_audio_checker import NullAudioChecker
from .abs_int import AbsInt
from .lora_inspector import LoraInspector
from .markdown_display import MarkdownDisplay

NODE_CLASS_MAPPINGS = {
    "CheckNull": CheckNullNode,
    "NullAudioChecker": NullAudioChecker,
    "AbsInt": AbsInt,
    "LoraInspector": LoraInspector,
    "MarkdownDisplay": MarkdownDisplay,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CheckNull": "Check Null",
    "NullAudioChecker": "Null Audio Checker",
    "AbsInt": "Abs Int",
    "LoraInspector": "Lora Inspector",
    "MarkdownDisplay": "Markdown Display",
}
