import os
import json
from datetime import datetime

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
        return "Others"
    if "ltx" in sig:
        if "2.3" in sig:
            return "LTX2.3"
        if "2" in sig:
            return "LTX2"
        return "LTX"
    if "chroma" in sig:
        return "Chroma"
    if "flux" in sig:
        if "klein" in sig:
            return "Flux2 Klein"
        if "2" in sig:
            return "Flux2"
        return "Flux1"
    if "zit" in sig or "z-image" in sig or "z_image" in sig:
        return "ZIT"
    if "qwen" in sig:
        return "Qwen"
    return "Others"


# ── File helpers ──────────────────────────────────────────────────────────────

def _loras_roots() -> list[str]:
    return folder_paths.get_folder_paths("loras") or []


def _db_path() -> str:
    roots = _loras_roots()
    return os.path.join(roots[0], "dx_lora_db.json") if roots else "dx_lora_db.json"


def _all_lora_files() -> list[tuple[str, str]]:
    """Return (filepath, root) pairs across all configured lora directories."""
    results = []
    for root in _loras_roots():
        for dirpath, _, files in os.walk(root):
            for f in files:
                if f.lower().endswith((".safetensors", ".pt")):
                    results.append((os.path.join(dirpath, f), root))
    results.sort(key=lambda x: x[0])
    return results


def _read_metadata(filepath: str) -> dict:
    if not _SAFETENSORS_AVAILABLE or not filepath.lower().endswith(".safetensors"):
        return {}
    try:
        with safe_open(filepath, framework="pt", device="cpu") as f:
            return dict(f.metadata() or {})
    except Exception:
        return {}


def _parse_network_args(meta: dict) -> dict:
    raw = meta.get("ss_network_args")
    if not raw:
        return {}
    try:
        return json.loads(raw) if isinstance(raw, str) else dict(raw)
    except Exception:
        return {}


def _inspect(filepath: str, root: str) -> dict:
    rel  = os.path.relpath(filepath, root).replace("\\", "/")
    name = os.path.basename(filepath)
    try:
        stat = os.stat(filepath)
    except OSError:
        stat = None
    meta = _read_metadata(filepath)

    potential_triggerwords = []
    raw = meta.get("ss_tag_frequency")
    if raw:
        try:
            freq = json.loads(raw) if isinstance(raw, str) else raw
            merged: dict[str, int] = {}
            for subset in freq.values():
                for tag, count in subset.items():
                    merged[tag] = merged.get(tag, 0) + count
            potential_triggerwords = sorted(merged, key=lambda t: merged[t], reverse=True)[:20]
        except Exception:
            pass

    def get(key: str) -> str:
        return meta.get(key) or ""

    return {
        "general": {
            "filename":               name,
            "path":                   rel,
            "category":               _classify(meta),
            "base_model_version":     get("ss_base_model_version"),
            "network_dim":            get("ss_network_dim"),
            "network_alpha":          get("ss_network_alpha"),
            "potential_triggerwords": potential_triggerwords,
            "file_size_mb":           round(stat.st_size / (1024 * 1024), 2) if stat else None,
            "last_modified":          stat.st_mtime if stat else None,
        },
        "extended": {
            "network_module":   get("ss_network_module"),
            "network_args":     _parse_network_args(meta),
            "steps":            get("ss_steps"),
            "num_epochs":       get("ss_num_epochs"),
            "epoch":            get("ss_epoch"),
            "resolution":       get("ss_resolution"),
            "num_train_images": get("ss_num_train_images"),
            "training_comment": get("ss_training_comment"),
        },
        "training": {
            "optimizer":         get("ss_optimizer"),
            "learning_rate":     get("ss_learning_rate"),
            "unet_lr":           get("ss_unet_lr"),
            "text_encoder_lr":   get("ss_text_encoder_lr"),
            "lr_scheduler":      get("ss_lr_scheduler"),
            "noise_offset":      get("ss_noise_offset"),
            "min_snr_gamma":     get("ss_min_snr_gamma"),
            "mixed_precision":   get("ss_mixed_precision"),
        },
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
    db["_meta"] = {"created_at": datetime.now().strftime("%m/%d/%Y %H:%M")}
    try:
        with open(_db_path(), "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[DAZ TOOLS] LoraInspector: could not write dx_lora_db.json — {e}")


def _scan_label(db: dict) -> str:
    meta = db.get("_meta", {})
    ts = meta.get("created_at", "")
    return f"Scanned on {ts}" if ts else "Not yet scanned"


def _scan_all() -> dict:
    roots = _loras_roots()
    if not roots:
        print("[DAZ TOOLS] LoraInspector: loras folder not found.")
        return {}
    db = {}
    for filepath, root in _all_lora_files():
        try:
            entry = _inspect(filepath, root)
            db[entry["general"]["path"]] = entry
        except Exception as e:
            print(f"[DAZ TOOLS] LoraInspector: skipping {filepath} — {e}")
    _save_db(db)
    return db


# ── Markdown renderer ────────────────────────────────────────────────────────

def _fmt(value) -> str:
    if value is None or value == "" or value == {}:
        return "—"
    if isinstance(value, float):
        result = f"{value:,.2f}"
    elif isinstance(value, dict):
        result = ", ".join(f"{k}: {v}" for k, v in value.items()) or "—"
    elif isinstance(value, list):
        result = ", ".join(f"`{t}`" for t in value) if value else "—"
    else:
        result = str(value)
    return result.replace("|", "\\|")


def _to_markdown(entry: dict) -> str:
    if "error" in entry:
        return f"**Error:** {entry['error']}\n\n_{entry.get('hint', '')}_"

    g = entry.get("general", {})
    e = entry.get("extended", {})
    t = entry.get("training", {})

    lines = []

    # Title
    lines.append(f"# {g.get('category', 'Unknown')} — {g.get('filename', '')}")
    lines.append("")

    # General
    lines.append("---")
    lines.append("## General")
    lines.append("")
    lines.append(f"| | |")
    lines.append(f"|:---|:---|")
    lines.append(f"| **Base Model** | {_fmt(g.get('base_model_version'))} |")
    lines.append(f"| **Rank (dim)** | {_fmt(g.get('network_dim'))} |")
    lines.append(f"| **Alpha** | {_fmt(g.get('network_alpha'))} |")
    size = g.get("file_size_mb")
    size_str = f"{_fmt(size)} MB" if size is not None else "—"
    lines.append(f"| **File Size** | {size_str} |")
    lines.append("")
    lines.append(f"**Potential Trigger Words:** {_fmt(g.get('potential_triggerwords'))}")
    lines.append("")

    # Extended
    lines.append("---")
    lines.append("## Extended")
    lines.append("")
    lines.append(f"| | |")
    lines.append(f"|:---|:---|")
    lines.append(f"| **Network Module** | {_fmt(e.get('network_module'))} |")
    lines.append(f"| **Network Args** | {_fmt(e.get('network_args'))} |")
    lines.append(f"| **Steps** | {_fmt(e.get('steps'))} |")
    lines.append(f"| **Epochs** | {_fmt(e.get('num_epochs'))} |")
    lines.append(f"| **Checkpoint Epoch** | {_fmt(e.get('epoch'))} |")
    lines.append(f"| **Resolution** | {_fmt(e.get('resolution'))} |")
    lines.append(f"| **Training Images** | {_fmt(e.get('num_train_images'))} |")
    comment = _fmt(e.get("training_comment"))
    if comment != "—":
        lines.append(f"| **Training Comment** | {comment} |")
    lines.append("")

    # Training
    lines.append("---")
    lines.append("## Training")
    lines.append("")
    lines.append(f"| | |")
    lines.append(f"|:---|:---|")
    lines.append(f"| **Optimizer** | {_fmt(t.get('optimizer'))} |")
    lines.append(f"| **Learning Rate** | {_fmt(t.get('learning_rate'))} |")
    lines.append(f"| **UNet LR** | {_fmt(t.get('unet_lr'))} |")
    lines.append(f"| **Text Encoder LR** | {_fmt(t.get('text_encoder_lr'))} |")
    lines.append(f"| **LR Scheduler** | {_fmt(t.get('lr_scheduler'))} |")
    lines.append(f"| **Noise Offset** | {_fmt(t.get('noise_offset'))} |")
    lines.append(f"| **Min SNR Gamma** | {_fmt(t.get('min_snr_gamma'))} |")
    lines.append(f"| **Mixed Precision** | {_fmt(t.get('mixed_precision'))} |")
    lines.append("")

    return "\n".join(lines)


# ── Node ──────────────────────────────────────────────────────────────────────

class LoraInspector:
    @classmethod
    def INPUT_TYPES(cls):
        db = _load_db()
        if not db:
            # Auto-scan on first load so labels are stable from the start.
            # Prevents "value not in list" errors caused by Unknown→Category transitions.
            db = _scan_all()

        lora_files = folder_paths.get_filename_list("loras")
        items = []
        for rel_path in sorted(lora_files):
            key = rel_path.replace("\\", "/")
            entry = db.get(key)
            if not isinstance(entry, dict) or "general" not in entry:
                entry = None
            category = entry["general"]["category"] if entry else "Others"
            items.append(f"{category} - {key}")

        if not items:
            items = ["(no loras found)"]

        return {
            "required": {
                "lora":   (items,),
                "rescan": ("BOOLEAN", {"default": False, "label_on": "Yes", "label_off": "No"}),
            }
        }

    RETURN_TYPES  = ("STRING", "STRING")
    RETURN_NAMES  = ("lora_data", "lora_markdown")
    FUNCTION      = "inspect"
    CATEGORY      = "utils"
    OUTPUT_NODE   = True

    def inspect(self, lora: str, rescan: bool):
        db = _load_db()

        if rescan:
            print("[DAZ TOOLS] LoraInspector: scanning loras folder…")
            db = _scan_all()
            count = sum(1 for k in db if k != "_meta")
            print(f"[DAZ TOOLS] LoraInspector: {count} loras indexed.")

        rel_path = lora.split(" - ", 1)[1] if " - " in lora else lora
        selected = db.get(rel_path)

        if selected is None:
            selected = {
                "error": f"'{rel_path}' not found in database.",
                "hint":  "Enable Rescan and run again to rebuild the database.",
                "path":  rel_path,
            }

        json_out = json.dumps(selected, indent=2, ensure_ascii=False)
        md_out   = _to_markdown(selected)

        return {
            "ui":     {"text": [_scan_label(db)]},
            "result": (json_out, md_out),
        }
