"""
Shared helpers and REST routes for all WorkflowConfig node classes.
Imported by each class-specific node file (workflow_config_wan22.py, etc.).
Python's module cache guarantees routes are registered exactly once.
"""
import os
import json
from datetime import datetime
from typing import Optional

try:
    import folder_paths as _fp
    _WORKFLOWS_DIR = os.path.join(_fp.base_path, "user", "default", "workflows")
except Exception:
    _NODES_DIR     = os.path.dirname(os.path.abspath(__file__))
    _WORKFLOWS_DIR = os.path.dirname(os.path.dirname(_NODES_DIR))

try:
    import comfy.sd as _comfy_sd
except Exception:
    _comfy_sd = None

os.makedirs(_WORKFLOWS_DIR, exist_ok=True)
CONFIG_FILE = os.path.join(_WORKFLOWS_DIR, "dx_workflow_configs.json")

CURRENT_SCHEMA = 1
_META_KEY      = "_meta"

_LORA_FIELDS = ("lora_1", "lora_2", "lora_3", "lora_4", "lora_5", "lora_6", "lora_7", "lora_8")

# Fields added per schema version (additive only — new fields with default values only,
# never modify or transform existing fields). Add a new entry here for each future version.
_SCHEMA_DEFAULTS: dict[int, dict] = {}

_missing_warned   = False
# Tracks the highest schema version seen on disk so an older node installation
# never downgrades the file version written by a newer one.
_effective_schema = CURRENT_SCHEMA


# ── Schema v1 typed-object accessors ─────────────────────────────────────────
# All helpers accept either a typed wrapper object or a bare scalar so that
# legacy (pre-v1 flat) entries continue to load without a separate migration.

def _get_name(val, default: str = "") -> str:
    """Read a {"name": "…"} field, or fall back to a bare string."""
    if isinstance(val, dict):
        return str(val.get("name") or default)
    return str(val or default)

def _get_text(val, default: str = "") -> str:
    """Read a {"text": "…"} field, or fall back to a bare string."""
    if isinstance(val, dict):
        return str(val.get("text") or default)
    return str(val or default)

def _get_path(val, default: str = "") -> str:
    """Read a {"path": "…"} field, or fall back to a bare string."""
    if isinstance(val, dict):
        return str(val.get("path") or default)
    return str(val or default)

def _get_file(val, default: str = "") -> str:
    """Read a {"file": "…"} field, or fall back to a bare string."""
    if isinstance(val, dict):
        return str(val.get("file") or default)
    return str(val or default)

def _get_int(val, default: int = 0) -> int:
    """Read a {"value": N} field, or fall back to a bare integer."""
    if isinstance(val, dict):
        v = val.get("value")
        return int(v) if v is not None else default
    return int(val) if val is not None else default

def _get_float(val, default: float = 0.0) -> float:
    """Read a {"value": N} field, or fall back to a bare float."""
    if isinstance(val, dict):
        v = val.get("value")
        return float(v) if v is not None else default
    return float(val) if val is not None else default

def _get_loras(entry: dict) -> dict:
    """Return the loras mapping from an entry.
    Schema v1 stores loras under a "loras" parent object; legacy files store
    them at the top level as lora_1 … lora_8."""
    loras_obj = entry.get("loras")
    if isinstance(loras_obj, dict):
        return loras_obj
    # Legacy: top-level lora_N fields
    return {key: entry.get(key, "") for key in _LORA_FIELDS}


# ── Lora helpers ──────────────────────────────────────────────────────────────

def _lora_obj(name="", strength=1.0, enabled=True) -> dict:
    return {"name": name, "strength": strength, "enabled": enabled}


def _coerce_lora(value, existing=None) -> dict:
    """Ensure a lora value is a flat object {name, strength, enabled}.
    Accepts legacy bare strings or already-correct dicts."""
    if isinstance(value, dict):
        return value
    existing_obj = existing if isinstance(existing, dict) else {}
    return _lora_obj(
        name=value or "",
        strength=existing_obj.get("strength", 1.0),
        enabled=existing_obj.get("enabled", True),
    )


# ── API normalisation helpers ─────────────────────────────────────────────────

def _flatten_entry(entry: dict) -> dict:
    """Convert a v1 typed-object entry to flat scalars for REST API responses.
    Also handles legacy flat entries transparently via the _get_* helpers."""
    result: dict = {}
    result["type"] = entry.get("type", "")
    for f in ("unet_high", "unet_low", "vae", "clip", "audio_vae", "checkpoint", "clip_2"):
        result[f] = _get_name(entry.get(f))
    result["group"]      = _get_name(entry.get("group"))
    result["image_path"] = _get_path(entry.get("image_path"))
    result["filename"]   = _get_file(entry.get("filename"))
    for f in ("master_prompt", "positive_prompt", "negative_prompt"):
        result[f] = _get_text(entry.get(f))
    for f in ("width", "height", "steps", "split_step", "seed", "total_frames"):
        result[f] = _get_int(entry.get(f))
    for f in ("cfg_high", "cfg_low", "fps"):
        result[f] = _get_float(entry.get(f))
    loras = _get_loras(entry)
    for key in _LORA_FIELDS:
        result[key] = _coerce_lora(loras.get(key, ""))
    return result


def _build_entry_fields(data: dict) -> dict:
    """Convert flat API data (received from JS) into v1 typed-object format for storage.
    Used when creating a new entry; all fields are expected to be present in data."""
    result: dict = {}
    result["type"] = data.get("type", "")
    for f in ("unet_high", "unet_low", "vae", "clip", "audio_vae", "checkpoint", "clip_2"):
        result[f] = {"name": str(data.get(f) or "")}
    result["group"]      = {"name": str(data.get("group") or "")}
    result["image_path"] = {"path": str(data.get("image_path") or "")}
    result["filename"]   = {"file": str(data.get("filename") or "")}
    for f in ("master_prompt", "positive_prompt", "negative_prompt"):
        result[f] = {"text": str(data.get(f) or "")}
    for f in ("width", "height", "steps", "split_step", "seed", "total_frames"):
        try:
            result[f] = {"value": int(data.get(f) or 0)}
        except (ValueError, TypeError):
            result[f] = {"value": 0}
    for f in ("cfg_high", "cfg_low", "fps"):
        try:
            result[f] = {"value": float(data.get(f) or 0.0)}
        except (ValueError, TypeError):
            result[f] = {"value": 0.0}
    result["loras"] = {key: _coerce_lora(data.get(key, "")) for key in _LORA_FIELDS}
    return result


# ── Checkpoint loader ─────────────────────────────────────────────────────────

def load_checkpoint(name: str):
    """Load a checkpoint that embeds model+clip+vae (like ComfyUI's Load Checkpoint node).
    Returns (model, clip, vae) or (None, None, None) if name is empty."""
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
    return out[0], out[1], out[2]  # model, clip, vae


# ── Schema migration ──────────────────────────────────────────────────────────

def _migrate(configs: dict, from_version: int) -> dict:
    """Apply default values for every schema version between from_version+1 and CURRENT_SCHEMA.
    Only adds new fields via setdefault — never modifies existing attribute values."""
    for version in range(from_version + 1, CURRENT_SCHEMA + 1):
        for entry in configs.values():
            for field, default in _SCHEMA_DEFAULTS.get(version, {}).items():
                entry.setdefault(field, default)
    return configs


def _save_configs(configs: dict) -> None:
    """Write configs to disk prefixed with the schema meta block.
    Always uses _effective_schema (the max of this node's CURRENT_SCHEMA and whatever
    was already on disk) so an older node never downgrades the file version."""
    data: dict = {_META_KEY: {"schema_version": _effective_schema}}
    data.update(configs)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def load_configs() -> dict:
    global _missing_warned, _effective_schema
    if not os.path.exists(CONFIG_FILE):
        if not _missing_warned:
            print(f"[DAZ TOOLS] WorkflowConfig: config file not found at {CONFIG_FILE}")
            _missing_warned = True
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as e:
        print(f"[DAZ TOOLS] WorkflowConfig: could not read config file — {e}")
        return {}

    if not isinstance(raw, dict):
        print("[DAZ TOOLS] WorkflowConfig: config file has unexpected format")
        return {}

    file_version = raw.get(_META_KEY, {}).get("schema_version", 1)
    _effective_schema = max(file_version, CURRENT_SCHEMA)
    configs = {k: v for k, v in raw.items() if k != _META_KEY}

    if file_version < CURRENT_SCHEMA:
        print(f"[DAZ TOOLS] WorkflowConfig: migrating schema v{file_version} → v{CURRENT_SCHEMA}")
        configs = _migrate(configs, file_version)
        try:
            _save_configs(configs)
        except Exception as e:
            print(f"[DAZ TOOLS] WorkflowConfig: could not write migrated config — {e}")

    return configs


# ── Label helpers ─────────────────────────────────────────────────────────────

def make_label(name: str, created_at: str) -> str:
    try:
        dt = datetime.fromisoformat(created_at)
        return f"{name} ({dt.strftime('%m/%d/%y %H:%M')})"
    except Exception:
        return name


def labels_for_class(cls: str) -> list[str]:
    configs = load_configs()
    return [
        make_label(name, entry.get("created_at", ""))
        for name, entry in configs.items()
        if entry.get("class") == cls
    ]


def configs_with_type_for_class(cls: str) -> list[dict]:
    configs = load_configs()
    return [
        {
            "label": make_label(name, entry.get("created_at", "")),
            "type":  entry.get("type", ""),
            "group": _get_name(entry.get("group", "")),
        }
        for name, entry in configs.items()
        if entry.get("class") == cls
    ]


def label_to_name(label: str, cls: str) -> Optional[str]:
    configs = load_configs()
    for name, entry in configs.items():
        if entry.get("class") == cls and make_label(name, entry.get("created_at", "")) == label:
            return name
    return None


# ── REST routes ───────────────────────────────────────────────────────────────

try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/daz/workflow-configs")
    async def _daz_workflow_configs(request):
        cls = request.rel_url.query.get("class", "")
        return web.json_response(labels_for_class(cls))

    @PromptServer.instance.routes.get("/daz/workflow-configs-with-type")
    async def _daz_workflow_configs_with_type(request):
        cls = request.rel_url.query.get("class", "")
        return web.json_response(configs_with_type_for_class(cls))

    @PromptServer.instance.routes.get("/daz/workflow-config-detail")
    async def _daz_workflow_config_detail(request):
        label = request.rel_url.query.get("label", "")
        cls   = request.rel_url.query.get("class", "")
        configs = load_configs()
        name = next(
            (n for n, e in configs.items()
             if e.get("class") == cls and make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."})
        entry  = configs[name]
        result = _flatten_entry(entry)
        result["name"] = name
        return web.json_response(result)

    @PromptServer.instance.routes.get("/daz/folder-files")
    async def _daz_folder_files(request):
        folder = request.rel_url.query.get("folder", "")
        if not folder:
            return web.json_response([])
        try:
            import folder_paths as fp
            if folder == "input":
                # "input" is not in folder_names_and_paths; scan it directly
                # to match the behaviour of ComfyUI's built-in Load Image node.
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

        label = data.get("label", "")
        cls   = data.get("class", "")

        configs = load_configs()
        name = next(
            (n for n, e in configs.items()
             if e.get("class") == cls and make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."}, status=404)

        entry = configs[name]

        # Update typed-object fields — only those present in the payload
        if "type" in data:
            entry["type"] = data["type"]
        for f in ("unet_high", "unet_low", "vae", "clip", "audio_vae", "checkpoint", "clip_2"):
            if f in data:
                entry[f] = {"name": str(data[f] or "")}
        if "group" in data:
            entry["group"] = {"name": str(data["group"] or "")}
        if "image_path" in data:
            entry["image_path"] = {"path": str(data["image_path"] or "")}
        if "filename" in data:
            entry["filename"] = {"file": str(data["filename"] or "")}
        for f in ("master_prompt", "positive_prompt", "negative_prompt"):
            if f in data:
                entry[f] = {"text": str(data[f] or "")}
        for f in ("width", "height", "steps", "split_step", "seed", "total_frames"):
            if f in data:
                try:
                    entry[f] = {"value": int(data[f] or 0)}
                except (ValueError, TypeError):
                    pass
        for f in ("cfg_high", "cfg_low", "fps"):
            if f in data:
                try:
                    entry[f] = {"value": float(data[f] or 0.0)}
                except (ValueError, TypeError):
                    pass

        # Migrate legacy top-level lora fields into the "loras" dict on first touch,
        # then update only the lora slots present in the payload.
        if not isinstance(entry.get("loras"), dict):
            entry["loras"] = {
                key: _coerce_lora(entry.get(key, "")) for key in _LORA_FIELDS
            }
        for lora_key in _LORA_FIELDS:
            if lora_key in data:
                entry["loras"][lora_key] = _coerce_lora(
                    data[lora_key], entry["loras"].get(lora_key)
                )
        # Remove legacy top-level lora fields now that they live under "loras"
        for lora_key in _LORA_FIELDS:
            entry.pop(lora_key, None)

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

        entry["created_at"] = datetime.now().isoformat()
        configs[name] = entry

        try:
            _save_configs(configs)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        new_label = make_label(name, entry["created_at"])
        return web.json_response({"ok": True, "label": new_label})

    @PromptServer.instance.routes.post("/daz/workflow-config-create")
    async def _daz_workflow_config_create(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        name = data.get("name", "").strip()
        cls  = data.get("class", "")

        if not name:
            return web.json_response({"error": "Config name is required."}, status=400)
        if name == _META_KEY:
            return web.json_response({"error": f"'{_META_KEY}' is a reserved name."}, status=400)

        configs = load_configs()
        if name in configs:
            return web.json_response({"error": f"A config named '{name}' already exists."}, status=409)

        entry = {"class": cls, "created_at": datetime.now().isoformat()}
        entry.update(_build_entry_fields(data))

        configs[name] = entry

        try:
            _save_configs(configs)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        new_label = make_label(name, entry["created_at"])
        return web.json_response({"ok": True, "label": new_label})

    @PromptServer.instance.routes.post("/daz/workflow-config-delete")
    async def _daz_workflow_config_delete(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        label = data.get("label", "")
        cls   = data.get("class", "")

        configs = load_configs()
        name = next(
            (n for n, e in configs.items()
             if e.get("class") == cls and make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."}, status=404)

        del configs[name]

        try:
            _save_configs(configs)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        return web.json_response({"ok": True})

except Exception:
    pass
