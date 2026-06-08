"""
Shared helpers and REST routes for all WorkflowConfig node classes.
Imported by each class-specific node file (workflow_config_wan22.py, etc.).
Python's module cache guarantees routes are registered exactly once.
"""
import os
import json
from datetime import datetime
from typing import Optional

_NODES_DIR  = os.path.dirname(os.path.abspath(__file__))
_PLUGIN_DIR = os.path.dirname(_NODES_DIR)

try:
    import folder_paths as _fp
except Exception:
    _fp = None


def _resolve_workflows_dir() -> str:
    override_cfg = os.path.join(_PLUGIN_DIR, "dx_root_dir_config.json")
    if os.path.exists(override_cfg):
        try:
            with open(override_cfg, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            custom_dir = cfg.get("workflows_root_dir", "").strip()
            if custom_dir:
                path = custom_dir if os.path.isabs(custom_dir) else os.path.join(_PLUGIN_DIR, custom_dir)
                print(f"[DAZ TOOLS] WorkflowConfig: using custom workflows_root_dir from dx_root_dir_config.json: {path}")
                return path
        except Exception as e:
            print(f"[DAZ TOOLS] WorkflowConfig: could not read dx_root_dir_config.json — {e}")
    if _fp is not None:
        default_dir = os.path.join(_fp.base_path, "user", "default", "workflows")
    else:
        default_dir = os.path.dirname(_PLUGIN_DIR)
    print(f"[DAZ TOOLS] WorkflowConfig: using default workflows root dir: {default_dir}")
    return default_dir


_WORKFLOWS_DIR = _resolve_workflows_dir()

try:
    import comfy.sd as _comfy_sd
except Exception:
    _comfy_sd = None

os.makedirs(_WORKFLOWS_DIR, exist_ok=True)

CONFIG_FILE = os.path.join(_WORKFLOWS_DIR, "dx_workflow_configs.json")
_MGR_DIR    = os.path.join(_WORKFLOWS_DIR, ".dx_mgr")

CURRENT_SCHEMA = 3
_META_KEY      = "_meta"

_LORA_FIELDS = ("lora_1", "lora_2", "lora_3", "lora_4", "lora_5", "lora_6", "lora_7", "lora_8")

_SCHEMA_DEFAULTS: dict[int, dict] = {}

_warned_missing: set = set()


# ── Path resolution ───────────────────────────────────────────────────────────

def _resolve_path(file: str = None) -> str:
    if not file or file == "(default)":
        return CONFIG_FILE
    basename = os.path.basename(file)
    if not (basename.startswith("dx_") and basename.endswith(".json")):
        raise ValueError(f"[DAZ TOOLS] Invalid config file name: {file!r}")
    return os.path.join(_MGR_DIR, basename)


# ── Core file I/O ─────────────────────────────────────────────────────────────

def _load_file(path: str) -> tuple[dict, dict, int]:
    if not os.path.exists(path):
        if path not in _warned_missing:
            print(f"[DAZ TOOLS] WorkflowConfig: config file not found at {path}")
            _warned_missing.add(path)
        return {}, {}, CURRENT_SCHEMA
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as e:
        print(f"[DAZ TOOLS] WorkflowConfig: could not read {os.path.basename(path)} — {e}")
        return {}, {}, CURRENT_SCHEMA

    if not isinstance(raw, dict):
        print(f"[DAZ TOOLS] WorkflowConfig: {os.path.basename(path)} has unexpected format")
        return {}, {}, CURRENT_SCHEMA

    file_meta    = raw.get(_META_KEY, {})
    file_version = file_meta.get("schema_version", 1)
    effective    = max(file_version, CURRENT_SCHEMA)
    meta_extra   = {k: v for k, v in file_meta.items() if k != "schema_version"}
    configs      = {k: v for k, v in raw.items() if k != _META_KEY}

    if file_version > CURRENT_SCHEMA:
        print(f"[DAZ TOOLS] WorkflowConfig: {os.path.basename(path)} is schema v{file_version} "
              f"(node understands v{CURRENT_SCHEMA}) — skipping migration")
    elif file_version < CURRENT_SCHEMA:
        print(f"[DAZ TOOLS] WorkflowConfig: migrating {os.path.basename(path)} "
              f"v{file_version} → v{CURRENT_SCHEMA}")
        configs = _migrate(configs, file_version)
        try:
            _write_file(path, configs, meta_extra, effective)
        except Exception as e:
            print(f"[DAZ TOOLS] WorkflowConfig: could not write migrated config — {e}")

    return configs, meta_extra, effective


def _write_file(path: str, configs: dict, meta_extra: dict, effective_schema: int) -> None:
    now = datetime.now().isoformat()
    meta: dict = {
        "schema_version": effective_schema,
        "name":           meta_extra.get("name",       "dx_workflow_configs"),
        "version":        meta_extra.get("version",    "1.0"),
        "created_at":     meta_extra.get("created_at", now),
        "updated_at":     now,
    }
    data: dict = {_META_KEY: meta}
    data.update(configs)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ── Multi-file scanning ───────────────────────────────────────────────────────

def scan_config_files(cls: str = None) -> list[dict]:
    os.makedirs(_MGR_DIR, exist_ok=True)
    results = []
    try:
        candidates = sorted(
            f for f in os.listdir(_MGR_DIR)
            if f.startswith("dx_") and f.endswith(".json")
        )
    except OSError:
        return results

    for filename in candidates:
        path = os.path.join(_MGR_DIR, filename)
        try:
            configs, meta_extra, _ = _load_file(path)
        except Exception:
            continue
        if cls and not any(e.get("class") == cls for e in configs.values()):
            continue
        results.append({
            "file": filename,
            "name": meta_extra.get("name") or os.path.splitext(filename)[0],
            "path": path,
        })
    return results


# ── Sets helpers ──────────────────────────────────────────────────────────────

def _get_active_set(entry: dict, version: str = None) -> dict:
    """Return the set matching version, or the last set. Returns {} if no sets."""
    sets = entry.get("sets")
    if not isinstance(sets, list) or not sets:
        return {}
    if version:
        # Strip optional " - label" display suffix added by the UI
        raw = str(version).split(" - ")[0].strip()
        for s in sets:
            if str(s.get("version", "")) == raw:
                return s
    return sets[-1]


def _next_version(entry: dict) -> str:
    """Return the next auto-incremented version string based on max numeric version in sets."""
    max_v = 0
    for s in entry.get("sets", []):
        v = s.get("version", "")
        if isinstance(v, (int, float)):
            max_v = max(max_v, int(v))
        elif isinstance(v, str) and v.isdigit():
            max_v = max(max_v, int(v))
    return str(max_v + 1)


# ── Schema v1 typed-object accessors ─────────────────────────────────────────

def _get_name(val, default: str = "") -> str:
    if isinstance(val, dict):
        return str(val.get("name") or default)
    return str(val or default)

def _get_text(val, default: str = "") -> str:
    if isinstance(val, dict):
        return str(val.get("text") or default)
    return str(val or default)

def _get_path(val, default: str = "") -> str:
    if isinstance(val, dict):
        return str(val.get("path") or default)
    return str(val or default)

def _get_file(val, default: str = "") -> str:
    if isinstance(val, dict):
        return str(val.get("file") or default)
    return str(val or default)

def _get_int(val, default: int = 0) -> int:
    if isinstance(val, dict):
        v = val.get("value")
        if v is None:
            return default
        try:
            return int(v)
        except (ValueError, TypeError):
            return default
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default

def _get_float(val, default: float = 0.0) -> float:
    if isinstance(val, dict):
        v = val.get("value")
        if v is None:
            return default
        try:
            return float(v)
        except (ValueError, TypeError):
            return default
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def _get_flag_label(val, default: str = "") -> str:
    if isinstance(val, dict):
        return str(val.get("label") or default)
    return default

def _get_flag_value(val) -> bool:
    if isinstance(val, dict):
        return bool(val.get("value", False))
    return False

def _get_seed_randomize(val) -> bool:
    if isinstance(val, dict):
        return bool(val.get("randomize", False))
    return False

_PROMPT_TYPE_TO_INT = {"smart": 1, "beats": 2, "simple": 3}

def _get_prompt_type_int(val, default: int = 1) -> int:
    t = val.get("type", "smart") if isinstance(val, dict) else "smart"
    return _PROMPT_TYPE_TO_INT.get(t, default)


def _get_loras(set_obj: dict) -> dict:
    """Return the loras mapping from a set object."""
    loras_obj = set_obj.get("loras")
    if isinstance(loras_obj, dict):
        return loras_obj
    return {key: set_obj.get(key, "") for key in _LORA_FIELDS}


# ── Lora helpers ──────────────────────────────────────────────────────────────

def _lora_obj(name="", strength=1.0, enabled=True) -> dict:
    return {"name": name, "strength": strength, "enabled": enabled}


def _coerce_lora(value, existing=None) -> dict:
    if isinstance(value, dict):
        return value
    existing_obj = existing if isinstance(existing, dict) else {}
    return _lora_obj(
        name=value or "",
        strength=existing_obj.get("strength", 1.0),
        enabled=existing_obj.get("enabled", True),
    )


# ── Set field helpers ─────────────────────────────────────────────────────────

def _apply_set_fields(target: dict, data: dict) -> None:
    """Apply typed-object field updates from request data onto a set dict in place."""
    if "type" in data:
        target["type"] = data["type"]

    for f in ("unet_high", "unet_low", "vae", "clip", "audio_vae", "checkpoint", "clip_2"):
        if f in data:
            v = data[f]
            target[f] = v if isinstance(v, dict) else {"name": str(v or "")}

    if "group" in data:
        v = data["group"]
        target["group"] = v if isinstance(v, dict) else {"name": str(v or "")}

    if "image_path" in data:
        v = data["image_path"]
        target["image_path"] = v if isinstance(v, dict) else {"path": str(v or "")}

    if "filename" in data:
        v = data["filename"]
        target["filename"] = v if isinstance(v, dict) else {"file": str(v or "")}

    for f in ("master_prompt", "positive_prompt", "negative_prompt"):
        if f in data:
            v = data[f]
            target[f] = v if isinstance(v, dict) else {"text": str(v or "")}

    for f in ("width", "height", "steps", "split_step", "seed", "total_frames"):
        if f in data:
            v = data[f]
            if isinstance(v, dict):
                target[f] = v
            else:
                try:
                    target[f] = {"value": int(v or 0)}
                except (ValueError, TypeError):
                    pass

    for f in ("cfg_high", "cfg_low", "fps"):
        if f in data:
            v = data[f]
            if isinstance(v, dict):
                target[f] = v
            else:
                try:
                    target[f] = {"value": float(v or 0.0)}
                except (ValueError, TypeError):
                    pass

    if "loras" in data and isinstance(data["loras"], dict):
        if not isinstance(target.get("loras"), dict):
            target["loras"] = {key: _coerce_lora(target.get(key, "")) for key in _LORA_FIELDS}
        for lora_key, lora_val in data["loras"].items():
            if lora_key in _LORA_FIELDS:
                target["loras"][lora_key] = _coerce_lora(
                    lora_val, target["loras"].get(lora_key)
                )
        for key in _LORA_FIELDS:
            target.pop(key, None)

    if "version_label" in data:
        target["label"] = str(data.get("version_label") or "")

    if "flags" in data and isinstance(data["flags"], dict):
        if not isinstance(target.get("flags"), dict):
            target["flags"] = {}
        for flag_key in ("flag_1", "flag_2", "flag_3"):
            if flag_key in data["flags"] and isinstance(data["flags"][flag_key], dict):
                target["flags"][flag_key] = data["flags"][flag_key]

    if "note" in data:
        v = data["note"]
        target["note"] = v if isinstance(v, dict) else {"value": str(v or "")}


def _build_set_from_data(data: dict, version: str, now: str) -> dict:
    """Build a new set object from request data."""
    s: dict = {"version": version, "label": str(data.get("version_label") or ""), "created_at": now, "updated_at": now}
    s["type"] = data.get("type", "")
    for f in ("unet_high", "unet_low", "vae", "clip", "audio_vae", "checkpoint", "clip_2"):
        v = data.get(f)
        s[f] = v if isinstance(v, dict) else {"name": str(v or "")}
    v = data.get("group")
    s["group"] = v if isinstance(v, dict) else {"name": str(v or "")}
    v = data.get("image_path")
    s["image_path"] = v if isinstance(v, dict) else {"path": str(v or "")}
    v = data.get("filename")
    s["filename"] = v if isinstance(v, dict) else {"file": str(v or "")}
    for f in ("master_prompt", "positive_prompt", "negative_prompt"):
        v = data.get(f)
        s[f] = v if isinstance(v, dict) else {"text": str(v or "")}
    for f in ("width", "height", "steps", "split_step", "seed", "total_frames"):
        v = data.get(f)
        if isinstance(v, dict):
            s[f] = v
        else:
            try:
                s[f] = {"value": int(v or 0)}
            except (ValueError, TypeError):
                s[f] = {"value": 0}
    for f in ("cfg_high", "cfg_low", "fps"):
        v = data.get(f)
        if isinstance(v, dict):
            s[f] = v
        else:
            try:
                s[f] = {"value": float(v or 0.0)}
            except (ValueError, TypeError):
                s[f] = {"value": 0.0}
    loras_data = data.get("loras") if isinstance(data.get("loras"), dict) else {}
    s["loras"] = {key: _coerce_lora(loras_data.get(key, "")) for key in _LORA_FIELDS}
    flags_data = data.get("flags") if isinstance(data.get("flags"), dict) else {}
    s["flags"] = {
        "flag_1": flags_data.get("flag_1") if isinstance(flags_data.get("flag_1"), dict)
                  else {"label": "flag 1", "value": False},
        "flag_2": flags_data.get("flag_2") if isinstance(flags_data.get("flag_2"), dict)
                  else {"label": "flag 2", "value": False},
        "flag_3": flags_data.get("flag_3") if isinstance(flags_data.get("flag_3"), dict)
                  else {"label": "flag 3", "value": False},
    }
    v = data.get("note")
    s["note"] = v if isinstance(v, dict) else {"value": str(v or "")}
    return s


# ── API normalisation ─────────────────────────────────────────────────────────

def _normalize_set(set_obj: dict) -> dict:
    """Ensure a set object is in v1 typed-object format before sending to the JS client."""
    result = dict(set_obj)

    for f in ("unet_high", "unet_low", "vae", "clip", "audio_vae", "checkpoint", "clip_2"):
        v = result.get(f)
        if not isinstance(v, dict):
            result[f] = {"name": str(v or "")}

    v = result.get("group")
    if not isinstance(v, dict):
        result["group"] = {"name": str(v or "")}

    v = result.get("image_path")
    if not isinstance(v, dict):
        result["image_path"] = {"path": str(v or "")}

    v = result.get("filename")
    if not isinstance(v, dict):
        result["filename"] = {"file": str(v or "")}

    for f in ("master_prompt", "negative_prompt"):
        v = result.get(f)
        if not isinstance(v, dict):
            result[f] = {"text": str(v or "")}

    v = result.get("positive_prompt")
    if not isinstance(v, dict):
        result["positive_prompt"] = {"text": str(v or ""), "type": "smart"}
    elif "type" not in v:
        result["positive_prompt"] = {**v, "type": "smart"}

    for f in ("width", "height", "steps", "split_step", "seed", "total_frames"):
        v = result.get(f)
        if not isinstance(v, dict):
            try:
                result[f] = {"value": int(v or 0)}
            except (ValueError, TypeError):
                result[f] = {"value": 0}

    for f in ("cfg_high", "cfg_low", "fps"):
        v = result.get(f)
        if not isinstance(v, dict):
            try:
                result[f] = {"value": float(v or 0.0)}
            except (ValueError, TypeError):
                result[f] = {"value": 0.0}

    if not isinstance(result.get("loras"), dict):
        result["loras"] = {key: _coerce_lora(result.get(key, "")) for key in _LORA_FIELDS}
    for key in _LORA_FIELDS:
        result.pop(key, None)

    if not isinstance(result.get("label"), str):
        result["label"] = ""

    flags = result.get("flags")
    if not isinstance(flags, dict):
        result["flags"] = {
            "flag_1": {"label": "flag 1", "value": False},
            "flag_2": {"label": "flag 2", "value": False},
            "flag_3": {"label": "flag 3", "value": False},
        }
    else:
        for key, default_label in (("flag_1", "flag 1"), ("flag_2", "flag 2"), ("flag_3", "flag 3")):
            if not isinstance(flags.get(key), dict):
                flags[key] = {"label": default_label, "value": False}

    v = result.get("note")
    if not isinstance(v, dict):
        result["note"] = {"value": str(v or "")}

    return result


# ── Checkpoint loader ─────────────────────────────────────────────────────────

def load_checkpoint(name: str):
    if not name:
        return None, None, None
    path = _fp.get_full_path("checkpoints", name)
    if not path:
        raise ValueError(f"[DAZ TOOLS] WorkflowConfig: checkpoint '{name}' not found")
    out = _comfy_sd.load_checkpoint_guess_config(
        path,
        output_vae=True,
        output_clip=True,
        embedding_directory=_fp.get_folder_paths("embeddings"),
    )
    return out[0], out[1], out[2]


# ── Schema migration ──────────────────────────────────────────────────────────

def _migrate(configs: dict, from_version: int) -> dict:
    if from_version < 2:
        for entry in configs.values():
            for s in entry.get("sets", []):
                if "label" not in s:
                    s["label"] = ""
                flags = s.get("flags")
                if isinstance(flags, dict) and "flag_3" not in flags:
                    flags["flag_3"] = {"label": "flag 3", "value": False}
    return configs


# ── Public API ────────────────────────────────────────────────────────────────

def load_configs(file: str = None) -> dict:
    path = _resolve_path(file)
    configs, _, _ = _load_file(path)
    return configs


def make_label(name: str, created_at: str) -> str:
    try:
        dt = datetime.fromisoformat(created_at)
        return f"{name} ({dt.strftime('%m/%d/%y %H:%M')})"
    except Exception:
        return name


def labels_for_class(cls: str, file: str = None) -> list[str]:
    configs = load_configs(file)
    return [
        make_label(name, entry.get("created_at", ""))
        for name, entry in configs.items()
        if entry.get("class") == cls
    ]


def configs_with_type_for_class(cls: str, file: str = None) -> list[dict]:
    configs = load_configs(file)
    result = []
    for name, entry in configs.items():
        if entry.get("class") != cls:
            continue
        sets = entry.get("sets", [])
        active_set = _get_active_set(entry)
        all_types  = list(dict.fromkeys(s.get("type", "")          for s in sets if s.get("type", "")))
        all_groups = list(dict.fromkeys(_get_name(s.get("group", "")) for s in sets if _get_name(s.get("group", ""))))
        result.append({
            "label":  make_label(name, entry.get("created_at", "")),
            "type":   active_set.get("type", ""),
            "group":  _get_name(active_set.get("group", "")),
            "types":  all_types,
            "groups": all_groups,
        })
    return result


def label_to_name(label: str, cls: str, file: str = None) -> Optional[str]:
    configs = load_configs(file)
    for name, entry in configs.items():
        if entry.get("class") == cls and make_label(name, entry.get("created_at", "")) == label:
            return name
    return None


def _version_sort_key(v: str):
    raw = v.split(" - ")[0].strip() if " - " in v else v
    return (0, int(raw), v) if raw.isdigit() else (1, raw, v)


def all_versions_for_class(cls: str) -> list[str]:
    """Collect all known version display strings across all files for a class.

    Includes both raw versions ("1") and labelled display strings ("1 - glock")
    so that widgets saved in either format pass ComfyUI validation.
    """
    seen: set = {"1"}

    def _add_set(s: dict):
        v = str(s.get("version", ""))
        if not v:
            return
        seen.add(v)
        label = str(s.get("label", "")).strip()
        if label:
            seen.add(f"{v} - {label}")

    sources = scan_config_files(cls)
    for src in sources:
        cfgs = load_configs(file=src["file"])
        for entry in cfgs.values():
            if entry.get("class") == cls:
                for s in entry.get("sets", []):
                    _add_set(s)
    for entry in load_configs(file=None).values():
        if entry.get("class") == cls:
            for s in entry.get("sets", []):
                _add_set(s)
    return sorted(seen, key=_version_sort_key)


# ── REST routes ───────────────────────────────────────────────────────────────

try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/daz/config-files")
    async def _daz_config_files(request):
        cls = request.rel_url.query.get("class", "")
        files = scan_config_files(cls or None)
        return web.json_response([{"file": f["file"], "name": f["name"]} for f in files])

    @PromptServer.instance.routes.get("/daz/workflow-configs")
    async def _daz_workflow_configs(request):
        cls  = request.rel_url.query.get("class", "")
        file = request.rel_url.query.get("file") or None
        return web.json_response(labels_for_class(cls, file=file))

    @PromptServer.instance.routes.get("/daz/workflow-configs-with-type")
    async def _daz_workflow_configs_with_type(request):
        cls  = request.rel_url.query.get("class", "")
        file = request.rel_url.query.get("file") or None
        return web.json_response(configs_with_type_for_class(cls, file=file))

    @PromptServer.instance.routes.get("/daz/workflow-config-versions")
    async def _daz_workflow_config_versions(request):
        label = request.rel_url.query.get("label", "")
        cls   = request.rel_url.query.get("class", "")
        file  = request.rel_url.query.get("file") or None

        try:
            path = _resolve_path(file)
        except ValueError:
            path = CONFIG_FILE

        cfgs, _, _ = _load_file(path)
        name = next(
            (k for k, e in cfgs.items()
             if e.get("class") == cls and make_label(k, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."}, status=404)

        sets = cfgs[name].get("sets", [])
        return web.json_response([
            {
                "version":    str(s.get("version", "")),
                "label":      str(s.get("label", "")),
                "type":       str(s.get("type", "")),
                "group":      str(_get_name(s.get("group", {}))),
                "created_at": s.get("created_at", ""),
                "updated_at": s.get("updated_at", ""),
            }
            for s in sets
        ])

    @PromptServer.instance.routes.get("/daz/workflow-config-detail")
    async def _daz_workflow_config_detail(request):
        label   = request.rel_url.query.get("label", "")
        cls     = request.rel_url.query.get("class", "")
        file    = request.rel_url.query.get("file") or None
        version = request.rel_url.query.get("version") or None

        def _find(path: str):
            cfgs, _, _ = _load_file(path)
            n = next(
                (k for k, e in cfgs.items()
                 if e.get("class") == cls and make_label(k, e.get("created_at", "")) == label),
                None,
            )
            return n, cfgs

        try:
            requested_path = _resolve_path(file)
        except ValueError:
            requested_path = CONFIG_FILE
            file = None
        name, configs = _find(requested_path)
        source_file = file

        if name is None:
            fallbacks = [
                (s["file"], s["path"]) for s in scan_config_files(cls)
                if s["path"] != requested_path
            ]
            if requested_path != CONFIG_FILE:
                fallbacks.append((None, CONFIG_FILE))
            for fb_file, fb_path in fallbacks:
                name, configs = _find(fb_path)
                if name is not None:
                    source_file = fb_file
                    break

        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."})

        entry      = configs[name]
        active_set = _get_active_set(entry, version)
        result     = _normalize_set(active_set)
        result["name"]    = name
        result["version"] = str(active_set.get("version", "1"))
        if source_file != file:
            result["_source_file"] = source_file
        return web.json_response(result)

    @PromptServer.instance.routes.get("/daz/folder-files")
    async def _daz_folder_files(request):
        folder = request.rel_url.query.get("folder", "")
        if not folder:
            return web.json_response([])
        try:
            import folder_paths as fp
            if folder == "input":
                d = fp.get_input_directory()
                files = sorted([
                    f for f in os.listdir(d)
                    if os.path.isfile(os.path.join(d, f))
                ])
            else:
                files = fp.get_filename_list(folder)
            return web.json_response(files)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/daz/workflow-config-save")
    async def _daz_workflow_config_save(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        label     = data.get("label", "")
        cls       = data.get("class", "")
        file      = data.get("file") or None
        _v        = data.get("version")
        version   = (str(_v).strip() or None) if _v is not None else None
        save_mode = data.get("save_mode", "current")  # "current" or "new_version"

        path = _resolve_path(file)
        configs, meta_extra, effective = _load_file(path)

        name = next(
            (n for n, e in configs.items()
             if e.get("class") == cls and make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."}, status=404)

        entry = configs[name]
        now   = datetime.now().isoformat()

        if save_mode == "new_version":
            new_ver = _next_version(entry)
            new_set = _build_set_from_data(data, new_ver, now)
            if not isinstance(entry.get("sets"), list):
                entry["sets"] = []
            entry["sets"].append(new_set)
            result_version = new_ver
        else:
            # Update the matching set in place (default: current)
            if not isinstance(entry.get("sets"), list) or not entry["sets"]:
                entry["sets"] = [{"version": version or "1", "created_at": now, "updated_at": now}]
            target_set = None
            if version:
                for s in entry["sets"]:
                    if str(s.get("version", "")) == version:
                        target_set = s
                        break
            if target_set is None:
                target_set = entry["sets"][-1]
            _apply_set_fields(target_set, data)
            target_set["updated_at"] = now
            result_version = str(target_set.get("version", "1"))

        # Handle config rename
        new_name = data.get("new_name", "").strip()
        if new_name and new_name != name:
            if new_name == _META_KEY:
                return web.json_response(
                    {"error": f"'{_META_KEY}' is a reserved name."}, status=400
                )
            if new_name in configs:
                return web.json_response(
                    {"error": f"A config named '{new_name}' already exists."}, status=409
                )
            del configs[name]
            name = new_name

        entry["updated_at"] = now
        configs[name] = entry

        try:
            _write_file(path, configs, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        new_label = make_label(name, entry["created_at"])
        return web.json_response({"ok": True, "label": new_label, "version": result_version})

    @PromptServer.instance.routes.post("/daz/workflow-config-create")
    async def _daz_workflow_config_create(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        name = data.get("name", "").strip()
        cls  = data.get("class", "")
        file = data.get("file") or None

        if not name:
            return web.json_response({"error": "Config name is required."}, status=400)
        if name == _META_KEY:
            return web.json_response({"error": f"'{_META_KEY}' is a reserved name."}, status=400)

        path = _resolve_path(file)
        configs, meta_extra, effective = _load_file(path)

        if name in configs:
            return web.json_response({"error": f"A config named '{name}' already exists."}, status=409)

        now     = datetime.now().isoformat()
        new_set = _build_set_from_data(data, "1", now)
        entry: dict = {
            "class":      cls,
            "created_at": now,
            "updated_at": now,
            "sets":       [new_set],
        }
        configs[name] = entry

        try:
            _write_file(path, configs, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        new_label = make_label(name, entry["created_at"])
        return web.json_response({"ok": True, "label": new_label, "version": "1"})

    @PromptServer.instance.routes.post("/daz/workflow-config-delete")
    async def _daz_workflow_config_delete(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        label       = data.get("label", "")
        cls         = data.get("class", "")
        file        = data.get("file") or None
        _v          = data.get("version")
        version     = (str(_v).strip() or None) if _v is not None else None
        delete_mode = data.get("delete_mode", "config")  # "version" or "config"

        path = _resolve_path(file)
        configs, meta_extra, effective = _load_file(path)

        name = next(
            (n for n, e in configs.items()
             if e.get("class") == cls and make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."}, status=404)

        if delete_mode == "version":
            entry = configs[name]
            sets  = entry.get("sets", [])
            if not version:
                return web.json_response({"error": "version is required for delete_mode=version."}, status=400)
            idx = next((i for i, s in enumerate(sets) if str(s.get("version", "")) == version), None)
            if idx is None:
                return web.json_response({"error": f"Version '{version}' not found."}, status=404)
            sets.pop(idx)
            if not sets:
                # Last version deleted — remove the whole config entry
                del configs[name]
                try:
                    _write_file(path, configs, meta_extra, effective)
                except Exception as e:
                    return web.json_response({"error": f"Could not write config file: {e}"}, status=500)
                return web.json_response({"ok": True, "config_deleted": True})
            entry["sets"]       = sets
            entry["updated_at"] = datetime.now().isoformat()
        else:
            del configs[name]

        try:
            _write_file(path, configs, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        return web.json_response({"ok": True})

    @PromptServer.instance.routes.post("/daz/workflow-config-duplicate-config")
    async def _daz_workflow_config_duplicate_config(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        label    = data.get("label", "")
        cls      = data.get("class", "")
        file     = data.get("file") or None
        new_name = data.get("new_name", "").strip()
        dup_mode = data.get("duplicate_mode", "current_set")  # "all_sets" or "current_set"
        _v       = data.get("version")
        version  = (str(_v).strip() or None) if _v is not None else None

        if not new_name:
            return web.json_response({"error": "Config name is required."}, status=400)
        if new_name == _META_KEY:
            return web.json_response({"error": f"'{_META_KEY}' is a reserved name."}, status=400)

        path = _resolve_path(file)
        configs, meta_extra, effective = _load_file(path)

        if new_name in configs:
            return web.json_response({"error": f"A config named '{new_name}' already exists."}, status=409)

        source_name = next(
            (n for n, e in configs.items()
             if e.get("class") == cls and make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if source_name is None:
            return web.json_response({"error": f"Config '{label}' not found."}, status=404)

        source_entry = configs[source_name]
        now = datetime.now().isoformat()

        if dup_mode == "all_sets":
            new_sets = json.loads(json.dumps(source_entry.get("sets", [])))
            for s in new_sets:
                s["created_at"] = now
                s["updated_at"] = now
            new_entry = {
                "class":      cls,
                "created_at": now,
                "updated_at": now,
                "sets":       new_sets,
            }
        else:
            active_set = _get_active_set(source_entry, version)
            new_set = json.loads(json.dumps(active_set))
            new_set["version"]    = "1"
            new_set["created_at"] = now
            new_set["updated_at"] = now
            new_entry = {
                "class":      cls,
                "created_at": now,
                "updated_at": now,
                "sets":       [new_set],
            }

        configs[new_name] = new_entry

        try:
            _write_file(path, configs, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        result_sets = new_entry["sets"]
        result_ver  = str(result_sets[0].get("version", "1")) if result_sets else "1"
        new_label   = make_label(new_name, new_entry["created_at"])
        return web.json_response({"ok": True, "label": new_label, "version": result_ver})

except Exception:
    pass
