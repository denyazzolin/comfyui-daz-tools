# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A ComfyUI custom nodes plugin set. It lives inside a running ComfyUI installation at `ComfyUI/custom_nodes/comfyui-daz-tools/`. There is no standalone build step, test runner, or linter — the only way to exercise the code is to restart ComfyUI and use the nodes in the canvas.

## What to do when a new node is created and added to the set

Append to the string that is written in the console when the nodes are initialized in ComfyUI, adding the name of the new node as a new line

## WorkflowConfig nodes — one node per class

Each class gets its own self-contained node file (e.g. `nodes/workflow_config_wan22.py`). All nodes read the same `dx_workflow_configs.json` file from `ComfyUI/user/default/workflows/`, but each filters to only its own class. To add a new class (e.g. LTX2.3):

1. Copy `workflow_config_wan22.py` → `workflow_config_ltx23.py`, change `_CLASS`, `RETURN_TYPES`, `RETURN_NAMES`, the `load_config` return tuple, and the `_load_clip` call's `clip_type` if the new class uses a different text encoder type.
2. Register it in `nodes/__init__.py` (both mappings).
3. Add the display name to the startup log in `__init__.py`.

## what do do after you finish a writing code task

Ask me if I want you to check for errors and issues

## what to do when commiting and pushing to repositories

Do not add Claude as a contributor