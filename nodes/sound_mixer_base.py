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


def _mix_rel(folder: str, filename: str) -> str:
    """Display path: sound_mixes/[<folder>/]<filename>. Always carries the mix
    root, so a message names the real location even with no subfolder."""
    return "/".join(p for p in (MIX_ROOT_FOLDER, folder, filename) if p)


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


def _mix_read_path(folder: str, name: str) -> tuple:
    """Resolve a mix the list route reported, WITHOUT running the save
    dialog's sanitiser over it, and return (folder, filename, path).

    Folders can be made by hand in a file manager with characters the dialog
    would never produce ("Scene 01 (final take)"), and rewriting them here
    would leave those mixes listed but impossible to open. Safety does not
    rest on the sanitiser anyway: the containment check on the resolved
    path is the real boundary, and the name is still pinned to a single
    .json basename.
    """
    stem = os.path.splitext(os.path.basename(str(name or "")))[0].strip()
    if not stem or stem in (".", ".."):
        raise ValueError("A name is required.")
    filename = f"{stem}.json"

    parts = [p.strip() for p in re.split(r"[\\/]+", str(folder or ""))]
    folder = "/".join(p for p in parts if p and p not in (".", ".."))

    root = os.path.realpath(MIX_ROOT_DIR)
    path = os.path.realpath(os.path.join(root, folder, filename))
    if os.path.commonpath([root, path]) != root:
        raise ValueError(f"Refusing to read outside the {MIX_ROOT_FOLDER} folder.")
    return folder, filename, path


def _migrate_mix(mix: dict, schema: int) -> dict:
    """Bring a mix body saved under an older schema up to MIX_SCHEMA.

    There is only one schema so far, so this is a pass-through; it exists as
    the single place a future bump adds its step, e.g.

        if schema < 2:
            mix["new_field"] = <default derived from the old shape>

    A migrated mix is returned to the editor as MIX_SCHEMA, so the next
    "Save Mix" writes the file back in the current shape — the upgrade lands
    on disk when the user saves, never behind their back on load.
    """
    return mix


def _validate_mix_doc(doc) -> tuple:
    """Check a file read back off disk and return (mix, schema).

    Raises ValueError with a message meant for the user. Only the structure
    the editor actually relies on is enforced — individual fields are
    re-coerced on the JS side, so a stray string in a gain does not make the
    whole mix unloadable.
    """
    if not isinstance(doc, dict):
        raise ValueError("not a mix file (expected a JSON object).")

    meta = doc.get("_meta")
    if not isinstance(meta, dict):
        raise ValueError("not a mix file (no _meta block).")

    schema = meta.get("schema")
    # bool is an int subclass, and `true` is not a version number.
    if isinstance(schema, bool) or not isinstance(schema, int) or schema < 1:
        raise ValueError(f"unrecognised schema version ({schema!r}).")
    if schema > MIX_SCHEMA:
        raise ValueError(
            f"schema {schema} was written by a newer version of this node "
            f"(this one reads up to {MIX_SCHEMA})."
        )

    mix = doc.get("mix")
    if not isinstance(mix, dict):
        raise ValueError("not a mix file (no mix block).")
    if not isinstance(mix.get("sources"), list) or not isinstance(mix.get("blocks"), list):
        raise ValueError("mix is missing its sources/blocks arrays.")

    return mix, schema


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

        rel = _mix_rel(folder, filename)

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

    @PromptServer.instance.routes.get("/daz/sound-mixer/mix-list")
    async def _daz_sound_mixer_mix_list(request):
        """Every saved mix under .dx_mgr/sound_mixes/, for the Load Mix list.

        A recursive walk, since the dialog's optional folder can nest. Only
        the path is reported — the file is not opened, so a mix that turns out
        to be unreadable is reported when it is actually picked rather than
        quietly vanishing from the list.
        """
        items = []
        if os.path.isdir(MIX_ROOT_DIR):
            for dirpath, dirnames, filenames in os.walk(MIX_ROOT_DIR):
                dirnames.sort()
                rel_dir = os.path.relpath(dirpath, MIX_ROOT_DIR)
                folder = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
                for fn in filenames:
                    if not fn.lower().endswith(".json"):
                        continue
                    items.append({
                        "folder": folder,
                        "name": os.path.splitext(fn)[0],
                        "rel": _mix_rel(folder, fn),
                    })
        items.sort(key=lambda i: (i["folder"].lower(), i["name"].lower()))
        return web.json_response(items)

    @PromptServer.instance.routes.get("/daz/sound-mixer/mix-load")
    async def _daz_sound_mixer_mix_load(request):
        """Read one mix back for the editor.

        Anything that isn't a mix this node understands comes back as a 400
        with a message the editor shows verbatim, and nothing is loaded. A
        file written under an OLDER schema is migrated here and handed over as
        MIX_SCHEMA; the upgraded shape only reaches the disk when the user
        saves it again.
        """
        q = request.rel_url.query
        try:
            folder, filename, path = _mix_read_path(q.get("folder", ""), q.get("name", ""))
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)

        rel = _mix_rel(folder, filename)
        if not os.path.isfile(path):
            return web.json_response({"error": f"'{rel}' not found."}, status=404)

        try:
            with open(path, "r", encoding="utf-8") as f:
                doc = json.load(f)
        except Exception as e:
            return web.json_response({"error": f"Could not read '{rel}': {e}"}, status=400)

        try:
            mix, schema = _validate_mix_doc(doc)
        except ValueError as e:
            return web.json_response({"error": f"'{rel}': {e}"}, status=400)

        # Where a "Save Mix" of this would actually go: the read path above
        # accepts folder names the save dialog's sanitiser would rewrite, so
        # the two can differ. The editor prepopulates from these, and only
        # skips its replace prompt when they resolve back to this same file —
        # otherwise saving could silently land on some unrelated one.
        save_folder = _sanitize_folder(folder)
        save_name = os.path.splitext(filename)[0]
        same_path = False
        try:
            save_file = _sanitize_name(save_name)
            save_name = os.path.splitext(save_file)[0]
            same_path = os.path.normcase(_mix_path(save_folder, save_file)) == os.path.normcase(path)
        except ValueError:
            save_folder, save_name = "", ""

        return web.json_response({
            "ok": True,
            "folder": folder,
            "name": os.path.splitext(filename)[0],
            "rel": rel,
            "schema": MIX_SCHEMA,
            # The version the file was actually written under, for
            # diagnostics only — the mix handed back is already migrated, so
            # the editor has nothing to do with it.
            "file_schema": schema,
            "save_folder": save_folder,
            "save_name": save_name,
            "same_path": same_path,
            "mix": _migrate_mix(mix, schema),
        })
except Exception as e:
    print(f"[DAZ TOOLS] SoundMixer: could not register routes — {e}")
