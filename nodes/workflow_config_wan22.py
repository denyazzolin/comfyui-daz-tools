import os
import json
from datetime import datetime

import folder_paths

try:
    from server import PromptServer
    from aiohttp import web
    _SERVER_AVAILABLE = True
except Exception:
    _SERVER_AVAILABLE = False

try:
    import comfy.sd
except Exception:
    pass

try:
    from PIL import Image
    import numpy as np
    import torch
except Exception:
    pass

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


def _make_label(name: str, created_at: str) -> str:
    try:
        dt = datetime.fromisoformat(created_at)
        return f"{name} ({dt.strftime('%m/%d/%y %H:%M')})"
    except Exception:
        return name


def _wan22_labels() -> list[str]:
    """Return dropdown labels for all Wan2.2 configs, format: 'Name (mm/dd/yy hh:mm)'."""
    configs = _load_configs()
    return [
        _make_label(name, entry.get("created_at", ""))
        for name, entry in configs.items()
        if entry.get("class") == _CLASS
    ]


def _label_to_name(label: str) -> str | None:
    """Reverse a label back to its config key by matching against the live config file."""
    configs = _load_configs()
    for name, entry in configs.items():
        if entry.get("class") == _CLASS and _make_label(name, entry.get("created_at", "")) == label:
            return name
    return None


def _load_unet(name: str):
    path = folder_paths.get_full_path("diffusion_models", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: diffusion model '{name}' not found")
    return comfy.sd.load_diffusion_model(path)


def _load_vae(name: str):
    path = folder_paths.get_full_path("vae", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: VAE '{name}' not found")
    return comfy.sd.VAE(ckpt_path=path)


def _load_clip(name: str):
    path = folder_paths.get_full_path("text_encoders", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: text encoder '{name}' not found")
    embedding_dirs = folder_paths.get_folder_paths("embeddings")
    return comfy.sd.load_clip(
        ckpt_paths=[path],
        embedding_directory=embedding_dirs,
        clip_type=comfy.sd.CLIPType.WAN,
    )


def _load_image(path: str):
    if not path:
        raise ValueError("[DAZ TOOLS] WorkflowConfigWan22: image_path is empty")
    if not os.path.exists(path):
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: image not found at '{path}'")
    img = Image.open(path).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]  # [1, H, W, 3]


if _SERVER_AVAILABLE:
    @PromptServer.instance.routes.get("/daz/workflow-configs-wan22")
    async def _daz_workflow_configs_wan22(request):
        return web.json_response(_wan22_labels())


class WorkflowConfigWan22:
    @classmethod
    def INPUT_TYPES(cls):
        labels = _wan22_labels()
        return {
            "required": {
                "config": (labels if labels else [_NO_CONFIGS],),
            }
        }

    RETURN_TYPES = (
        "MODEL", "MODEL",
        "VAE",
        "CLIP",
        "IMAGE",
        "INT", "INT", "INT", "INT",
    )
    RETURN_NAMES = (
        "unet_high", "unet_low",
        "vae",
        "clip",
        "image",
        "width", "height", "steps", "split_step",
    )
    FUNCTION    = "load_config"
    CATEGORY    = "utils"
    OUTPUT_NODE = False

    def load_config(self, config: str):
        name = _label_to_name(config)
        if name is None:
            raise ValueError(
                f"[DAZ TOOLS] WorkflowConfigWan22: '{config}' not found in {_CONFIG_FILE}"
            )

        configs = _load_configs()
        entry   = configs[name]

        return (
            _load_unet(entry.get("unet_high",  "")),
            _load_unet(entry.get("unet_low",   "")),
            _load_vae( entry.get("vae",        "")),
            _load_clip(entry.get("clip",       "")),
            _load_image(entry.get("image_path", "")),
            int(entry.get("width",      0)),
            int(entry.get("height",     0)),
            int(entry.get("steps",      0)),
            int(entry.get("split_step", 0)),
        )
