import os
import random

import folder_paths
from .workflow_config_base import (
    load_configs, labels_for_class, make_label, CONFIG_FILE, scan_config_files,
    _get_name, _get_text, _get_path, _get_file, _get_int, _get_float, _get_loras,
    _get_prompt_type_int, _get_seed_randomize,
    _resolve_path, _load_file, _write_file,
)

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

_CLASS       = "Wan2.2"
_NO_CONFIGS  = "(no configs)"
_FILE_DEFAULT = "(default)"


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


def _process_lora(val):
    """Return (state_dict_or_None, strength) from a lora config value (string or object)."""
    if isinstance(val, dict):
        if not val.get("enabled", True):
            return None, 1.0
        name     = val.get("name", "")
        strength = float(val.get("strength", 1.0))
    else:
        name     = val or ""
        strength = 1.0
    return _load_lora(name), strength


def _apply_loras(model, lora_pairs):
    """Apply a list of (state_dict, strength) pairs to the model. None state_dicts are skipped."""
    if model is None:
        return None
    result = model
    for sd, strength in lora_pairs:
        if sd is None:
            continue
        result, _ = comfy.sd.load_lora_for_models(result, None, sd, strength, strength)
    return result


class WorkflowConfigWan22:
    @classmethod
    def INPUT_TYPES(cls):
        files       = scan_config_files(_CLASS)
        file_labels = [f["file"] for f in files] if files else [_FILE_DEFAULT]
        # Always include "(default)" so old saved workflows still pass validation
        if files and _FILE_DEFAULT not in file_labels:
            file_labels = file_labels + [_FILE_DEFAULT]

        # Collect labels from ALL sources (every _mgr/ file + legacy) so any
        # valid selection — including from a renamed or relocated config — passes
        # ComfyUI's combo validation at execution time.
        seen, all_labels = set(), []
        for f in files:
            for lbl in labels_for_class(_CLASS, file=f["file"]):
                if lbl not in seen:
                    seen.add(lbl); all_labels.append(lbl)
        for lbl in labels_for_class(_CLASS, file=None):
            if lbl not in seen:
                seen.add(lbl); all_labels.append(lbl)

        return {
            "required": {
                "config_file": (file_labels,),
                "config":      (all_labels if all_labels else [_NO_CONFIGS],),
            }
        }

    RETURN_TYPES = (
        "MODEL", "MODEL",
        "VAE",
        "CLIP",
        "IMAGE",
        "INT", "INT", "INT", "INT", "INT",
        "STRING", "STRING", "STRING",
        "INT",
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
        "prompt_type",
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

    @classmethod
    def IS_CHANGED(cls, config_file: str, config: str):
        file = None if config_file == _FILE_DEFAULT else config_file
        try:
            path = _resolve_path(file)
            configs, _, _ = _load_file(path)
            name = next(
                (n for n, e in configs.items()
                 if e.get("class") == _CLASS and make_label(n, e.get("created_at", "")) == config),
                None,
            )
            if name is not None and _get_seed_randomize(configs[name].get("seed", {})):
                return float("NaN")
        except Exception:
            pass
        return config

    def load_config(self, config_file: str, config: str):
        file = None if config_file == _FILE_DEFAULT else config_file
        path = _resolve_path(file)
        configs, meta_extra, effective = _load_file(path)
        name = next(
            (n for n, e in configs.items()
             if e.get("class") == _CLASS and make_label(n, e.get("created_at", "")) == config),
            None,
        )
        if name is None:
            raise ValueError(
                f"[DAZ TOOLS] WorkflowConfigWan22: '{config}' not found"
            )
        entry = configs[name]
        loras = _get_loras(entry)

        seed_obj = entry.get("seed", {"value": 0})
        seed_val = _get_int(seed_obj)
        if _get_seed_randomize(seed_obj):
            seed_val = random.randint(1, 2**31 - 1)
            entry["seed"] = {**(seed_obj if isinstance(seed_obj, dict) else {}), "value": seed_val}
            try:
                _write_file(path, configs, meta_extra, effective)
            except Exception as e:
                print(f"[DAZ TOOLS] WorkflowConfigWan22: could not save random seed — {e}")

        unet_high = _load_unet(_get_name(entry.get("unet_high")))
        unet_low  = _load_unet(_get_name(entry.get("unet_low")))

        lora_1_sd, lora_1_w = _process_lora(loras.get("lora_1", ""))
        lora_2_sd, lora_2_w = _process_lora(loras.get("lora_2", ""))
        lora_3_sd, lora_3_w = _process_lora(loras.get("lora_3", ""))
        lora_4_sd, lora_4_w = _process_lora(loras.get("lora_4", ""))
        lora_5_sd, lora_5_w = _process_lora(loras.get("lora_5", ""))
        lora_6_sd, lora_6_w = _process_lora(loras.get("lora_6", ""))
        lora_7_sd, lora_7_w = _process_lora(loras.get("lora_7", ""))
        lora_8_sd, lora_8_w = _process_lora(loras.get("lora_8", ""))

        return (
            unet_high,
            unet_low,
            _load_vae( _get_name(entry.get("vae"))),
            _load_clip(_get_name(entry.get("clip"))),
            _load_image(_get_path(entry.get("image_path"))),
            _get_int(entry.get("width")),
            _get_int(entry.get("height")),
            _get_int(entry.get("steps")),
            _get_int(entry.get("split_step")),
            seed_val,
            _get_text(entry.get("master_prompt")),
            _get_text(entry.get("positive_prompt")),
            _get_text(entry.get("negative_prompt")),
            _get_prompt_type_int(entry.get("positive_prompt")),
            _get_float(entry.get("cfg_high")),
            _get_float(entry.get("cfg_low")),
            _get_int(entry.get("total_frames")),
            _get_float(entry.get("fps")),
            lora_1_sd, lora_2_sd,
            lora_3_sd, lora_4_sd,
            lora_5_sd, lora_6_sd,
            lora_7_sd, lora_8_sd,
            _get_file(entry.get("filename")),
            _apply_loras(unet_high, [
                (lora_1_sd, lora_1_w), (lora_3_sd, lora_3_w),
                (lora_5_sd, lora_5_w), (lora_7_sd, lora_7_w),
            ]),
            _apply_loras(unet_low, [
                (lora_2_sd, lora_2_w), (lora_4_sd, lora_4_w),
                (lora_6_sd, lora_6_w), (lora_8_sd, lora_8_w),
            ]),
        )
