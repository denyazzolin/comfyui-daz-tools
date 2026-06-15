import os
import random

import folder_paths
from .workflow_config_base import (
    load_configs, labels_for_class, make_label, CONFIG_FILE, scan_config_files,
    all_versions_for_class,
    _get_name, _get_text, _get_path, _get_file, _get_int, _get_float, _get_loras,
    _get_seed_randomize, _get_flag_value,
    _get_active_set,
    _resolve_path, _load_file, _write_file,
)

try:
    import comfy.sd
    import comfy.utils
    import comfy.model_sampling
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
        full = os.path.join(folder_paths.get_input_directory(), path)
    if not os.path.exists(full):
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: image not found at '{full}'")
    img = Image.open(full).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _load_audio(path: str):
    if not path:
        return None
    if os.path.isabs(path):
        full = path
    else:
        full = os.path.join(folder_paths.get_input_directory(), path)
    if not os.path.exists(full):
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: audio not found at '{full}'")
    import av
    with av.open(full) as af:
        if not af.streams.audio:
            raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: no audio stream in '{full}'")
        stream = af.streams.audio[0]
        sr = stream.codec_context.sample_rate
        n_channels = stream.channels
        frames = []
        for frame in af.decode(streams=stream.index):
            buf = torch.from_numpy(frame.to_ndarray())
            if buf.shape[0] != n_channels:
                buf = buf.view(-1, n_channels).t()
            frames.append(buf)
        if not frames:
            raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: no audio frames in '{full}'")
        wav = torch.cat(frames, dim=1)
        if not wav.dtype.is_floating_point:
            wav = wav.float() / (2 ** 15 if wav.dtype == torch.int16 else 2 ** 31)
    return {"waveform": wav.unsqueeze(0), "sample_rate": sr}


def _load_lora(name: str):
    if not name:
        return None
    path = folder_paths.get_full_path("loras", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfigWan22: lora '{name}' not found")
    return comfy.utils.load_torch_file(path, safe_load=True)


def _process_lora(val):
    if isinstance(val, dict):
        if not val.get("enabled", True):
            return None, 1.0
        name     = val.get("name", "")
        strength = float(val.get("strength", 1.0))
    else:
        name     = val or ""
        strength = 1.0
    return _load_lora(name), strength


def _apply_model_shift(model, shift: float):
    if model is None:
        return None
    m = model.clone()
    sampling_base = comfy.model_sampling.ModelSamplingDiscreteFlow
    sampling_type = comfy.model_sampling.CONST
    class ModelSamplingShifted(sampling_base, sampling_type):
        pass
    model_sampling = ModelSamplingShifted(model.model.model_config)
    model_sampling.set_parameters(shift=shift)
    m.add_object_patch("model_sampling", model_sampling)
    return m


def _apply_loras(model, lora_pairs):
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
                "movie":   (file_labels,),
                "config":  (all_labels if all_labels else [_NO_CONFIGS],),
                "version": (all_versions,),
            }
        }

    RETURN_TYPES = (
        "MODEL", "MODEL",
        "VAE",
        "CLIP",
        "IMAGE",
        "AUDIO",
        "INT", "INT", "INT", "INT", "INT",
        "STRING", "STRING", "STRING",
        "BOOLEAN",
        "FLOAT", "FLOAT", "INT",
        "FLOAT",
        "LORA", "LORA", "LORA", "LORA", "LORA", "LORA", "LORA", "LORA",
        "STRING",
        "MODEL", "MODEL",
        "FLOAT", "FLOAT",
        "BOOLEAN",
        "BOOLEAN", "BOOLEAN", "BOOLEAN",
    )
    RETURN_NAMES = (
        "unet_high", "unet_low",
        "vae",
        "clip",
        "image",
        "audio",
        "width", "height", "steps", "split_step", "seed",
        "master_prmt", "pos_prompt", "neg_prompt",
        "is_relay_prompt",
        "cfg_high", "cfg_low", "total_frames",
        "fps",
        "lora_1_high", "lora_1_low",
        "lora_2_high", "lora_2_low",
        "lora_3_high", "lora_3_low",
        "lora_4_high", "lora_4_low",
        "filename",
        "unet_stack_high", "unet_stack_low",
        "shift_high", "shift_low",
        "is_t2v",
        "flag_1", "flag_2", "flag_3",
    )
    FUNCTION    = "load_config"
    CATEGORY    = "utils"
    OUTPUT_NODE = False

    @classmethod
    def IS_CHANGED(cls, movie: str, config: str, version: str):
        file = None if movie == _FILE_DEFAULT else movie[1:movie.index(')')] + '.json'
        try:
            path = _resolve_path(file)
            configs, _, _ = _load_file(path)
            name = next(
                (n for n, e in configs.items()
                 if e.get("class") == _CLASS and make_label(n, e.get("created_at", "")) == config),
                None,
            )
            if name is not None:
                active_set = _get_active_set(configs[name], version)
                if _get_seed_randomize(active_set.get("seed", {})):
                    return float("NaN")
        except Exception:
            pass
        return config

    def load_config(self, movie: str, config: str, version: str):
        file = None if movie == _FILE_DEFAULT else movie[1:movie.index(')')] + '.json'
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
        entry      = configs[name]
        active_set = _get_active_set(entry, version)
        loras      = _get_loras(active_set)

        seed_obj = active_set.get("seed", {"value": 0})
        seed_val = _get_int(seed_obj)
        if _get_seed_randomize(seed_obj):
            seed_val = random.randint(1, 2**31 - 1)
            sets = entry.get("sets", [])
            raw_version = str(version).split(" - ")[0].strip()
            for i, s in enumerate(sets):
                if str(s.get("version", "")) == raw_version:
                    sets[i]["seed"] = {**(seed_obj if isinstance(seed_obj, dict) else {}), "value": seed_val}
                    break
            else:
                if sets:
                    sets[-1]["seed"] = {**(seed_obj if isinstance(seed_obj, dict) else {}), "value": seed_val}
            try:
                _write_file(path, configs, meta_extra, effective)
            except Exception as e:
                print(f"[DAZ TOOLS] WorkflowConfigWan22: could not save random seed — {e}")

        pos_prompt_val = active_set.get("positive_prompt")
        prompt_type    = pos_prompt_val.get("type", "smart") if isinstance(pos_prompt_val, dict) else "smart"
        master_text    = _get_text(active_set.get("master_prompt"))
        pos_text       = _get_text(pos_prompt_val)
        is_relay       = prompt_type == "smart"
        pos_out        = pos_text if is_relay else "\n\n".join(p for p in (master_text, pos_text) if p)

        unet_high = _load_unet(_get_name(active_set.get("unet_high")))
        unet_low  = _load_unet(_get_name(active_set.get("unet_low")))

        lora_1_sd, lora_1_w = _process_lora(loras.get("lora_1", ""))
        lora_2_sd, lora_2_w = _process_lora(loras.get("lora_2", ""))
        lora_3_sd, lora_3_w = _process_lora(loras.get("lora_3", ""))
        lora_4_sd, lora_4_w = _process_lora(loras.get("lora_4", ""))
        lora_5_sd, lora_5_w = _process_lora(loras.get("lora_5", ""))
        lora_6_sd, lora_6_w = _process_lora(loras.get("lora_6", ""))
        lora_7_sd, lora_7_w = _process_lora(loras.get("lora_7", ""))
        lora_8_sd, lora_8_w = _process_lora(loras.get("lora_8", ""))

        shift_high = _get_float(active_set.get("shift_high"), 5.0)
        shift_low  = _get_float(active_set.get("shift_low"),  5.0)

        unet_stack_high = _apply_model_shift(
            _apply_loras(unet_high, [
                (lora_1_sd, lora_1_w), (lora_3_sd, lora_3_w),
                (lora_5_sd, lora_5_w), (lora_7_sd, lora_7_w),
            ]),
            shift_high,
        )
        unet_stack_low = _apply_model_shift(
            _apply_loras(unet_low, [
                (lora_2_sd, lora_2_w), (lora_4_sd, lora_4_w),
                (lora_6_sd, lora_6_w), (lora_8_sd, lora_8_w),
            ]),
            shift_low,
        )

        return (
            unet_high,
            unet_low,
            _load_vae( _get_name(active_set.get("vae"))),
            _load_clip(_get_name(active_set.get("clip"))),
            _load_image(_get_path(active_set.get("image_path"))),
            _load_audio(_get_path(active_set.get("audio_path"))),
            _get_int(active_set.get("width")),
            _get_int(active_set.get("height")),
            _get_int(active_set.get("steps")),
            _get_int(active_set.get("split_step")),
            seed_val,
            master_text,
            pos_out,
            _get_text(active_set.get("negative_prompt")),
            is_relay,
            _get_float(active_set.get("cfg_high")),
            _get_float(active_set.get("cfg_low")),
            _get_int(active_set.get("total_frames")),
            _get_float(active_set.get("fps")),
            lora_1_sd, lora_2_sd,
            lora_3_sd, lora_4_sd,
            lora_5_sd, lora_6_sd,
            lora_7_sd, lora_8_sd,
            _get_file(active_set.get("filename")),
            unet_stack_high,
            unet_stack_low,
            shift_high,
            shift_low,
            active_set.get("type", "") == "T2V",
            _get_flag_value(active_set.get("flags", {}).get("flag_1")),
            _get_flag_value(active_set.get("flags", {}).get("flag_2")),
            _get_flag_value(active_set.get("flags", {}).get("flag_3")),
        )
