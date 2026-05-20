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

---

### Lora Inspector (`utils`)
Scans all LoRAs in your `models/loras` folder, reads their safetensors metadata, and caches the results to `models/loras/dx_lora_db.json`. Exposes a dropdown to select any LoRA and outputs its metadata as a JSON string.

- **Inputs:**
  - `lora` — dropdown listing all detected LoRAs, prefixed by category
  - `rescan` (BOOLEAN) — set to `Yes` and run to rebuild the database
- **Output:** `lora_data` (STRING) — JSON with three sections:
  - `general`: `filename`, `path`, `category`, `base_model_version`, `network_dim`, `network_alpha`, `potential_triggerwords`, `file_size_mb`, `last_modified`
  - `extended`: `network_module`, `network_args`, `steps`, `num_epochs`, `epoch`, `resolution`, `num_train_images`, `training_comment`
  - `training`: `optimizer`, `learning_rate`, `unet_lr`, `text_encoder_lr`, `lr_scheduler`, `noise_offset`, `min_snr_gamma`, `mixed_precision`

**Categories** are inferred from the safetensors metadata (`ss_base_model_version`):

| Category | Matches |
|---|---|
| `WAN2.2` | Wan 2.2 |
| `WAN2.1` | Wan 2.1 |
| `LTX2.3` | LTX v2.3 |
| `LTX2` | LTX v2.x |
| `LTX` | LTX (any other version) |
| `Flux1` | Flux.1 |
| `Flux2` | Flux 2 |
| `Flux2 Klein` | Flux Klein (all versions) |
| `Chroma` | Chroma (all versions) |
| `ZIT` | Z-Image (all versions) |
| `Qwen` | Qwen (all versions) |
| `Others` | Anything else or missing metadata |

**First-time setup:** on the initial load all entries show as `Unknown` since the database doesn't exist yet. Tick **Rescan = Yes**, run the node once, then reload the ComfyUI page — the dropdown will show full category labels from that point on.
