"""Sound Mixer: places multiple audio files at exact timestamps with per-
placement (linear) gain and mixes them down into a single AUDIO output.

`mix_state` (written entirely by web/daz_sound_mixer.js) shape:
    {
      "overall_gain": 1.0,
      "sources": {
        "<source_id>": {
          "filename": str, "label": str, "colorIndex": int,
          "crop_start_s": float, "crop_end_s": float
        }, ...
      },
      "blocks": [
        {"id": str, "source": "<source_id>", "row": int, "start_s": float, "gain": 1.0},
        ...
      ]
    }

Every filename was uploaded straight into ComfyUI's input directory by the
editor's own per-box upload button (not picked from a node combo widget), so
paths are resolved as plain files under folder_paths.get_input_directory() —
not through folder_paths.get_annotated_filepath()'s "[input]"-suffix
convention, which only applies to combo-widget selections.
"""
import json
import os

import torch
import folder_paths

from .audio_utils import decode_audio_file


def _crop_waveform(waveform, sample_rate, start_s, end_s):
    total = waveform.shape[-1]
    try:
        start_s = float(start_s or 0.0)
    except (TypeError, ValueError):
        start_s = 0.0
    try:
        end_s = float(end_s or 0.0)
    except (TypeError, ValueError):
        end_s = 0.0
    start = max(0, min(total, int(round(start_s * sample_rate))))
    end = total if end_s <= 0 else max(start, min(total, int(round(end_s * sample_rate))))
    return waveform[..., start:end]


def _resample(waveform, src_rate, dst_rate):
    if src_rate == dst_rate or waveform.shape[-1] == 0:
        return waveform
    import torch.nn.functional as F
    dst_len = max(1, round(waveform.shape[-1] * dst_rate / src_rate))
    return F.interpolate(waveform, size=dst_len, mode="linear", align_corners=False)


def _fit_channels(waveform, target_channels=2):
    c = waveform.shape[1]
    if c == target_channels:
        return waveform
    if c == 1:
        return waveform.expand(-1, target_channels, -1).contiguous()
    if c > target_channels:
        mono = waveform.mean(dim=1, keepdim=True)
        return mono.expand(-1, target_channels, -1).contiguous()
    pad = waveform[:, -1:, :].expand(-1, target_channels - c, -1)
    return torch.cat([waveform, pad], dim=1)


class SoundMixer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "duration": ("FLOAT", {"default": 10.0, "min": 0.0, "max": 3600.0, "step": 0.001}),
                "sample_rate": ("INT", {"default": 44100, "min": 8000, "max": 192000, "step": 100}),
                # A normal (not INPUT_TYPES-"hidden") STRING widget: it is
                # automatically saved with the workflow and included in the
                # prompt like any other widget value. The JS side hides its
                # widget row (widget.hidden = true, same convention already
                # used for _dazConfigFileWidget in workflow_config_shared.js)
                # so it never actually appears on the node.
                "mix_state": ("STRING", {"default": '{"overall_gain": 1.0, "sources": {}, "blocks": []}'}),
            },
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "run"
    CATEGORY = "audio"
    DESCRIPTION = (
        "Mixes multiple sound files into one AUDIO output. Use the Edit Mix "
        "button to upload files, crop each one, and place it (possibly more "
        "than once) at an exact time with its own gain."
    )

    def run(self, duration, sample_rate, mix_state="{}"):
        try:
            state = json.loads(mix_state or "{}")
        except Exception:
            state = {}
        if not isinstance(state, dict):
            state = {}

        sources = state.get("sources")
        sources = sources if isinstance(sources, dict) else {}
        blocks = state.get("blocks")
        blocks = blocks if isinstance(blocks, list) else []
        try:
            overall_gain = float(state.get("overall_gain", 1.0))
        except (TypeError, ValueError):
            overall_gain = 1.0

        duration = max(0.0, float(duration or 0.0))
        sample_rate = int(sample_rate or 44100)
        total_samples = int(round(duration * sample_rate))

        out = torch.zeros((1, 2, total_samples), dtype=torch.float32)
        decoded_cache = {}
        input_dir = folder_paths.get_input_directory()

        for block in blocks:
            if not isinstance(block, dict):
                continue
            source_id = block.get("source")
            src_info = sources.get(source_id)
            if not isinstance(src_info, dict):
                continue
            filename = os.path.basename(str(src_info.get("filename") or ""))
            if not filename:
                continue

            if source_id not in decoded_cache:
                path = os.path.join(input_dir, filename)
                if not os.path.exists(path):
                    print(f"[DAZ TOOLS] SoundMixer: '{filename}' not found, skipping")
                    decoded_cache[source_id] = None
                else:
                    try:
                        decoded_cache[source_id] = decode_audio_file(path, "SoundMixer")
                    except Exception as e:
                        print(f"[DAZ TOOLS] SoundMixer: could not decode '{filename}' — {e}")
                        decoded_cache[source_id] = None

            audio = decoded_cache[source_id]
            if audio is None or total_samples <= 0:
                continue

            wav = _crop_waveform(audio["waveform"], audio["sample_rate"],
                                  src_info.get("crop_start_s", 0.0), src_info.get("crop_end_s", 0.0))
            wav = _resample(wav, audio["sample_rate"], sample_rate)
            wav = _fit_channels(wav, 2)

            try:
                start_s = float(block.get("start_s", 0.0) or 0.0)
            except (TypeError, ValueError):
                start_s = 0.0
            start_sample = max(0, int(round(start_s * sample_rate)))
            if start_sample >= total_samples:
                continue

            length = min(wav.shape[-1], total_samples - start_sample)
            if length <= 0:
                continue

            try:
                gain = float(block.get("gain", 1.0))
            except (TypeError, ValueError):
                gain = 1.0
            gain *= overall_gain

            out[..., start_sample:start_sample + length] += wav[..., :length] * gain

        return ({"waveform": out, "sample_rate": sample_rate},)
