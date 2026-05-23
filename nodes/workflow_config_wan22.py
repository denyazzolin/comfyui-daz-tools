import os
import json

_NODES_DIR         = os.path.dirname(os.path.abspath(__file__))
_PLUGIN_DIR        = os.path.dirname(_NODES_DIR)
_CUSTOM_NODES_ROOT = os.path.dirname(_PLUGIN_DIR)
_CONFIG_FILE       = os.path.join(_CUSTOM_NODES_ROOT, "dx_workflow_configs.json")

_CLASS      = "Wan2.2"
_NO_CONFIGS = "(no configs)"
_missing_warned = False


def _load_configs() -> dict:
    global _missing_warned
    if not os.path.exists(_CONFIG_FILE):
        if not _missing_warned:
            print(f"[DAZ TOOLS] WorkflowConfigWan22: config file not found at {_CONFIG_FILE}")
            _missing_warned = True
        return {}
    try:
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[DAZ TOOLS] WorkflowConfigWan22: could not read config file — {e}")
        return {}


class WorkflowConfigWan22:
    @classmethod
    def INPUT_TYPES(cls):
        configs = _load_configs()
        names = [
            name for name, entry in configs.items()
            if entry.get("class") == _CLASS
        ]
        return {
            "required": {
                "config": (names if names else [_NO_CONFIGS],),
            }
        }

    RETURN_TYPES = (
        "STRING", "STRING", "STRING",
        "STRING", "STRING", "STRING", "STRING", "STRING",
        "INT",    "INT",    "INT",    "INT",
    )
    RETURN_NAMES = (
        "config_name", "config_class", "created_at",
        "unet_high", "unet_low", "vae", "clip", "image_path",
        "width", "height", "steps", "split_step",
    )
    FUNCTION    = "load_config"
    CATEGORY    = "utils"
    OUTPUT_NODE = False

    def load_config(self, config: str):
        configs = _load_configs()
        entry   = configs.get(config)
        if not entry:
            raise ValueError(
                f"[DAZ TOOLS] WorkflowConfigWan22: '{config}' not found in {_CONFIG_FILE}"
            )

        return (
            config,
            _CLASS,
            str(entry.get("created_at",  "")),
            str(entry.get("unet_high",   "")),
            str(entry.get("unet_low",    "")),
            str(entry.get("vae",         "")),
            str(entry.get("clip",        "")),
            str(entry.get("image_path",  "")),
            int(entry.get("width",       0)),
            int(entry.get("height",      0)),
            int(entry.get("steps",       0)),
            int(entry.get("split_step",  0)),
        )
