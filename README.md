# comfyui-daz-tools

A collection of ComfyUI custom nodes by [denyazzolin](https://github.com/denyazzolin).

## Installation

Clone this repo into your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/denyazzolin/comfyui-daz-tools
```

Then restart ComfyUI.

## Nodes

### Check Null (`utils`)
Checks whether a value is null, None, NaN, or empty.

- **Input:** any value (optional)
- **Output:** `is_null` (BOOLEAN) — `True` if the value is null/None/NaN/empty string

---

### Null Audio Checker (`audio`)
Checks if the audio output of a video loaded with [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) is null (i.e. the video had no audio track).

- **Input:** `audio` (AUDIO)
- **Output:** `is_empty` (BOOLEAN) — `True` if the audio has no samples

---

### Abs Int (`math`)
Returns the absolute value of an integer.

- **Input:** `value` (INT)
- **Output:** `abs_value` (INT)
