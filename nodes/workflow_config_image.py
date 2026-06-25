import os
import random

import folder_paths
from .workflow_config_base import (
    load_configs, labels_for_class, make_label, CONFIG_FILE, load_checkpoint, scan_config_files,
    all_versions_for_class,
    _get_name, _get_text, _get_file, _get_int, _get_float,
    _get_seed_randomize, _get_flag_value, _get_custom_value,
    _get_active_set,
    _resolve_path, _load_file, _write_file,
)

try:
    import comfy.sd
    import comfy.utils
except Exception:
    pass

_CLASS        = "ImageInference"
_NO_CONFIGS   = "(no configs)"
_FILE_DEFAULT = "(default)"


def _load_unet(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("diffusion_models", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigImage: diffusion model '{name}' not found")
    return comfy.sd.load_diffusion_model(path)


def _load_vae(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("vae", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigImage: VAE '{name}' not found")
    sd, metadata = comfy.utils.load_torch_file(path, return_metadata=True)
    return comfy.sd.VAE(sd=sd, metadata=metadata)


def _load_clip(name: str, clip_type: str = "stable_diffusion"):
    if not name:
        return None
    path = folder_paths.get_full_path("text_encoders", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigImage: text encoder '{name}' not found")
    ct = getattr(comfy.sd.CLIPType, clip_type.upper(), comfy.sd.CLIPType.STABLE_DIFFUSION)
    return comfy.sd.load_clip(
        ckpt_paths=[path],
        embedding_directory=folder_paths.get_folder_paths("embeddings"),
        clip_type=ct,
    )


class WorkflowConfigImage:
    @classmethod
    def INPUT_TYPES(cls):
        files       = scan_config_files(_CLASS)
        file_labels = [f"({os.path.splitext(f['file'])[0]}) {f['name']}" for f in files] if files else [_FILE_DEFAULT]
        if files and _FILE_DEFAULT not in file_labels:
            file_labels = file_labels + [_FILE_DEFAULT]

        seen, all_labels = set(), []
        for f in files:
            for lbl in labels_for_class(_CLASS, file=f["file"]):
                if lbl not in seen:
                    seen.add(lbl); all_labels.append(lbl)
        for lbl in labels_for_class(_CLASS, file=None):
            if lbl not in seen:
                seen.add(lbl); all_labels.append(lbl)

        all_versions = all_versions_for_class(_CLASS)

        return {
            "required": {
                "movie":  (file_labels,),
                "scene":  (all_labels if all_labels else [_NO_CONFIGS],),
                "take":   (all_versions,),
            }
        }

    RETURN_TYPES = (
        "MODEL",
        "MODEL", "VAE", "CLIP",
        "VAE",
        "CLIP",
        "INT", "INT", "INT", "INT",
        "FLOAT",
        "STRING", "STRING", "STRING",
        "BOOLEAN",
        "STRING",
        "BOOLEAN", "BOOLEAN", "BOOLEAN",
        "STRING", "STRING",
    )
    RETURN_NAMES = (
        "diffuser",
        "checkpoint_model", "checkpoint_vae", "checkpoint_clip",
        "vae",
        "clip",
        "width", "height", "steps", "seed",
        "cfg",
        "master_prmt", "pos_prompt", "neg_prompt",
        "is_relay_prompt",
        "filename",
        "flag_1", "flag_2", "flag_3",
        "custom_1", "custom_2",
    )
    FUNCTION    = "load_config"
    CATEGORY    = "utils"
    OUTPUT_NODE = False

    @classmethod
    def IS_CHANGED(cls, movie: str, scene: str, take: str):
        file = None if movie == _FILE_DEFAULT else movie[1:movie.index(')')] + '.json'
        try:
            path = _resolve_path(file)
            configs, _, _ = _load_file(path)
            name = next(
                (n for n, e in configs.items()
                 if e.get("class") == _CLASS and make_label(n, e.get("created_at", "")) == scene),
                None,
            )
            if name is not None:
                active_set = _get_active_set(configs[name], take)
                if _get_seed_randomize(active_set.get("seed", {})):
                    return float("NaN")
        except Exception:
            pass
        return scene

    def load_config(self, movie: str, scene: str, take: str):
        file = None if movie == _FILE_DEFAULT else movie[1:movie.index(')')] + '.json'
        path = _resolve_path(file)
        configs, meta_extra, effective = _load_file(path)
        name = next(
            (n for n, e in configs.items()
             if e.get("class") == _CLASS and make_label(n, e.get("created_at", "")) == scene),
            None,
        )
        if name is None:
            raise ValueError(f"[DAZ TOOLS] WorkflowConfigImage: '{scene}' not found")
        entry      = configs[name]
        active_set = _get_active_set(entry, take)

        seed_obj = active_set.get("seed", {"value": 0})
        seed_val = _get_int(seed_obj)
        if _get_seed_randomize(seed_obj):
            seed_val = random.randint(1, 2**31 - 1)
            sets = entry.get("sets", [])
            raw_take = str(take).split(" - ")[0].strip()
            for i, s in enumerate(sets):
                if str(s.get("version", "")) == raw_take:
                    sets[i]["seed"] = {**(seed_obj if isinstance(seed_obj, dict) else {}), "value": seed_val}
                    break
            else:
                if sets:
                    sets[-1]["seed"] = {**(seed_obj if isinstance(seed_obj, dict) else {}), "value": seed_val}
            try:
                _write_file(path, configs, meta_extra, effective)
            except Exception as e:
                print(f"[DAZ TOOLS] WorkflowConfigImage: could not save random seed — {e}")

        pos_prompt_val = active_set.get("positive_prompt")
        prompt_type    = pos_prompt_val.get("type", "smart") if isinstance(pos_prompt_val, dict) else "smart"
        master_text    = _get_text(active_set.get("master_prompt"))
        pos_text       = _get_text(pos_prompt_val)
        is_relay       = prompt_type == "smart"
        pos_out        = pos_text if is_relay else "\n\n".join(p for p in (master_text, pos_text) if p)

        ckpt_name = _get_name(active_set.get("checkpoint"))
        unet_name = _get_name(active_set.get("unet_high"))
        vae_name  = _get_name(active_set.get("vae"))

        try:
            ckpt_model, ckpt_clip, ckpt_vae = load_checkpoint(ckpt_name)
        except Exception as e:
            raise RuntimeError(f"[DAZ TOOLS] ImageInference: checkpoint load failed ('{ckpt_name}'): {e}") from e
        try:
            unet = _load_unet(unet_name)
        except Exception as e:
            raise RuntimeError(f"[DAZ TOOLS] ImageInference: diffuser load failed ('{unet_name}'): {e}") from e
        try:
            vae = _load_vae(vae_name)
        except Exception as e:
            raise RuntimeError(f"[DAZ TOOLS] ImageInference: VAE load failed ('{vae_name}'): {e}") from e
        clip_type_str = active_set.get("clip_type", "stable_diffusion") or "stable_diffusion"
        try:
            clip = _load_clip(_get_name(active_set.get("clip")), clip_type_str)
        except Exception as e:
            raise RuntimeError(f"[DAZ TOOLS] ImageInference: CLIP load failed: {e}") from e

        return (
            unet,
            ckpt_model,
            ckpt_vae,
            ckpt_clip,
            vae,
            clip,
            _get_int(active_set.get("width")),
            _get_int(active_set.get("height")),
            _get_int(active_set.get("steps")),
            seed_val,
            _get_float(active_set.get("cfg_high")),
            master_text,
            pos_out,
            _get_text(active_set.get("negative_prompt")),
            is_relay,
            _get_file(active_set.get("filename")),
            _get_flag_value(active_set.get("flags", {}).get("flag_1")),
            _get_flag_value(active_set.get("flags", {}).get("flag_2")),
            _get_flag_value(active_set.get("flags", {}).get("flag_3")),
            _get_custom_value(active_set.get("custom", {}).get("param_1")),
            _get_custom_value(active_set.get("custom", {}).get("param_2")),
        )
