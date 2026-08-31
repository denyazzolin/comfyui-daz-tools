"""Shared REST routes for the Sound Mixer node's movie panel and mix saving.
Imported once from nodes/__init__.py; Python's module cache guarantees the
routes are registered exactly once.
"""
import os
import re
import json
from datetime import datetime

from .video_utils import probe_video_file
from .workflow_config_base import _MGR_DIR

# Structure version of a saved mix file
# (.dx_mgr/sound_mixes/[<folder>/]<name>.json).
# See dx_sound_mix_setting_example.jsonc for the shape it describes.
MIX_SCHEMA = 1

# Every saved mix lives under this one folder, no matter what the user types
# in the dialog — that is what makes reading them back a single directory
# walk rather than a hunt through .dx_mgr/. The dialog's "folder" is a
# subfolder *of* this one, purely for the user's own grouping, and may be
# empty (the mix then sits directly in sound_mixes/).
MIX_ROOT_FOLDER = "sound_mixes"
MIX_ROOT_DIR = os.path.join(_MGR_DIR, MIX_ROOT_FOLDER)

# One path segment: no separators, no drive letters, no "." / ".." — so a
# folder typed into the save dialog can never escape the mix root. Everything
# outside the allowed set collapses to "_" rather than being rejected, since
# the field is free text the user types, not something they pick from a list.
_SEGMENT_OK = re.compile(r"[^A-Za-z0-9._ -]+")


def _sanitize_segment(raw: str) -> str:
    seg = _SEGMENT_OK.sub("_", str(raw or "").strip()).strip(" .")
    return seg


def _sanitize_folder(raw: str) -> str:
    """Turn arbitrary user input into a safe relative subfolder of
    sound_mixes/. Nested folders are allowed ("a/b"); empty is allowed too and
    means the mix root itself."""
    parts = [_sanitize_segment(p) for p in re.split(r"[\\/]+", str(raw or ""))]
    return "/".join(p for p in parts if p)


def _sanitize_name(raw: str) -> str:
    """Turn arbitrary user input into a safe '<name>.json' basename."""
    stem = os.path.splitext(_sanitize_segment(os.path.basename(str(raw or ""))))[0]
    stem = _sanitize_segment(stem)
    if not stem:
        raise ValueError("A name is required.")
    return f"{stem}.json"


def _mix_path(folder: str, filename: str) -> str:
    """Resolve <.dx_mgr>/sound_mixes/[<folder>/]<filename>, refusing anything
    that lands outside sound_mixes/. The segment sanitiser already makes
    traversal impossible; this is the belt-and-braces check on the resolved
    path."""
    root = os.path.realpath(MIX_ROOT_DIR)
    path = os.path.realpath(os.path.join(root, folder, filename))
    if os.path.commonpath([root, path]) != root:
        raise ValueError(f"Refusing to write outside the {MIX_ROOT_FOLDER} folder.")
    return path


try:
    from server import PromptServer
    from aiohttp import web
    import folder_paths

    @PromptServer.instance.routes.get("/daz/sound-mixer/video-info")
    async def _daz_sound_mixer_video_info(request):
        filename = os.path.basename(request.rel_url.query.get("filename", ""))
        if not filename:
            return web.json_response({"error": "filename is required"}, status=400)
        path = os.path.join(folder_paths.get_input_directory(), filename)
        if not os.path.exists(path):
            return web.json_response({"error": f"'{filename}' not found"}, status=404)
        try:
            info = probe_video_file(path, "SoundMixer")
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
        return web.json_response(info)

    @PromptServer.instance.routes.post("/daz/sound-mixer/mix-save")
    async def _daz_sound_mixer_mix_save(request):
        """Write a mix to .dx_mgr/sound_mixes/[<folder>/]<name>.json.

        The editor sends the "mix" body only; the _meta block is stamped here
        so created_at survives an overwrite. Without `overwrite` an existing
        file is reported back as a 409 rather than replaced, which is what
        drives the editor's replace/cancel prompt.
        """
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        mix = data.get("mix")
        if not isinstance(mix, dict):
            return web.json_response({"error": "'mix' must be an object"}, status=400)

        folder = _sanitize_folder(data.get("folder", ""))
        try:
            filename = _sanitize_name(data.get("name", ""))
            path = _mix_path(folder, filename)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)

        # Always shown with the mix root in front, so the message names the
        # real location even when the user left the folder box empty.
        rel = "/".join(p for p in (MIX_ROOT_FOLDER, folder, filename) if p)

        exists = os.path.exists(path)
        if exists and not data.get("overwrite"):
            return web.json_response(
                {"error": f"'{rel}' already exists.", "exists": True},
                status=409,
            )

        now = datetime.now().isoformat()
        created_at = now
        if exists:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    prev = json.load(f)
                created_at = prev.get("_meta", {}).get("created_at") or now
            except Exception:
                pass  # unreadable or hand-mangled — start its history over

        doc = {
            "_meta": {
                "schema": MIX_SCHEMA,
                "name": os.path.splitext(filename)[0],
                # The subfolder of sound_mixes/ this was saved into ("" = the
                # root). Recorded so loading a mix back can prepopulate the
                # save dialog with where it came from, without the loader
                # having to reconstruct it from the path it walked.
                "folder": folder,
                "created_at": created_at,
                "updated_at": now,
            },
            "mix": mix,
        }
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f, indent=2)
        except Exception as e:
            return web.json_response({"error": f"Could not save mix: {e}"}, status=500)

        return web.json_response({
            "ok": True,
            "folder": folder,
            "name": os.path.splitext(filename)[0],
            "file": filename,
            "rel": rel,  # sound_mixes/[<folder>/]<name>.json, for display
            "path": path,
            "replaced": exists,
        })
except Exception as e:
    print(f"[DAZ TOOLS] SoundMixer: could not register routes — {e}")
