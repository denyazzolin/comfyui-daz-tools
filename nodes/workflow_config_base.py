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

# Legacy single-file path (pre-multi-config)
CONFIG_FILE = os.path.join(_WORKFLOWS_DIR, "dx_workflow_configs.json")
# Multi-config manager directory: scan this for dx_*.json files
_MGR_DIR    = os.path.join(_WORKFLOWS_DIR, "_mgr")

CURRENT_SCHEMA = 4
_META_KEY      = "_meta"

_LORA_FIELDS = ("lora_1", "lora_2", "lora_3", "lora_4", "lora_5", "lora_6", "lora_7", "lora_8")

# Purely additive field defaults per schema version (setdefault only — no structural changes).
# For structural changes (field renames, type changes, grouping), add a branch in _migrate.
_SCHEMA_DEFAULTS: dict[int, dict] = {}

_warned_missing: set = set()  # paths already logged as missing, to avoid log spam


# ── Path resolution ───────────────────────────────────────────────────────────

def _resolve_path(file: str = None) -> str:
    """Resolve a file selector to an absolute config file path.
    None / empty / '(default)' → legacy CONFIG_FILE.
    Any other value → _MGR_DIR/<basename> (must start with dx_ and end with .json)."""
    if not file or file == "(default)":
        return CONFIG_FILE
    basename = os.path.basename(file)
    if not (basename.startswith("dx_") and basename.endswith(".json")):
        raise ValueError(f"[DAZ TOOLS] Invalid config file name: {file!r}")
    return os.path.join(_MGR_DIR, basename)


# ── Core file I/O ─────────────────────────────────────────────────────────────

def _load_file(path: str) -> tuple[dict, dict, int]:
    """Load a config file. Returns (configs, meta_extra, effective_schema).
    If the file is at an older schema version it is migrated and immediately saved."""
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
    """Write configs to disk with a full _meta block."""
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
    """Scan _mgr/ for dx_*.json files. Returns [{file, name, path}] sorted by filename.
    If cls is given, only includes files that contain at least one entry of that class.
    Files that fail to load or have no matching class entries are silently excluded."""
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


# ── Schema v1 typed-object accessors ─────────────────────────────────────────
# All helpers accept either a typed wrapper object or a bare scalar so that
# legacy (pre-v1 flat) entries continue to load without a separate migration step.

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
    """Read a {"value": N} field, or fall back to a bare float."""
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

def _get_seed_randomize(val) -> bool:
    """Read the randomize flag from a {"value": N, "randomize": bool} seed object."""
    if isinstance(val, dict):
        return bool(val.get("randomize", False))
    return False

_PROMPT_TYPE_TO_INT = {"smart": 1, "beats": 2, "simple": 3}

def _get_prompt_type_int(val, default: int = 1) -> int:
    """Return 1=smart, 2=beats, 3=simple from a positive_prompt typed object."""
    t = val.get("type", "smart") if isinstance(val, dict) else "smart"
    return _PROMPT_TYPE_TO_INT.get(t, default)


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


# ── API normalisation ─────────────────────────────────────────────────────────

def _normalize_entry(entry: dict) -> dict:
    """Ensure an entry is in v1 typed-object format before sending to the JS client.
    Creates a shallow copy and upgrades any legacy flat fields — does not modify the
    original. After this, every field the JS reads is a typed object (or flat for
    scalars like 'type'), and loras live under a 'loras' dict."""
    result = dict(entry)

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

    # Ensure loras live under "loras" dict; migrate legacy top-level lora_N fields
    if not isinstance(result.get("loras"), dict):
        result["loras"] = {key: _coerce_lora(result.get(key, "")) for key in _LORA_FIELDS}
    # Remove any legacy top-level lora fields from the response
    for key in _LORA_FIELDS:
        result.pop(key, None)

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
    """Apply field defaults and structural changes for every schema version between
    from_version+1 and CURRENT_SCHEMA (inclusive).

    v1 is the base schema — no migration exists below it. Add future versions here:
      - Additive new-field defaults → _SCHEMA_DEFAULTS[N]
      - Structural changes (renames, type changes, grouping) → add an `if version == N:` branch
    """
    for version in range(from_version + 1, CURRENT_SCHEMA + 1):
        for entry in configs.values():
            for field, default in _SCHEMA_DEFAULTS.get(version, {}).items():
                entry.setdefault(field, default)
            if version == 2:
                v = entry.get("positive_prompt")
                if isinstance(v, dict):
                    if "type" not in v:
                        entry["positive_prompt"] = {**v, "type": "smart"}
                else:
                    entry["positive_prompt"] = {"text": str(v or ""), "type": "smart"}
            # v3: _meta gains name/version/created_at/updated_at — no per-entry changes.
            if version == 4:
                seed = entry.get("seed")
                if isinstance(seed, dict) and "randomize" not in seed:
                    seed["randomize"] = False
    return configs


# ── Public API ────────────────────────────────────────────────────────────────

def load_configs(file: str = None) -> dict:
    """Load configs from the given file (basename from _mgr/) or the legacy CONFIG_FILE."""
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
    return [
        {
            "label": make_label(name, entry.get("created_at", "")),
            "type":  entry.get("type", ""),
            "group": _get_name(entry.get("group", "")),
        }
        for name, entry in configs.items()
        if entry.get("class") == cls
    ]


def label_to_name(label: str, cls: str, file: str = None) -> Optional[str]:
    configs = load_configs(file)
    for name, entry in configs.items():
        if entry.get("class") == cls and make_label(name, entry.get("created_at", "")) == label:
            return name
    return None


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

    @PromptServer.instance.routes.get("/daz/workflow-config-detail")
    async def _daz_workflow_config_detail(request):
        label = request.rel_url.query.get("label", "")
        cls   = request.rel_url.query.get("class", "")
        file  = request.rel_url.query.get("file") or None

        def _find(path: str):
            cfgs, _, _ = _load_file(path)
            n = next(
                (k for k, e in cfgs.items()
                 if e.get("class") == cls and make_label(k, e.get("created_at", "")) == label),
                None,
            )
            return n, cfgs

        # Try the requested file first (guard against invalid file values from old workflows)
        try:
            requested_path = _resolve_path(file)
        except ValueError:
            requested_path = CONFIG_FILE
            file = None
        name, configs = _find(requested_path)
        source_file = file  # tracks which file actually had the config

        if name is None:
            # Fallback: search all other _mgr/ files, then the legacy file
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

        # Normalize to v1 typed-object format; strip internal fields; add name
        result = _normalize_entry(configs[name])
        result.pop("class",      None)
        result.pop("created_at", None)
        result["name"] = name
        # Tell the JS client which file the config was actually found in, so it
        # can correct its file selection when the saved workflow pointed elsewhere.
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

        label = data.get("label", "")
        cls   = data.get("class", "")
        file  = data.get("file") or None

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

        # JS sends typed objects directly; store them as-is.
        # Defensive fallback: if a bare scalar arrives (e.g. from legacy JS), wrap it.
        if "type" in data:
            entry["type"] = data["type"]   # stays flat

        for f in ("unet_high", "unet_low", "vae", "clip", "audio_vae", "checkpoint", "clip_2"):
            if f in data:
                v = data[f]
                entry[f] = v if isinstance(v, dict) else {"name": str(v or "")}

        if "group" in data:
            v = data["group"]
            entry["group"] = v if isinstance(v, dict) else {"name": str(v or "")}

        if "image_path" in data:
            v = data["image_path"]
            entry["image_path"] = v if isinstance(v, dict) else {"path": str(v or "")}

        if "filename" in data:
            v = data["filename"]
            entry["filename"] = v if isinstance(v, dict) else {"file": str(v or "")}

        for f in ("master_prompt", "positive_prompt", "negative_prompt"):
            if f in data:
                v = data[f]
                entry[f] = v if isinstance(v, dict) else {"text": str(v or "")}

        for f in ("width", "height", "steps", "split_step", "seed", "total_frames"):
            if f in data:
                v = data[f]
                if isinstance(v, dict):
                    entry[f] = v
                else:
                    try:
                        entry[f] = {"value": int(v or 0)}
                    except (ValueError, TypeError):
                        pass

        for f in ("cfg_high", "cfg_low", "fps"):
            if f in data:
                v = data[f]
                if isinstance(v, dict):
                    entry[f] = v
                else:
                    try:
                        entry[f] = {"value": float(v or 0.0)}
                    except (ValueError, TypeError):
                        pass

        # Loras: JS sends {"loras": {"lora_1": {...}}} — may be a partial update (toggle)
        # or a full set (edit form save). Merge slot-by-slot into entry["loras"].
        if "loras" in data and isinstance(data["loras"], dict):
            if not isinstance(entry.get("loras"), dict):
                # Migrate legacy top-level lora_N fields on first touch
                entry["loras"] = {key: _coerce_lora(entry.get(key, "")) for key in _LORA_FIELDS}
            for lora_key, lora_val in data["loras"].items():
                if lora_key in _LORA_FIELDS:
                    entry["loras"][lora_key] = _coerce_lora(
                        lora_val, entry["loras"].get(lora_key)
                    )
            # Clean up any legacy top-level lora fields
            for key in _LORA_FIELDS:
                entry.pop(key, None)

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
            _write_file(path, configs, meta_extra, effective)
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
        file = data.get("file") or None

        if not name:
            return web.json_response({"error": "Config name is required."}, status=400)
        if name == _META_KEY:
            return web.json_response({"error": f"'{_META_KEY}' is a reserved name."}, status=400)

        path = _resolve_path(file)
        configs, meta_extra, effective = _load_file(path)

        if name in configs:
            return web.json_response({"error": f"A config named '{name}' already exists."}, status=409)

        entry: dict = {"class": cls, "created_at": datetime.now().isoformat()}

        entry["type"] = data.get("type", "")

        for f in ("unet_high", "unet_low", "vae", "clip", "audio_vae", "checkpoint", "clip_2"):
            v = data.get(f)
            entry[f] = v if isinstance(v, dict) else {"name": str(v or "")}

        v = data.get("group")
        entry["group"] = v if isinstance(v, dict) else {"name": str(v or "")}

        v = data.get("image_path")
        entry["image_path"] = v if isinstance(v, dict) else {"path": str(v or "")}

        v = data.get("filename")
        entry["filename"] = v if isinstance(v, dict) else {"file": str(v or "")}

        for f in ("master_prompt", "positive_prompt", "negative_prompt"):
            v = data.get(f)
            entry[f] = v if isinstance(v, dict) else {"text": str(v or "")}

        for f in ("width", "height", "steps", "split_step", "seed", "total_frames"):
            v = data.get(f)
            if isinstance(v, dict):
                entry[f] = v
            else:
                try:
                    entry[f] = {"value": int(v or 0)}
                except (ValueError, TypeError):
                    entry[f] = {"value": 0}

        for f in ("cfg_high", "cfg_low", "fps"):
            v = data.get(f)
            if isinstance(v, dict):
                entry[f] = v
            else:
                try:
                    entry[f] = {"value": float(v or 0.0)}
                except (ValueError, TypeError):
                    entry[f] = {"value": 0.0}

        loras_data = data.get("loras") if isinstance(data.get("loras"), dict) else {}
        entry["loras"] = {key: _coerce_lora(loras_data.get(key, "")) for key in _LORA_FIELDS}

        configs[name] = entry

        try:
            _write_file(path, configs, meta_extra, effective)
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
        file  = data.get("file") or None

        path = _resolve_path(file)
        configs, meta_extra, effective = _load_file(path)

        name = next(
            (n for n, e in configs.items()
             if e.get("class") == cls and make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."}, status=404)

        del configs[name]

        try:
            _write_file(path, configs, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        return web.json_response({"ok": True})

except Exception:
    pass
