import os

import folder_paths
from .workflow_config_base import load_configs, labels_for_class, make_label, CONFIG_FILE, load_checkpoint

try:
    import comfy.sd
    import comfy.utils
except Exception:
    pass

try:
    from PIL import Image
    import numpy as np
    import torch
except Exception:
    pass

_CLASS      = "ltx2.3"
_NO_CONFIGS = "(no configs)"


def _load_unet(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("diffusion_models", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigLtx23: diffusion model '{name}' not found")
    return comfy.sd.load_diffusion_model(path)


def _load_vae(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("vae", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigLtx23: VAE '{name}' not found")
    sd = comfy.utils.load_torch_file(path)
    return comfy.sd.VAE(sd=sd)


def _load_clip(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("text_encoders", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigLtx23: text encoder '{name}' not found")
    return comfy.sd.load_clip(
        ckpt_paths=[path],
        embedding_directory=folder_paths.get_folder_paths("embeddings"),
        clip_type=comfy.sd.CLIPType.LTXV,
    )


def _load_image(path: str):
    if not path:
        return None
    if os.path.isabs(path):
        full = path
    else:
        full = os.path.join(folder_paths.get_input_directory(), path)
    if not os.path.exists(full):
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigLtx23: image not found at '{full}'")
    img = Image.open(full).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _load_lora(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("loras", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigLtx23: lora '{name}' not found")
    return comfy.utils.load_torch_file(path, safe_load=True)


class WorkflowConfigLtx23:
    @classmethod
    def INPUT_TYPES(cls):
        labels = labels_for_class(_CLASS)
        return {
            "required": {
                "config": (labels if labels else [_NO_CONFIGS],),
            }
        }

    RETURN_TYPES = (
        "MODEL", "VAE", "CLIP",
        "MODEL",
        "VAE", "VAE",
        "CLIP", "CLIP",
        "IMAGE",
        "INT", "INT", "INT", "INT",
        "STRING", "STRING", "STRING",
        "FLOAT",
        "INT",
        "FLOAT",
        "LORA", "LORA", "LORA", "LORA", "LORA", "LORA",
        "STRING",
    )
    RETURN_NAMES = (
        "checkpoint_model", "checkpoint_vae", "checkpoint_clip",
        "transformer_only",
        "video_vae", "audio_vae",
        "clip_2", "clip",
        "image",
        "width", "height", "steps", "seed",
        "master_prompt", "positive_prompt", "negative_prompt",
        "cfg",
        "total_frames",
        "fps",
        "distillation_lora", "lora_2", "lora_3", "lora_4", "lora_5", "lora_6",
        "filename",
    )
    FUNCTION    = "load_config"
    CATEGORY    = "utils"
    OUTPUT_NODE = False

    def load_config(self, config: str):
        configs = load_configs()
        name = next(
            (n for n, e in configs.items()
             if e.get("class") == _CLASS and make_label(n, e.get("created_at", "")) == config),
            None,
        )
        if name is None:
            raise ValueError(
                f"[DAZ TOOLS] WorkflowConfigLtx23: '{config}' not found in {CONFIG_FILE}"
            )
        entry = configs[name]

        ckpt_model, ckpt_clip, ckpt_vae = load_checkpoint(entry.get("checkpoint", ""))

        return (
            ckpt_model,
            ckpt_vae,
            ckpt_clip,
            _load_unet(entry.get("unet_high",  "")),
            _load_vae( entry.get("vae",         "")),
            _load_vae( entry.get("audio_vae",   "")),
            _load_clip(entry.get("clip_2",      "")),
            _load_clip(entry.get("clip",        "")),
            _load_image(entry.get("image_path", "")),
            int(entry.get("width",        0)),
            int(entry.get("height",       0)),
            int(entry.get("steps",        0)),
            int(entry.get("seed",         0)),
            str(entry.get("master_prompt",   "")),
            str(entry.get("positive_prompt", "")),
            str(entry.get("negative_prompt", "")),
            float(entry.get("cfg_high",   0.0)),
            int(entry.get("total_frames", 0)),
            float(entry.get("fps",        0.0)),
            _load_lora(entry.get("lora_1", "")),
            _load_lora(entry.get("lora_2", "")),
            _load_lora(entry.get("lora_3", "")),
            _load_lora(entry.get("lora_4", "")),
            _load_lora(entry.get("lora_5", "")),
            _load_lora(entry.get("lora_6", "")),
            str(entry.get("filename", "")),
        )
