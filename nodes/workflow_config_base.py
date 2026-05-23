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

_IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'}

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
        name  = label_to_name(label, cls)
        if name is None:
            return web.json_response({"error": f"Config '{label}' not found."})
        entry = load_configs().get(name, {})
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
            files = fp.get_filename_list(folder)
            return web.json_response(sorted(files))
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/daz/browse-path")
    async def _daz_browse_path(request):
        path = request.rel_url.query.get("path", "").strip()

        if not path:
            if os.name == "nt":
                import string
                drives = [f"{d}:\\" for d in string.ascii_uppercase
                          if os.path.exists(f"{d}:\\")]
                return web.json_response({"path": "", "parent": None, "dirs": drives, "files": []})
            else:
                path = "/"

        if not os.path.isdir(path):
            return web.json_response({"error": f"Not a directory: {path}"}, status=400)

        try:
            entries = os.listdir(path)
        except PermissionError:
            return web.json_response({"error": "Permission denied"}, status=403)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

        dirs = sorted([
            os.path.join(path, e) for e in entries
            if os.path.isdir(os.path.join(path, e))
        ])
        files = sorted([
            os.path.join(path, e) for e in entries
            if os.path.isfile(os.path.join(path, e))
            and os.path.splitext(e)[1].lower() in _IMAGE_EXTS
        ])

        parent_path = os.path.dirname(path)
        if parent_path == path:
            parent = "" if os.name == "nt" else None
        else:
            parent = parent_path

        return web.json_response({"path": path, "parent": parent, "dirs": dirs, "files": files})

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
        for field in ("unet_high", "unet_low", "vae", "clip", "image_path"):
            if field in data:
                entry[field] = data[field]
        for field in ("width", "height", "steps", "split_step"):
            if field in data:
                try:
                    entry[field] = int(data[field])
                except (ValueError, TypeError):
                    pass

        entry["created_at"] = datetime.now().isoformat()

        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(configs, f, indent=2)
        except Exception as e:
            return web.json_response({"error": f"Could not write config file: {e}"}, status=500)

        new_label = make_label(name, entry["created_at"])
        return web.json_response({"ok": True, "label": new_label})

except Exception:
    pass
