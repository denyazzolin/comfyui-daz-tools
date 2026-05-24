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

CURRENT_SCHEMA = 8
_META_KEY      = "_meta"

# Fields added per schema version (additive only — used for automatic migration).
_SCHEMA_DEFAULTS: dict[int, dict] = {
    2: {"lora_1": "", "lora_2": "", "lora_3": "", "lora_4": ""},
    3: {"lora_5": "", "lora_6": ""},
    4: {"audio_vae": ""},
    5: {"type": ""},
    6: {"group": ""},
    7: {"filename": ""},
    8: {"checkpoint": ""},
}

_missing_warned = False


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


def _migrate(configs: dict, from_version: int) -> dict:
    """Apply default values for every schema version between from_version+1 and CURRENT_SCHEMA."""
    for version in range(from_version + 1, CURRENT_SCHEMA + 1):
        for entry in configs.values():
            for field, default in _SCHEMA_DEFAULTS.get(version, {}).items():
                entry.setdefault(field, default)
    return configs


def _save_configs(configs: dict) -> None:
    """Write configs to disk prefixed with the current schema meta block."""
    data: dict = {_META_KEY: {"schema_version": CURRENT_SCHEMA}}
    data.update(configs)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def load_configs() -> dict:
    global _missing_warned
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
    configs = {k: v for k, v in raw.items() if k != _META_KEY}

    if file_version < CURRENT_SCHEMA:
        print(f"[DAZ TOOLS] WorkflowConfig: migrating schema v{file_version} → v{CURRENT_SCHEMA}")
        configs = _migrate(configs, file_version)
        try:
            _save_configs(configs)
        except Exception as e:
            print(f"[DAZ TOOLS] WorkflowConfig: could not write migrated config — {e}")

    return configs


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
            "type":  entry.get("type",  ""),
            "group": entry.get("group", ""),
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
        entry = configs[name]
        result = {k: v for k, v in entry.items() if k not in ("class", "created_at")}
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
        for field in ("unet_high", "unet_low", "vae", "clip", "image_path",
                      "master_prompt", "positive_prompt", "negative_prompt",
                      "lora_1", "lora_2", "lora_3", "lora_4", "lora_5", "lora_6",
                      "audio_vae", "type", "group", "filename", "checkpoint"):
            if field in data:
                entry[field] = data[field]
        for field in ("width", "height", "steps", "split_step", "total_frames"):
            if field in data:
                try:
                    entry[field] = int(data[field])
                except (ValueError, TypeError):
                    pass
        for field in ("fps", "cfg_high", "cfg_low"):
            if field in data:
                try:
                    entry[field] = float(data[field])
                except (ValueError, TypeError):
                    pass

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
        for field in ("unet_high", "unet_low", "vae", "clip", "image_path",
                      "master_prompt", "positive_prompt", "negative_prompt",
                      "lora_1", "lora_2", "lora_3", "lora_4", "lora_5", "lora_6",
                      "audio_vae", "type", "group", "filename", "checkpoint"):
            entry[field] = data.get(field, "")
        for field in ("width", "height", "steps", "split_step", "total_frames"):
            try:
                entry[field] = int(data.get(field, 0))
            except (ValueError, TypeError):
                entry[field] = 0
        for field in ("fps", "cfg_high", "cfg_low"):
            try:
                entry[field] = float(data.get(field, 0.0))
            except (ValueError, TypeError):
                entry[field] = 0.0

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
