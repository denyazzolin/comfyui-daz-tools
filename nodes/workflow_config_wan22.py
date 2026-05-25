import os

import folder_paths
from .workflow_config_base import load_configs, labels_for_class, make_label, CONFIG_FILE

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

_CLASS      = "Wan2.2"
_NO_CONFIGS = "(no configs)"


def _load_unet(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("diffusion_models", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: diffusion model '{name}' not found")
    return comfy.sd.load_diffusion_model(path)


def _load_vae(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("vae", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: VAE '{name}' not found")
    sd = comfy.utils.load_torch_file(path)
    return comfy.sd.VAE(sd=sd)


def _load_clip(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("text_encoders", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: text encoder '{name}' not found")
    return comfy.sd.load_clip(
        ckpt_paths=[path],
        embedding_directory=folder_paths.get_folder_paths("embeddings"),
        clip_type=comfy.sd.CLIPType.WAN,
    )


def _load_image(path: str):
    if not path:
        return None
    if os.path.isabs(path):
        full = path
    else:
        # Relative filename → resolve against ComfyUI input folder
        full = os.path.join(folder_paths.get_input_directory(), path)
    if not os.path.exists(full):
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: image not found at '{full}'")
    img = Image.open(full).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]  # [1, H, W, 3]


def _load_lora(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("loras", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: lora '{name}' not found")
    return comfy.utils.load_torch_file(path, safe_load=True)


def _apply_loras(model, lora_sds, strength=1.0):
    if model is None:
        return None
    result = model
    for sd in lora_sds:
        if sd is None:
            continue
        result, _ = comfy.sd.load_lora_for_models(result, None, sd, strength, strength)
    return result


class WorkflowConfigWan22:
    @classmethod
    def INPUT_TYPES(cls):
        labels = labels_for_class(_CLASS)
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
        "INT", "INT", "INT", "INT", "INT",
        "STRING", "STRING", "STRING",
        "FLOAT", "FLOAT", "INT",
        "FLOAT",
        "LORA", "LORA", "LORA", "LORA", "LORA", "LORA", "LORA", "LORA",
        "STRING",
        "MODEL", "MODEL",
    )
    RETURN_NAMES = (
        "unet_high", "unet_low",
        "vae",
        "clip",
        "image",
        "width", "height", "steps", "split_step", "seed",
        "master_prmt", "pos_prompt", "neg_prompt",
        "cfg_high", "cfg_low", "total_frames",
        "fps",
        "lora_1_high", "lora_1_low",
        "lora_2_high", "lora_2_low",
        "lora_3_high", "lora_3_low",
        "lora_4_high", "lora_4_low",
        "filename",
        "unet_stack_high", "unet_stack_low",
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
                f"[DAZ TOOLS] WorkflowConfigWan22: '{config}' not found in {CONFIG_FILE}"
            )
        entry = configs[name]

        unet_high = _load_unet(entry.get("unet_high", ""))
        unet_low  = _load_unet(entry.get("unet_low",  ""))

        lora_1 = _load_lora(entry.get("lora_1", ""))
        lora_2 = _load_lora(entry.get("lora_2", ""))
        lora_3 = _load_lora(entry.get("lora_3", ""))
        lora_4 = _load_lora(entry.get("lora_4", ""))
        lora_5 = _load_lora(entry.get("lora_5", ""))
        lora_6 = _load_lora(entry.get("lora_6", ""))
        lora_7 = _load_lora(entry.get("lora_7", ""))
        lora_8 = _load_lora(entry.get("lora_8", ""))

        return (
            unet_high,
            unet_low,
            _load_vae( entry.get("vae",        "")),
            _load_clip(entry.get("clip",       "")),
            _load_image(entry.get("image_path", "")),
            int(entry.get("width",      0)),
            int(entry.get("height",     0)),
            int(entry.get("steps",      0)),
            int(entry.get("split_step", 0)),
            int(entry.get("seed",       0)),
            str(entry.get("master_prompt",   "")),
            str(entry.get("positive_prompt", "")),
            str(entry.get("negative_prompt", "")),
            float(entry.get("cfg_high",  0.0)),
            float(entry.get("cfg_low",   0.0)),
            int(entry.get("total_frames", 0)),
            float(entry.get("fps", 0.0)),
            lora_1, lora_2,
            lora_3, lora_4,
            lora_5, lora_6,
            lora_7, lora_8,
            str(entry.get("filename", "")),
            _apply_loras(unet_high, [lora_1, lora_3, lora_5, lora_7]),
            _apply_loras(unet_low,  [lora_2, lora_4, lora_6, lora_8]),
        )
