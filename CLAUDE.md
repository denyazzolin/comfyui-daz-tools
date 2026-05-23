# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A ComfyUI custom nodes plugin set. It lives inside a running ComfyUI installation at `ComfyUI/custom_nodes/comfyui-daz-tools/`. There is no standalone build step, test runner, or linter — the only way to exercise the code is to restart ComfyUI and use the nodes in the canvas.

## What to do when a new node is created and added to the set

Append to the string that is written in the console when the nodes are initialized in ComfyUI, adding the name of the new node as a new line

## what do do after you finish a writing code task

Ask me if I want you to check for errors and issues