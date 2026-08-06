"""
Storage, CRUD helpers, and REST routes for the Prompt Stack Manager node.
Stacks are stored in dx_prompt_stacks.json (same .dx_mgr directory as
dx_workflow_configs.json), one file only — no multi-file "movie manager"
scanning like WorkflowConfig has, since prompt stacks aren't class-scoped.
"""
import os
import json
import uuid
from datetime import datetime

from .workflow_config_base import _MGR_DIR, _META_KEY, make_label

STACKS_FILE       = os.path.join(_MGR_DIR, "dx_prompt_stacks.json")
PROMPT_STACK_SCHEMA = 2
MAX_PROMPTS       = 10
EXTERNAL_PROMPT_LABEL = "External Prompt"

_warned_missing: set = set()


# ── Prompt normalisation ────────────────────────────────────────────────────

def _normalize_prompt(p) -> dict:
    """Ensure a prompt dict has label/master_prompt/positive_prompt/negative_prompt
    in typed-object form."""
    result = dict(p) if isinstance(p, dict) else {}
    result["label"] = str(result.get("label") or "")

    mp = result.get("master_prompt")
    mp = mp if isinstance(mp, dict) else {"text": str(mp or "")}
    if "position" not in mp or mp["position"] not in ("before", "after"):
        mp = {**mp, "position": "before"}
    result["master_prompt"] = {"text": str(mp.get("text") or ""), "position": mp["position"]}

    pp = result.get("positive_prompt")
    pp = pp if isinstance(pp, dict) else {"text": str(pp or "")}
    ptype = pp.get("type")
    if ptype not in ("smart", "beats", "simple", "timecode"):
        ptype = "smart"
    result["positive_prompt"] = {"text": str(pp.get("text") or ""), "type": ptype}

    np_ = result.get("negative_prompt")
    np_ = np_ if isinstance(np_, dict) else {"text": str(np_ or "")}
    result["negative_prompt"] = {"text": str(np_.get("text") or "")}

    # Numeric, per-sequence identity for a prompt slot — assigned by
    # _assign_prompt_indices, never picked here. Strip anything invalid so
    # missing/garbled values are treated as "needs an index".
    if not _has_valid_index(result):
        result.pop("index", None)

    return result


def _empty_prompt() -> dict:
    return _normalize_prompt({})


def _has_valid_index(p) -> bool:
    idx = p.get("index") if isinstance(p, dict) else None
    return isinstance(idx, int) and not isinstance(idx, bool)


def _assign_prompt_indices(prompts: list) -> bool:
    """Fill in a numeric 'index' for any prompt missing one, incrementing
    from the current max index already present in the list — new slots get
    indices departing from the max, and a deleted slot's index is only ever
    reused if it was the largest in the array (since the next assignment is
    always max+1). Returns True if any prompt was changed."""
    changed = False
    used = {p["index"] for p in prompts if _has_valid_index(p)}
    next_idx = (max(used) + 1) if used else 0
    for p in prompts:
        if not isinstance(p, dict) or _has_valid_index(p):
            continue
        p["index"] = next_idx
        used.add(next_idx)
        next_idx += 1
        changed = True
    return changed


def _backfill_ids_and_indices(stacks: dict) -> bool:
    """Ensure every stack has a unique 'id' and every prompt has a numeric
    'index'. Additive and idempotent — safe to run on every load regardless
    of the file's schema version, mirroring workflow_config_base's
    _backfill_master_position pattern (covers hand-edited files too, not
    just ones migrated from schema v1)."""
    changed = False
    for entry in stacks.values():
        if not entry.get("id"):
            entry["id"] = str(uuid.uuid4())
            changed = True
        for s in entry.get("stack", []):
            if _assign_prompt_indices(s.get("prompts", [])):
                changed = True
    return changed


def _get_int(val, default: int = 0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _get_float(val, default: float = 0.0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


# ── Core file I/O ────────────────────────────────────────────────────────────

def _load_file(path: str = STACKS_FILE) -> tuple[dict, dict, int]:
    if not os.path.exists(path):
        if path not in _warned_missing:
            print(f"[DAZ TOOLS] PromptStack: config file not found at {path}")
            _warned_missing.add(path)
        return {}, {}, PROMPT_STACK_SCHEMA
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as e:
        print(f"[DAZ TOOLS] PromptStack: could not read {os.path.basename(path)} — {e}")
        return {}, {}, PROMPT_STACK_SCHEMA

    if not isinstance(raw, dict):
        print(f"[DAZ TOOLS] PromptStack: {os.path.basename(path)} has unexpected format")
        return {}, {}, PROMPT_STACK_SCHEMA

    file_meta    = raw.get(_META_KEY, {})
    file_version = file_meta.get("schema_version", 1)
    effective    = max(file_version, PROMPT_STACK_SCHEMA)
    meta_extra   = {k: v for k, v in file_meta.items() if k != "schema_version"}
    stacks       = {k: v for k, v in raw.items() if k != _META_KEY}

    if file_version > PROMPT_STACK_SCHEMA:
        print(f"[DAZ TOOLS] PromptStack: {os.path.basename(path)} is schema v{file_version} "
              f"(node understands v{PROMPT_STACK_SCHEMA}) — skipping migration")
        return stacks, meta_extra, effective

    migrated = False
    if file_version < PROMPT_STACK_SCHEMA:
        print(f"[DAZ TOOLS] PromptStack: migrating {os.path.basename(path)} "
              f"v{file_version} → v{PROMPT_STACK_SCHEMA}")
        stacks   = _migrate(stacks, file_version)
        migrated = True

    backfilled = _backfill_ids_and_indices(stacks)

    if migrated or backfilled:
        try:
            _write_file(path, stacks, meta_extra, effective)
        except Exception as e:
            print(f"[DAZ TOOLS] PromptStack: could not write migrated prompt stack file — {e}")

    return stacks, meta_extra, effective


def _write_file(path: str, stacks: dict, meta_extra: dict, effective_schema: int) -> None:
    now = datetime.now().isoformat()
    meta: dict = {
        "schema_version": effective_schema,
        "name":           meta_extra.get("name",       "dx_prompt_stacks"),
        "version":        meta_extra.get("version",    "1.0"),
        "created_at":     meta_extra.get("created_at", now),
        "updated_at":     now,
    }
    data: dict = {_META_KEY: meta}
    data.update(stacks)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _migrate(stacks: dict, from_version: int) -> dict:
    """Additive-only, version-gated schema migration. v1 → v2 (stack 'id' and
    per-prompt 'index') is handled by the always-on _backfill_ids_and_indices
    instead of here, since that also covers files that already claim v2 but
    are missing the fields (hand-edited, or created between schema bumps).
    Kept in the same shape as workflow_config_base._migrate so future
    version-specific migrations have a place to land."""
    return stacks


# ── Sequence helpers ─────────────────────────────────────────────────────────

def _sequence_display(s: dict) -> str:
    seq  = str(s.get("sequence", ""))
    name = str(s.get("name", "")).strip()
    return f"{seq} - {name}" if name else seq


def _get_active_sequence(entry: dict, sequence: str = None) -> dict:
    """Return the sequence matching the display string, or the last sequence.
    Returns {} if the stack has none."""
    seqs = entry.get("stack")
    if not isinstance(seqs, list) or not seqs:
        return {}
    if sequence:
        raw = str(sequence).split(" - ")[0].strip()
        for s in seqs:
            if str(s.get("sequence", "")) == raw:
                return s
    return seqs[-1]


def _next_sequence(entry: dict) -> int:
    max_seq = -1
    for s in entry.get("stack", []):
        seq = s.get("sequence")
        if isinstance(seq, (int, float)):
            max_seq = max(max_seq, int(seq))
        elif isinstance(seq, str) and seq.lstrip("-").isdigit():
            max_seq = max(max_seq, int(seq))
    return max_seq + 1


def _sequence_sort_key(v: str):
    raw = v.split(" - ")[0].strip() if " - " in v else v
    return (0, int(raw), v) if raw.lstrip("-").isdigit() else (1, raw, v)


# ── Prompt (within-sequence) helpers ─────────────────────────────────────────

def _prompt_display(idx: int, p) -> str:
    label = str(p.get("label") or "").strip() if isinstance(p, dict) else ""
    return f"{idx + 1} - {label}" if label else str(idx + 1)


def _prompt_sort_key(v: str):
    if v == "All":
        return (-1, 0, v)
    raw = v.split(" - ")[0].strip() if " - " in v else v
    return (0, int(raw), v) if raw.isdigit() else (1, 0, v)


# ── Public API ────────────────────────────────────────────────────────────────

def load_stacks() -> dict:
    stacks, _, _ = _load_file()
    return stacks


def stack_labels() -> list[str]:
    stacks = load_stacks()
    return [make_label(name, entry.get("created_at", "")) for name, entry in stacks.items()]


def label_to_name(label: str) -> str | None:
    stacks = load_stacks()
    for name, entry in stacks.items():
        if make_label(name, entry.get("created_at", "")) == label:
            return name
    return None


def sequences_for_stack(label: str) -> list[str]:
    stacks = load_stacks()
    name = next(
        (n for n, e in stacks.items() if make_label(n, e.get("created_at", "")) == label),
        None,
    )
    if name is None:
        return []
    seqs = stacks[name].get("stack", [])
    return sorted({_sequence_display(s) for s in seqs}, key=_sequence_sort_key)


def all_sequences() -> list[str]:
    """Union of every sequence display string across all stacks — the static
    universe of values a combo widget can hold. Actual filtering to the
    selected stack's sequences happens client-side (mirrors how WorkflowConfig's
    'take' widget works)."""
    seen: set = {"0"}
    for entry in load_stacks().values():
        for s in entry.get("stack", []):
            seen.add(_sequence_display(s))
            seen.add(str(s.get("sequence", "")))
    return sorted(seen, key=_sequence_sort_key)


def all_prompt_labels() -> list[str]:
    """Union of every prompt display string across every stack's sequences —
    the static universe of values the 'prompt' combo widget can hold. Actual
    filtering to the active sequence's prompts happens client-side, same
    pattern as all_sequences()/'sequence'. Always includes EXTERNAL_PROMPT_LABEL
    so that value validates regardless of whether external_prompt is wired —
    the node itself raises at execution time if it's selected but unwired/empty."""
    seen: set = {"All", EXTERNAL_PROMPT_LABEL}
    for entry in load_stacks().values():
        for s in entry.get("stack", []):
            for i, p in enumerate(s.get("prompts", [])[:MAX_PROMPTS]):
                seen.add(_prompt_display(i, p))
                seen.add(str(i + 1))
    return sorted(seen, key=_prompt_sort_key)


# ── REST routes ───────────────────────────────────────────────────────────────

try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/daz/prompt-stack-list")
    async def _daz_prompt_stack_list(request):
        stacks = load_stacks()
        return web.json_response([
            {
                "label": make_label(name, entry.get("created_at", "")),
                "class": entry.get("class", ""),
                "id":    entry.get("id", ""),
            }
            for name, entry in stacks.items()
        ])

    @PromptServer.instance.routes.get("/daz/prompt-stack-sequences")
    async def _daz_prompt_stack_sequences(request):
        label = request.rel_url.query.get("label", "")
        stacks = load_stacks()
        name = next(
            (n for n, e in stacks.items() if make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Prompt stack '{label}' not found."}, status=404)
        seqs = stacks[name].get("stack", [])
        return web.json_response([
            {
                "sequence":   str(s.get("sequence", "")),
                "name":       str(s.get("name", "")),
                "created_at": s.get("created_at", ""),
                "updated_at": s.get("updated_at", ""),
                "prompt_count": len(s.get("prompts", [])),
            }
            for s in seqs
        ])

    @PromptServer.instance.routes.get("/daz/prompt-stack-detail")
    async def _daz_prompt_stack_detail(request):
        label    = request.rel_url.query.get("label", "")
        sequence = request.rel_url.query.get("sequence") or None

        stacks = load_stacks()
        name = next(
            (n for n, e in stacks.items() if make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Prompt stack '{label}' not found."}, status=404)

        entry     = stacks[name]
        active    = _get_active_sequence(entry, sequence)
        prompts   = [_normalize_prompt(p) for p in active.get("prompts", [])]
        return web.json_response({
            "name":         name,
            "id":           entry.get("id", ""),
            "class":        entry.get("class", ""),
            "fps":          _get_float(entry.get("fps")),
            "frame_count":  _get_int(entry.get("frame_count")),
            "sequence":     str(active.get("sequence", "0")),
            "seq_name":     str(active.get("name", "")),
            "prompts":      prompts,
        })

    @PromptServer.instance.routes.post("/daz/prompt-stack-create")
    async def _daz_prompt_stack_create(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        name = data.get("name", "").strip()
        cls  = data.get("class", "")
        fps  = _get_float(data.get("fps"))
        frame_count = _get_int(data.get("frame_count"))

        if not name:
            return web.json_response({"error": "Stack name is required."}, status=400)
        if name == _META_KEY:
            return web.json_response({"error": f"'{_META_KEY}' is a reserved name."}, status=400)

        stacks, meta_extra, effective = _load_file()
        if name in stacks:
            return web.json_response({"error": f"A prompt stack named '{name}' already exists."}, status=409)

        now = datetime.now().isoformat()
        initial_prompts = [_empty_prompt()]
        _assign_prompt_indices(initial_prompts)
        entry: dict = {
            "id":          str(uuid.uuid4()),
            "class":       cls,
            "created_at":  now,
            "updated_at":  now,
            "fps":         fps,
            "frame_count": frame_count,
            "stack": [{
                "sequence":   0,
                "name":       "Default Prompt Stack",
                "created_at": now,
                "updated_at": now,
                "prompts":    initial_prompts,
            }],
        }
        stacks[name] = entry

        try:
            _write_file(STACKS_FILE, stacks, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write prompt stack file: {e}"}, status=500)

        return web.json_response({"ok": True, "label": make_label(name, now), "sequence": "0"})

    @PromptServer.instance.routes.post("/daz/prompt-stack-save")
    async def _daz_prompt_stack_save(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        label      = data.get("label", "")
        sequence   = data.get("sequence")
        sequence   = str(sequence).strip() if sequence is not None else None
        save_mode  = data.get("save_mode", "current")  # "current" or "new_sequence"
        seq_name   = data.get("sequence_name")
        new_name   = data.get("new_name", "").strip()
        new_class  = data.get("class")
        new_fps    = data.get("fps")
        new_frame_count = data.get("frame_count")
        raw_prompts = data.get("prompts", [])
        if not isinstance(raw_prompts, list):
            return web.json_response({"error": "'prompts' must be a list."}, status=400)
        prompts = [_normalize_prompt(p) for p in raw_prompts[:MAX_PROMPTS]]
        _assign_prompt_indices(prompts)

        stacks, meta_extra, effective = _load_file()
        name = next(
            (n for n, e in stacks.items() if make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Prompt stack '{label}' not found."}, status=404)

        entry = stacks[name]
        now   = datetime.now().isoformat()

        if save_mode == "new_sequence":
            new_seq = _next_sequence(entry)
            new_entry_seq = {
                "sequence":   new_seq,
                "name":       str(seq_name or f"Sequence {new_seq}"),
                "created_at": now,
                "updated_at": now,
                "prompts":    prompts,
            }
            if not isinstance(entry.get("stack"), list):
                entry["stack"] = []
            entry["stack"].append(new_entry_seq)
            result_sequence = str(new_seq)
        else:
            if not isinstance(entry.get("stack"), list) or not entry["stack"]:
                entry["stack"] = [{"sequence": 0, "name": "Default Prompt Stack", "created_at": now, "updated_at": now, "prompts": []}]
            target = None
            if sequence:
                for s in entry["stack"]:
                    if str(s.get("sequence", "")) == sequence:
                        target = s
                        break
            if target is None:
                target = entry["stack"][-1]
            target["prompts"]    = prompts
            if seq_name is not None:
                target["name"] = str(seq_name)
            target["updated_at"] = now
            result_sequence = str(target.get("sequence", "0"))

        if new_class is not None:
            entry["class"] = str(new_class)
        if new_fps is not None:
            entry["fps"] = _get_float(new_fps)
        if new_frame_count is not None:
            entry["frame_count"] = _get_int(new_frame_count)

        if new_name and new_name != name:
            if new_name == _META_KEY:
                return web.json_response({"error": f"'{_META_KEY}' is a reserved name."}, status=400)
            if new_name in stacks:
                return web.json_response({"error": f"A prompt stack named '{new_name}' already exists."}, status=409)
            del stacks[name]
            name = new_name

        entry["updated_at"] = now
        stacks[name] = entry

        try:
            _write_file(STACKS_FILE, stacks, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write prompt stack file: {e}"}, status=500)

        return web.json_response({
            "ok":       True,
            "label":    make_label(name, entry["created_at"]),
            "sequence": result_sequence,
        })

    @PromptServer.instance.routes.post("/daz/prompt-stack-delete")
    async def _daz_prompt_stack_delete(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        label       = data.get("label", "")
        sequence    = data.get("sequence")
        sequence    = str(sequence).strip() if sequence is not None else None
        delete_mode = data.get("delete_mode", "stack")  # "sequence" or "stack"

        stacks, meta_extra, effective = _load_file()
        name = next(
            (n for n, e in stacks.items() if make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Prompt stack '{label}' not found."}, status=404)

        if delete_mode == "sequence":
            entry = stacks[name]
            seqs  = entry.get("stack", [])
            if not sequence:
                return web.json_response({"error": "sequence is required for delete_mode=sequence."}, status=400)
            idx = next((i for i, s in enumerate(seqs) if str(s.get("sequence", "")) == sequence), None)
            if idx is None:
                return web.json_response({"error": f"Sequence '{sequence}' not found."}, status=404)
            seqs.pop(idx)
            if not seqs:
                del stacks[name]
                try:
                    _write_file(STACKS_FILE, stacks, meta_extra, effective)
                except Exception as e:
                    return web.json_response({"error": f"Could not write prompt stack file: {e}"}, status=500)
                return web.json_response({"ok": True, "stack_deleted": True})
            entry["stack"]      = seqs
            entry["updated_at"] = datetime.now().isoformat()
        else:
            del stacks[name]

        try:
            _write_file(STACKS_FILE, stacks, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write prompt stack file: {e}"}, status=500)

        return web.json_response({"ok": True})

    @PromptServer.instance.routes.post("/daz/prompt-stack-duplicate")
    async def _daz_prompt_stack_duplicate(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON body"}, status=400)

        label          = data.get("label", "")
        new_name       = data.get("new_name", "").strip()
        duplicate_mode = data.get("duplicate_mode", "current_sequence")  # "all_sequences" or "current_sequence"
        sequence       = data.get("sequence")
        sequence       = str(sequence).strip() if sequence is not None else None

        if not new_name:
            return web.json_response({"error": "Stack name is required."}, status=400)
        if new_name == _META_KEY:
            return web.json_response({"error": f"'{_META_KEY}' is a reserved name."}, status=400)

        stacks, meta_extra, effective = _load_file()
        name = next(
            (n for n, e in stacks.items() if make_label(n, e.get("created_at", "")) == label),
            None,
        )
        if name is None:
            return web.json_response({"error": f"Prompt stack '{label}' not found."}, status=404)
        if new_name in stacks:
            return web.json_response({"error": f"A prompt stack named '{new_name}' already exists."}, status=409)

        source_entry = stacks[name]
        now = datetime.now().isoformat()

        if duplicate_mode == "all_sequences":
            new_stack = json.loads(json.dumps(source_entry.get("stack", [])))
            for s in new_stack:
                s["created_at"] = now
                s["updated_at"] = now
        else:
            active = _get_active_sequence(source_entry, sequence)
            new_seq = json.loads(json.dumps(active)) if active else {"sequence": 0, "name": "Default Prompt Stack", "prompts": []}
            new_seq["sequence"]   = 0
            new_seq["created_at"] = now
            new_seq["updated_at"] = now
            new_stack = [new_seq]

        new_entry = {
            "id":          str(uuid.uuid4()),
            "class":       source_entry.get("class", ""),
            "created_at":  now,
            "updated_at":  now,
            "fps":         _get_float(source_entry.get("fps")),
            "frame_count": _get_int(source_entry.get("frame_count")),
            "stack":       new_stack,
        }
        stacks[new_name] = new_entry

        try:
            _write_file(STACKS_FILE, stacks, meta_extra, effective)
        except Exception as e:
            return web.json_response({"error": f"Could not write prompt stack file: {e}"}, status=500)

        result_seq = str(new_stack[0].get("sequence", "0")) if new_stack else "0"
        return web.json_response({"ok": True, "label": make_label(new_name, now), "sequence": result_seq})

except Exception as e:
    print(f"[DAZ TOOLS] PromptStack: could not register REST routes — {e}")
