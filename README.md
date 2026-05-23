# comfyui-daz-tools

A collection of ComfyUI custom nodes by [deny azzolin](https://github.com/denyazzolin).

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

---

### Workflow Config WAN2.2 (`utils`)

A configuration management node for WAN 2.2 video workflows. Instead of hard-wiring model paths, dimensions, prompts, and sampling parameters directly in every workflow, you store named configurations in a shared JSON file (`custom_nodes/dx_workflow_configs.json`) and select them from a dropdown. The node loads all required models at execution time and passes every setting downstream as individual outputs — ready to wire into your samplers, encoders, and video nodes.

This makes it easy to maintain multiple presets (e.g. "720p fast", "1080p quality", "portrait short") and switch between them in one click without touching a single node connection.

#### Configuration attributes

| Attribute | Type | Description |
|---|---|---|
| `unet_high` | string | Filename of the high-quality UNet diffusion model |
| `unet_low` | string | Filename of the low-quality / draft UNet diffusion model |
| `vae` | string | Filename of the VAE model |
| `clip` | string | Filename of the text encoder (CLIP/T5) |
| `image_path` | string | Input image filename (from ComfyUI's input folder) or absolute path |
| `width` | int | Output frame width in pixels |
| `height` | int | Output frame height in pixels |
| `steps` | int | Total denoising steps |
| `split_step` | int | Step at which the sampler switches from `unet_high` to `unet_low` |
| `cfg_high` | float | CFG scale used during the high-quality pass |
| `cfg_low` | float | CFG scale used during the low-quality pass |
| `total_frames` | int | Number of video frames to generate |
| `fps` | float | Playback frame rate for the output video |
| `master_prompt` | string | A base prompt to shared across positive/negative (e.g. scene description) or as master prompt for Prompt Relays|
| `positive_prompt` | string | Positive conditioning text |
| `negative_prompt` | string | Negative conditioning text |

#### Node outputs

The node returns all attributes as individual typed outputs so they can be wired directly into the rest of your workflow:

`unet_high` · `unet_low` (MODEL) · `vae` (VAE) · `clip` (CLIP) · `image` (IMAGE) · `width` · `height` · `steps` · `split_step` · `cfg_high` · `cfg_low` · `total_frames` (INT) · `fps` (FLOAT) · `master_prompt` · `positive_prompt` · `negative_prompt` (STRING)

#### Managing configurations

The node panel has two modes:

**Use mode** — shows a summary of the selected configuration's values. A **New** button creates a fresh config; an **Edit** button switches to the form.

**Edit mode** — an inline form with dropdowns for all model files (populated live from your ComfyUI model folders), an image picker with Upload and Preview buttons, number inputs for every numeric parameter, and text areas for the three prompts. **Save** writes back to the JSON file and returns to use mode. **Cancel** discards changes. **Delete** removes the configuration after a confirmation prompt.

When no configurations exist yet (first launch or empty file), the node opens directly in edit mode with a **Create** button so you can add your first preset without leaving the canvas.

Configurations are stored in `ComfyUI/custom_nodes/dx_workflow_configs.json` and are shared across all nodes and workflows that reference them.
