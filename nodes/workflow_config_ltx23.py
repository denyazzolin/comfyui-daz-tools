import os
import random

import folder_paths
from .workflow_config_base import (
    load_configs, labels_for_class, make_label, CONFIG_FILE, load_checkpoint, scan_config_files,
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

_CLASS        = "ltx2.3"
_NO_CONFIGS   = "(no configs)"
_FILE_DEFAULT = "(default)"


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
    sd, metadata = comfy.utils.load_torch_file(path, return_metadata=True)
    return comfy.sd.VAE(sd=sd, metadata=metadata)


def _load_audio_vae(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("vae", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigLtx23: audio VAE '{name}' not found")
    sd, metadata = comfy.utils.load_torch_file(path, return_metadata=True)
    return comfy.sd.VAE(sd=sd, metadata=metadata)


def _load_dual_clip(name1: str, name2: str):
    paths = []
    for name in (name1, name2):
        if name:
            path = folder_paths.get_full_path("text_encoders", name)
            if not path:
                raise ValueError(f"[DAZ TOOLS] WorkflowConfigLtx23: text encoder '{name}' not found")
            paths.append(path)
    if not paths:
        return None
    return comfy.sd.load_clip(
        ckpt_paths=paths,
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
    if model is None:
        return None
    result = model
    for sd, strength in lora_pairs:
        if sd is None:
            continue
        result, _ = comfy.sd.load_lora_for_models(result, None, sd, strength, strength)
    return result



class WorkflowConfigLtx23:
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
        "MODEL", "VAE", "CLIP",
        "MODEL",
        "VAE", "VAE",
        "CLIP",
        "IMAGE",
        "INT", "INT", "INT", "INT",
        "STRING", "STRING", "STRING",
        "INT",
        "FLOAT",
        "INT",
        "FLOAT",
        "LORA", "LORA", "LORA", "LORA", "LORA", "LORA",
        "STRING",
        "MODEL", "MODEL",
    )
    RETURN_NAMES = (
        "checkpoint_model", "checkpoint_vae", "checkpoint_clip",
        "transformer_only",
        "video_vae", "audio_vae",
        "dual_clip",
        "image",
        "width", "height", "steps", "seed",
        "master_prmt", "pos_prompt", "neg_prompt",
        "prompt_type",
        "cfg",
        "total_frames",
        "fps",
        "distillation_lora", "lora_2", "lora_3", "lora_4", "lora_5", "lora_6",
        "filename",
        "transformer_stack", "checkpoint_stack",
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
                f"[DAZ TOOLS] WorkflowConfigLtx23: '{config}' not found"
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
                print(f"[DAZ TOOLS] WorkflowConfigLtx23: could not save random seed — {e}")

        ckpt_name = _get_name(entry.get("checkpoint"))
        unet_name = _get_name(entry.get("unet_high"))
        vae_name  = _get_name(entry.get("vae"))
        avae_name = _get_name(entry.get("audio_vae"))

        try:
            ckpt_model, ckpt_clip, ckpt_vae = load_checkpoint(ckpt_name)
        except Exception as e:
            raise RuntimeError(f"[DAZ TOOLS] LTX2.3: checkpoint load failed ('{ckpt_name}'): {e}") from e
        try:
            unet = _load_unet(unet_name)
        except Exception as e:
            raise RuntimeError(f"[DAZ TOOLS] LTX2.3: transformer load failed ('{unet_name}'): {e}") from e
        try:
            video_vae = _load_vae(vae_name)
        except Exception as e:
            raise RuntimeError(f"[DAZ TOOLS] LTX2.3: video VAE load failed ('{vae_name}'): {e}") from e
        try:
            audio_vae = _load_audio_vae(avae_name)
        except Exception as e:
            raise RuntimeError(f"[DAZ TOOLS] LTX2.3: audio VAE load failed ('{avae_name}'): {e}") from e

        lora_1_sd, lora_1_w = _process_lora(loras.get("lora_1", ""))
        lora_2_sd, lora_2_w = _process_lora(loras.get("lora_2", ""))
        lora_3_sd, lora_3_w = _process_lora(loras.get("lora_3", ""))
        lora_4_sd, lora_4_w = _process_lora(loras.get("lora_4", ""))
        lora_5_sd, lora_5_w = _process_lora(loras.get("lora_5", ""))
        lora_6_sd, lora_6_w = _process_lora(loras.get("lora_6", ""))

        lora_pairs = [
            (lora_1_sd, lora_1_w), (lora_2_sd, lora_2_w),
            (lora_3_sd, lora_3_w), (lora_4_sd, lora_4_w),
            (lora_5_sd, lora_5_w), (lora_6_sd, lora_6_w),
        ]

        return (
            ckpt_model,
            ckpt_vae,
            ckpt_clip,
            unet,
            video_vae,
            audio_vae,
            _load_dual_clip(_get_name(entry.get("clip_2")), _get_name(entry.get("clip"))),
            _load_image(_get_path(entry.get("image_path"))),
            _get_int(entry.get("width")),
            _get_int(entry.get("height")),
            _get_int(entry.get("steps")),
            seed_val,
            _get_text(entry.get("master_prompt")),
            _get_text(entry.get("positive_prompt")),
            _get_text(entry.get("negative_prompt")),
            _get_prompt_type_int(entry.get("positive_prompt")),
            _get_float(entry.get("cfg_high")),
            _get_int(entry.get("total_frames")),
            _get_float(entry.get("fps")),
            lora_1_sd, lora_2_sd, lora_3_sd, lora_4_sd, lora_5_sd, lora_6_sd,
            _get_file(entry.get("filename")),
            _apply_loras(unet,       lora_pairs),
            _apply_loras(ckpt_model, lora_pairs),
        )
