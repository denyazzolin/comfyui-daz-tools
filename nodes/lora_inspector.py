import os
import json

import folder_paths

try:
    from safetensors import safe_open
    _SAFETENSORS_AVAILABLE = True
except ImportError:
    _SAFETENSORS_AVAILABLE = False


# ── Category detection ────────────────────────────────────────────────────────

def _classify(metadata: dict) -> str:
    version = (metadata.get("ss_base_model_version") or "").lower()
    model   = (metadata.get("ss_sd_model_name") or "").lower()
    sig     = version + " " + model

    if "wan" in sig:
        if "2.2" in sig:
            return "WAN2.2"
        if "2.1" in sig:
            return "WAN2.1"
    if "ltx" in sig:
        if "2.3" in sig:
            return "LTX2.3"
        if "2" in sig:
            return "LTX2"
        return "LTX"
    if "flux" in sig:
        if "klein" in sig:
            return "Flux2 Klein"
        if "2" in sig:
            return "Flux2"
        return "Flux1"
    if "chroma" in sig:
        return "Chroma"
    if "zit" in sig or "z-image" in sig or "z_image" in sig:
        return "ZIT"
    if "qwen" in sig:
        return "Qwen"
    return "Others"


# ── File helpers ──────────────────────────────────────────────────────────────

def _loras_root() -> str:
    paths = folder_paths.get_folder_paths("loras")
    return paths[0] if paths else ""


def _db_path() -> str:
    return os.path.join(_loras_root(), "dx_lora_db.json")


def _all_lora_files(root: str) -> list[str]:
    results = []
    for dirpath, _, files in os.walk(root):
        for f in files:
            if f.lower().endswith((".safetensors", ".pt")):
                results.append(os.path.join(dirpath, f))
    return sorted(results)


def _read_metadata(filepath: str) -> dict:
    if not _SAFETENSORS_AVAILABLE or not filepath.lower().endswith(".safetensors"):
        return {}
    try:
        with safe_open(filepath, framework="pt", device="cpu") as f:
            return dict(f.metadata() or {})
    except Exception:
        return {}


def _inspect(filepath: str, root: str) -> dict:
    rel   = os.path.relpath(filepath, root).replace("\\", "/")
    name  = os.path.basename(filepath)
    stat  = os.stat(filepath)
    meta  = _read_metadata(filepath)

    top_tags = []
    raw = meta.get("ss_tag_frequency")
    if raw:
        try:
            freq = json.loads(raw) if isinstance(raw, str) else raw
            merged: dict[str, int] = {}
            for subset in freq.values():
                for tag, count in subset.items():
                    merged[tag] = merged.get(tag, 0) + count
            top_tags = sorted(merged, key=lambda t: merged[t], reverse=True)[:20]
        except Exception:
            pass

    return {
        "filename":           name,
        "path":               rel,
        "category":           _classify(meta),
        "base_model_version": meta.get("ss_base_model_version", ""),
        "network_dim":        meta.get("ss_network_dim", ""),
        "network_alpha":      meta.get("ss_network_alpha", ""),
        "top_tags":           top_tags,
        "file_size_mb":       round(stat.st_size / (1024 * 1024), 2),
        "last_modified":      stat.st_mtime,
    }


# ── DB helpers ────────────────────────────────────────────────────────────────

def _load_db() -> dict:
    path = _db_path()
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_db(db: dict) -> None:
    try:
        with open(_db_path(), "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[DAZ TOOLS] LoraInspector: could not write dx_lora_db.json — {e}")


def _scan_all() -> dict:
    root = _loras_root()
    if not root:
        print("[DAZ TOOLS] LoraInspector: loras folder not found.")
        return {}
    db = {}
    for filepath in _all_lora_files(root):
        entry = _inspect(filepath, root)
        db[entry["path"]] = entry
    _save_db(db)
    return db


# ── Node ──────────────────────────────────────────────────────────────────────

class LoraInspector:
    @classmethod
    def INPUT_TYPES(cls):
        # folder_paths.get_filename_list is always up-to-date; no page reload needed
        lora_files = folder_paths.get_filename_list("loras")
        db = _load_db()

        items = []
        for rel_path in sorted(lora_files):
            key = rel_path.replace("\\", "/")
            entry = db.get(key)
            category = entry["category"] if entry else "Unknown"
            items.append(f"{category} - {key}")

        if not items:
            items = ["(no loras found)"]

        return {
            "required": {
                "lora":   (items,),
                "rescan": ("BOOLEAN", {"default": False, "label_on": "Yes", "label_off": "No"}),
            }
        }

    RETURN_TYPES  = ("STRING",)
    RETURN_NAMES  = ("lora_data",)
    FUNCTION      = "inspect"
    CATEGORY      = "utils"
    OUTPUT_NODE   = True

    def inspect(self, lora: str, rescan: bool):
        db = _load_db()

        if rescan or not db:
            print("[DAZ TOOLS] LoraInspector: scanning loras folder…")
            db = _scan_all()
            print(f"[DAZ TOOLS] LoraInspector: {len(db)} loras indexed.")

        # Label format is "Category - rel/path"; extract the path part
        rel_path = lora.split(" - ", 1)[1] if " - " in lora else lora
        selected = db.get(rel_path)

        if selected is None:
            selected = {
                "error": f"'{rel_path}' not found in database.",
                "hint":  "Enable Rescan and run again to rebuild the database.",
                "path":  rel_path,
            }

        return (json.dumps(selected, indent=2, ensure_ascii=False),)
