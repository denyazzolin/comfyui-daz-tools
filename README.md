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

### Workflow Config WAN2.2 (`utils`) · Workflow Config LTX2.3 (`utils`)

Configuration management nodes for WAN 2.2 and LTX 2.3 video workflows. Instead of hard-wiring model paths, dimensions, prompts, and sampling parameters directly in every workflow, you store named configurations in a shared JSON file and select them from a dropdown. Each node loads all required models at execution time and passes every setting downstream as individual outputs — ready to wire into your samplers, encoders, and video nodes.

By default both nodes read from and write to `ComfyUI/user/default/workflows/dx_workflow_configs.json`. You can also split your presets across multiple files by placing additional `dx_*.json` files inside `ComfyUI/user/default/workflows/_mgr/` — each node gains a **Config file** dropdown that lists every file containing at least one config of that class, plus `(default)` to fall back to the shared file. Each node filters the config list to only show entries that belong to its own class, so WAN2.2 and LTX2.3 presets never interfere with each other regardless of which file they live in.

This makes it easy to maintain multiple presets (e.g. "720p fast", "1080p quality", "portrait short") and switch between them in one click without touching a single node connection.

#### Filtering and organisation

Each node has two filter dropdowns above the config selector:

- **Type** — filter by `I2V` (image-to-video), `T2V` (text-to-video), or `MULTI`. Set when creating or editing a config.
- **Group** — filter by a custom group name of your choice (e.g. "characters", "landscapes", "tests"). Groups are free-form text; any value you enter becomes available as a filter option.

Both filters can be combined, and both default to `All` to show every config of that class.

#### Shared configuration attributes

These attributes are common to both nodes:

| Attribute | Type | Description |
|---|---|---|
| `image_path` | string | Input image filename (from ComfyUI's input folder) or absolute path |
| `width` | int | Output frame width in pixels |
| `height` | int | Output frame height in pixels |
| `steps` | int | Total denoising steps |
| `seed` | int | Sampler seed. Enable **Randomize** to pick a new random seed on every execution. |
| `total_frames` | int | Number of video frames to generate |
| `fps` | float | Playback frame rate for the output video |
| `master_prompt` | string | A base prompt shared across positive/negative (e.g. scene description) or as master prompt for Prompt Relays |
| `positive_prompt` | string | Positive conditioning text |
| `negative_prompt` | string | Negative conditioning text |
| `lora_1` – `lora_8` | object | Up to eight LoRA models. Each entry stores `name` (filename), `strength` (float, applied at stacking time), and `enabled` (bool). Disabled or empty-name loras are skipped entirely at execution time. |
| `filename` | string | Relative path and filename for Save Video nodes (e.g. `subfolder/my_clip`), resolved against ComfyUI's output directory |
| `type` | string | Workflow type: `I2V`, `T2V`, `MULTI`, or blank |
| `group` | string | Custom group label for filtering |
| `note` | string | Free-form text note for this config. Editable in the edit panel; displayed (up to 4 lines) below the Type row in the use panel. Max 900 characters. |
| `flag_1` / `flag_2` | bool | Two general-purpose boolean flags with configurable labels. Labels are set in edit mode; values can be toggled directly from the use-mode panel without entering edit mode. |

#### WAN2.2-specific attributes

| Attribute | Type | Description |
|---|---|---|
| `unet_high` | string | Filename of the high-quality UNet diffusion model |
| `unet_low` | string | Filename of the low-quality / draft UNet diffusion model |
| `vae` | string | Filename of the VAE model |
| `clip` | string | Filename of the text encoder |
| `split_step` | int | Step at which the sampler switches from `unet_high` to `unet_low` |
| `cfg_high` | float | CFG scale used during the high-quality pass |
| `cfg_low` | float | CFG scale used during the low-quality pass |

#### WAN2.2 outputs

`unet_high` · `unet_low` (MODEL) · `vae` (VAE) · `clip` (CLIP) · `image` (IMAGE) · `width` · `height` · `steps` · `split_step` · `seed` (INT) · `cfg_high` · `cfg_low` (FLOAT) · `total_frames` (INT) · `fps` (FLOAT) · `master_prompt` · `positive_prompt` · `negative_prompt` · `filename` (STRING) · `lora_1_high` · `lora_1_low` · `lora_2_high` · `lora_2_low` · `lora_3_high` · `lora_3_low` · `lora_4_high` · `lora_4_low` (LORA — `None` if slot is empty or disabled) · **`unet_stack_high` · `unet_stack_low`** (MODEL) · `flag_1` · `flag_2` (BOOLEAN)

LoRAs 1–4 use `lora_1`/`lora_2`, `lora_3`/`lora_4`, `lora_5`/`lora_6`, `lora_7`/`lora_8` from the config respectively, output as four High/Low pairs.

`unet_stack_high` and `unet_stack_low` are convenience outputs — the `unet_high` and `unet_low` models with all enabled LoRAs already applied at their configured strengths. Wire these directly into your sampler to skip the separate LoRA loader nodes.

#### LTX2.3-specific attributes

| Attribute | Type | Description |
|---|---|---|
| `checkpoint` | string | Filename of a combined checkpoint (loads model, CLIP, and VAE in one) |
| `unet_high` | string | Filename of the transformer/diffusion model (used standalone, without checkpoint) |
| `vae` | string | Filename of the video VAE model |
| `audio_vae` | string | Filename of the audio VAE model |
| `clip` | string | Filename of the primary text encoder |
| `clip_2` | string | Filename of the secondary text encoder |
| `cfg` | float | CFG scale |

#### LTX2.3 outputs

`checkpoint_model` · `checkpoint_vae` · `checkpoint_clip` (from checkpoint) · `transformer_only` (MODEL) · `video_vae` · `audio_vae` (VAE) · `clip_2` · `clip` (CLIP) · `image` (IMAGE) · `width` · `height` · `steps` · `seed` (INT) · `cfg` (FLOAT) · `total_frames` (INT) · `fps` (FLOAT) · `master_prompt` · `positive_prompt` · `negative_prompt` · `filename` (STRING) · `distillation_lora` · `lora_2` – `lora_6` (LORA — `None` if slot is empty or disabled) · **`transformer_stack` · `checkpoint_stack`** (MODEL) · `flag_1` · `flag_2` (BOOLEAN)

Checkpoint outputs (`checkpoint_model`, `checkpoint_vae`, `checkpoint_clip`) are all `None` when no checkpoint is set; individual model outputs are `None` when their respective fields are empty.

`transformer_stack` and `checkpoint_stack` are convenience outputs — the `transformer_only` and `checkpoint_model` with all enabled LoRAs already applied at their configured strengths. Wire these directly into your sampler to skip the separate LoRA loader nodes.

#### Versioned sets

Every named config is a container that holds one or more **versions** — independent snapshots of all model and parameter values. Versions are numbered automatically starting at `1`; you can accumulate as many as you like under a single config name without cluttering the config list.

A **Version** dropdown sits directly below the **Config** selector. Changing it reloads the detail panel with that snapshot's values without affecting any other version. The selected version is serialised into the workflow file, so the node always wakes up with the exact version that was active when you saved.

At execution time the node reads the selected version's values from disk. If the version no longer exists (e.g. you deleted it from the JSON directly) it falls back to the last version in the array.

#### Managing configurations

The node panel has two modes:

**Use mode** — shows a summary of the active version's values. A **New** button creates a fresh config; an **Edit** button opens the edit form for the current version. The note (if set) is shown below the Type row, truncated to four lines. Each LoRA checkbox and both flag checkboxes can be toggled directly from use mode — the change saves to the current version immediately, no edit mode needed.

**Edit mode** — an inline form with dropdowns for all model files and LoRAs (populated live from your ComfyUI model folders), a strength input and enabled checkbox per LoRA slot, an image picker with Upload and Preview buttons, number inputs for every numeric parameter, a **Randomize** checkbox on the seed field, a **Note** textarea (max 900 characters with a **clear** button), text areas for the three prompts, and label/value inputs for the two flags. The header shows which version you are editing.

The bottom bar contains two groups of buttons:

| Button | Action |
|---|---|
| **Duplicate** | Opens a four-option modal (see below) |
| **Del All** | Deletes the entire config and all its versions after confirmation |
| **Del Version** | Deletes only the currently viewed version. If it is the last version, the whole config is removed |
| **Cancel** | Discards unsaved edits and returns to use mode |
| **+ Version** | Saves the current form as a new version with an auto-incremented number and returns to use mode |
| **Save** | Overwrites the current version with the form values and returns to use mode |

When no configurations exist (first launch or empty file), the node opens directly in edit mode with a **Create** button so you can add your first preset without leaving the canvas.

#### Duplicate options

Clicking **Duplicate** opens a modal with a name field (pre-filled with `Copy of <config name>`) and four choices:

- **Duplicate as a new config with all versions** — copies the entire config, preserving every version, under the name you provide.
- **Duplicate as a new config with the current version** — creates a new config containing only the version currently in view, reset to version `1`.
- **Duplicate as a new version in this config** — saves the current form as a new auto-incremented version inside the same config (equivalent to **+ Version**).
- **Cancel** — closes the modal with no changes.

#### Naming and name conflicts

Config names must be unique within a file. If a **Save** (rename), **Create**, or **Duplicate** operation would produce a name clash, a popup appears with two options:

- **Cancel** — closes the popup and returns to the form with no changes made.
- **Auto name** — appends `_alt` followed by a random four-digit number to the name you typed (e.g. `my config_alt3742`), then retries automatically. If the auto-generated name still clashes (rare), click **Auto name** again.
