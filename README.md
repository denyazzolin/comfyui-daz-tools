# comfyui-daz-tools

ComfyUI custom nodes by [deny azzolin](https://github.com/denyazzolin).

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/denyazzolin/comfyui-daz-tools
```

Restart ComfyUI.

---

## Nodes

### Check Null (`utils`)
- **Input:** any value (optional)
- **Output:** `is_null` (BOOLEAN) — `True` if the value is null, None, NaN, or empty string

---

### Null Audio Checker (`audio`)
Checks if the audio output from [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) is null (video had no audio track).
- **Input:** `audio` (AUDIO)
- **Output:** `is_empty` (BOOLEAN)

---

### Abs Int (`math`)
- **Input:** `value` (INT)
- **Output:** `abs_value` (INT)

---

### Lora Inspector (`utils`)
Scans `models/loras`, reads safetensors metadata, and caches results to `models/loras/dx_lora_db.json`.

- **Inputs:** `lora` (dropdown, prefixed by category) · `rescan` (BOOLEAN)
- **Output:** `lora_data` (STRING) — JSON with three sections:
  - `general`: `filename`, `path`, `category`, `base_model_version`, `network_dim`, `network_alpha`, `potential_triggerwords`, `file_size_mb`, `last_modified`
  - `extended`: `network_module`, `network_args`, `steps`, `num_epochs`, `epoch`, `resolution`, `num_train_images`, `training_comment`
  - `training`: `optimizer`, `learning_rate`, `unet_lr`, `text_encoder_lr`, `lr_scheduler`, `noise_offset`, `min_snr_gamma`, `mixed_precision`

**Categories** (inferred from `ss_base_model_version`):

| Category | Matches |
|---|---|
| `WAN2.2` | Wan 2.2 |
| `WAN2.1` | Wan 2.1 |
| `LTX2.3` | LTX v2.3 |
| `LTX2` | LTX v2.x |
| `LTX` | LTX (any other) |
| `Flux1` | Flux.1 |
| `Flux2` | Flux 2 |
| `Flux2 Klein` | Flux Klein |
| `Chroma` | Chroma |
| `ZIT` | Z-Image |
| `Qwen` | Qwen |
| `Others` | Anything else or missing metadata |

**First-time setup:** entries show as `Unknown` until you tick **Rescan = Yes**, run the node once, then reload the page.

---

### Workflow Config WAN2.2 (`utils`) · Workflow Config LTX2.3 (`utils`)

Store named presets (model paths, prompts, dimensions, sampling params) in a JSON file and select them from a dropdown. The node loads all models at execution time and passes every value downstream as individual outputs.

**Storage:** `ComfyUI/user/default/workflows/dx_workflow_configs.json` (default). Additional `dx_*.json` files can be placed in `.dx_mgr/` inside that folder — a **Config file** dropdown appears when multiple files exist. Each node only shows configs of its own class.

**Custom root directory:** To store configs in a different location, create `dx_root_dir_config.json` in the plugin folder (`custom_nodes/comfyui-daz-tools/`):

```json
{
  "workflows_root_dir": "D:/path/to/your/workflows"
}
```

An annotated example is included as `dx_root_dir_config.example.jsonc`. If the file is absent or the key is empty, the default location is used.

#### Filters

| Widget | Values | Description |
|---|---|---|
| **Type** | `All` / `I2V` / `T2V` / `MULTI` | Filter by workflow type |
| **Group** | `All` / any custom label | Filter by free-form group name |

#### Shared attributes (both nodes)

| Attribute | Type | Description |
|---|---|---|
| `image_path` | string | Input image (ComfyUI input folder filename or absolute path) |
| `width` / `height` | int | Output frame dimensions |
| `steps` | int | Denoising steps |
| `seed` | int | Sampler seed. **Randomize** picks a new one on every run. |
| `total_frames` | int | Number of video frames |
| `fps` | float | Playback frame rate |
| `master_prompt` | string | Base prompt / Prompt Relay master |
| `positive_prompt` | string | Positive conditioning text. Prompt type: `smart` (relay), `beats`, or `simple`. |
| `negative_prompt` | string | Negative conditioning text |
| `lora_1`–`lora_8` | object | LoRA slot: `name`, `strength`, `enabled`. Disabled/empty slots are skipped at execution. |
| `filename` | string | Output path relative to ComfyUI's output directory |
| `type` | string | `I2V`, `T2V`, `MULTI`, or blank |
| `group` | string | Custom group label |
| `note` | string | Free-form note (max 900 chars). Shown in use mode (up to 4 lines). |
| `flag_1` / `flag_2` | bool | General-purpose boolean flags with configurable labels. Togglable from use mode. |

#### WAN2.2-specific attributes

| Attribute | Type | Description |
|---|---|---|
| `unet_high` | string | High-quality UNet diffusion model |
| `unet_low` | string | Low-quality / draft UNet diffusion model |
| `vae` | string | VAE model |
| `clip` | string | Text encoder |
| `split_step` | int | Step at which sampler switches from `unet_high` to `unet_low` |
| `cfg_high` | float | CFG scale for the high-quality pass |
| `cfg_low` | float | CFG scale for the low-quality pass |

#### WAN2.2 outputs

`unet_high` · `unet_low` (MODEL) · `vae` (VAE) · `clip` (CLIP) · `image` (IMAGE) · `width` · `height` · `steps` · `split_step` · `seed` (INT) · `cfg_high` · `cfg_low` (FLOAT) · `total_frames` (INT) · `fps` (FLOAT) · `master_prompt` · `positive_prompt` · `negative_prompt` · `filename` (STRING) · `lora_1_high` · `lora_1_low` · `lora_2_high` · `lora_2_low` · `lora_3_high` · `lora_3_low` · `lora_4_high` · `lora_4_low` (LORA) · **`unet_stack_high` · `unet_stack_low`** (MODEL) · `flag_1` · `flag_2` (BOOLEAN)

LoRAs 1–4 map to config pairs `lora_1/2`, `lora_3/4`, `lora_5/6`, `lora_7/8` as High/Low outputs. `unet_stack_high/low` are the respective UNet models with all enabled LoRAs pre-applied.

#### LTX2.3-specific attributes

| Attribute | Type | Description |
|---|---|---|
| `checkpoint` | string | Combined checkpoint (model + CLIP + VAE) |
| `unet_high` | string | Transformer/diffusion model (standalone, without checkpoint) |
| `vae` | string | Video VAE |
| `audio_vae` | string | Audio VAE |
| `clip` | string | Primary text encoder |
| `clip_2` | string | Secondary text encoder |
| `cfg` | float | CFG scale |

#### LTX2.3 outputs

`checkpoint_model` · `checkpoint_vae` · `checkpoint_clip` (CLIP) · `transformer_only` (MODEL) · `video_vae` · `audio_vae` (VAE) · `clip_2` · `clip` (CLIP) · `image` (IMAGE) · `width` · `height` · `steps` · `seed` (INT) · `cfg` (FLOAT) · `total_frames` (INT) · `fps` (FLOAT) · `master_prompt` · `positive_prompt` · `negative_prompt` · `filename` (STRING) · `lora_1`–`lora_6` (LORA) · **`transformer_stack` · `checkpoint_stack`** (MODEL) · `flag_1` · `flag_2` (BOOLEAN)

Checkpoint outputs are `None` when no checkpoint is set. `transformer_stack` / `checkpoint_stack` are the respective models with all enabled LoRAs pre-applied.

#### Versioned sets

Each named config holds one or more **versions** — independent snapshots numbered from `1`. A **Version** dropdown below the config selector switches snapshots without affecting others. The active version is serialised into the workflow file. If a version no longer exists at execution time, the node falls back to the last version in the array.

#### Managing configurations

**Use mode** — summary of the active version. LoRA enabled checkboxes and flag checkboxes save immediately without entering edit mode.

**Edit mode** — floating full-screen panel with three columns:
- **Left:** Name, Group, Type, Note · Reference image (upload/preview) · Dimensions, seed, CFG, frames, FPS
- **Center:** Prompt type (Smart / Beat / Simple) · Master, Positive, Negative prompts · Prompt Editor button
- **Right:** Model selectors · LoRA slots (name, strength, enabled) · Filename, flags

| Button | Action |
|---|---|
| **Duplicate** | Opens duplicate modal |
| **Del All** | Deletes the entire config and all versions |
| **Cancel** | Discards edits and returns to use mode |
| **Delete Version** | Deletes the current version (removes config if last) |
| **+ Version** | Saves form as a new auto-numbered version |
| **Save** | Overwrites the current version |

**Duplicate modal** options: new config with all versions · new config with current version only · new version in this config · Cancel.

**Name conflicts:** if a Save, Create, or Duplicate would clash, a popup offers **Cancel** or **Auto name** (appends `_alt` + 4 random digits and retries).

**Rename warning:** saving with a changed config name affects all versions — a confirmation popup appears before proceeding.

When no configs exist, the panel shows an empty state with a centered **Create** button.
