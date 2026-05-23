"""
Shared helpers and REST routes for all WorkflowConfig node classes.
Imported by each class-specific node file (workflow_config_wan22.py, etc.).
Python's module cache guarantees routes are registered exactly once.
"""
import os
import json
from datetime import datetime
from typing import Optional

_NODES_DIR         = os.path.dirname(os.path.abspath(__file__))
_PLUGIN_DIR        = os.path.dirname(_NODES_DIR)
_CUSTOM_NODES_ROOT = os.path.dirname(_PLUGIN_DIR)
CONFIG_FILE        = os.path.join(_CUSTOM_NODES_ROOT, "dx_workflow_configs.json")

_missing_warned = False


def load_configs() -> dict:
    global _missing_warned
    if not os.path.exists(CONFIG_FILE):
        if not _missing_warned:
            print(f"[DAZ TOOLS] WorkflowConfig: config file not found at {CONFIG_FILE}")
            _missing_warned = True
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[DAZ TOOLS] WorkflowConfig: could not read config file — {e}")
        return {}


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
                      "master_prompt", "positive_prompt", "negative_prompt"):
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
            if new_name in configs:
                return web.json_response(
                    {"error": f"A config named '{new_name}' already exists."}, status=409
                )
            del configs[name]
            name = new_name

        entry["created_at"] = datetime.now().isoformat()
        configs[name] = entry

        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(configs, f, indent=2)
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

        configs = load_configs()
        if name in configs:
            return web.json_response({"error": f"A config named '{name}' already exists."}, status=409)

        entry = {"class": cls, "created_at": datetime.now().isoformat()}
        for field in ("unet_high", "unet_low", "vae", "clip", "image_path",
                      "master_prompt", "positive_prompt", "negative_prompt"):
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
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(configs, f, indent=2)
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
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(configs, f, indent=2)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        return web.json_response({"ok": True})

except Exception:
    pass
