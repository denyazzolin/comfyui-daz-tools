from . import workflow_config_base  # registers shared /daz/workflow-config* routes
from . import prompt_stack_base  # registers shared /daz/prompt-stack* routes
from .check_null import CheckNullNode
from .null_audio_checker import NullAudioChecker
from .abs_int import AbsInt
from .lora_inspector import LoraInspector
from .markdown_display import MarkdownDisplay
from .workflow_config_wan22 import WorkflowConfigWan22
from .workflow_config_ltx23 import WorkflowConfigLtx23
from .workflow_config_image import WorkflowConfigImage
from .prompt_stack_manager import PromptStackManager
from .prompt_stack_splitter import PromptStackSplitter
from .sound_mixer import SoundMixer

NODE_CLASS_MAPPINGS = {
    "CheckNull": CheckNullNode,
    "NullAudioChecker": NullAudioChecker,
    "AbsInt": AbsInt,
    "LoraInspector": LoraInspector,
    "MarkdownDisplay": MarkdownDisplay,
    "WorkflowConfigWan22": WorkflowConfigWan22,
    "WorkflowConfigLtx23": WorkflowConfigLtx23,
    "WorkflowConfigImage": WorkflowConfigImage,
    "PromptStackManager": PromptStackManager,
    "PromptStackSplitter": PromptStackSplitter,
    "daz_sound_mixer": SoundMixer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CheckNull": "Check Null",
    "NullAudioChecker": "Null Audio Checker",
    "AbsInt": "Abs Int",
    "LoraInspector": "Lora Inspector",
    "MarkdownDisplay": "Markdown Display",
    "WorkflowConfigWan22": "Workflow Config WAN2.2",
    "WorkflowConfigLtx23": "Workflow Config LTX2.3",
    "WorkflowConfigImage": "Workflow Config Image",
    "PromptStackManager": "Prompt Stack Manager",
    "PromptStackSplitter": "Prompt Stack Splitter",
    "daz_sound_mixer": "Sound Mixer",
}
