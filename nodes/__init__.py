from . import workflow_config_base  # registers shared /daz/workflow-config* routes
from .check_null import CheckNullNode
from .null_audio_checker import NullAudioChecker
from .abs_int import AbsInt
from .lora_inspector import LoraInspector
from .markdown_display import MarkdownDisplay
from .workflow_config_wan22 import WorkflowConfigWan22
from .workflow_config_ltx23 import WorkflowConfigLtx23

NODE_CLASS_MAPPINGS = {
    "CheckNull": CheckNullNode,
    "NullAudioChecker": NullAudioChecker,
    "AbsInt": AbsInt,
    "LoraInspector": LoraInspector,
    "MarkdownDisplay": MarkdownDisplay,
    "WorkflowConfigWan22": WorkflowConfigWan22,
    "WorkflowConfigLtx23": WorkflowConfigLtx23,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CheckNull": "Check Null",
    "NullAudioChecker": "Null Audio Checker",
    "AbsInt": "Abs Int",
    "LoraInspector": "Lora Inspector",
    "MarkdownDisplay": "Markdown Display",
    "WorkflowConfigWan22": "Workflow Config WAN2.2",
    "WorkflowConfigLtx23": "Workflow Config LTX2.3",
}
