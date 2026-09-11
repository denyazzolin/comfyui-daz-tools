import hashlib
import os

import numpy as np
from PIL import Image

import folder_paths

# Stills and first frames are saved no larger than this on their long side. The
# cells are a fraction of the canvas, and writing a 4K reference out full size
# on every run would cost far more than the preview ever shows.
_THUMB_SIZE = 1024


def _save_thumb(frame) -> str:
    """Write one [H, W, 3] frame to ComfyUI's temp directory as a PNG, returning
    its file name for the node to fetch through /view.

    Named by its pixels, so a take that re-runs on every queue (a randomised
    seed) finds its thumbnails already written instead of adding a set each
    time, and a name never shows the browser anything but its own picture."""
    img = Image.fromarray(np.clip(frame.cpu().numpy() * 255.0, 0, 255).astype(np.uint8))
    img.thumbnail((_THUMB_SIZE, _THUMB_SIZE))
    temp = folder_paths.get_temp_directory()
    os.makedirs(temp, exist_ok=True)   # ComfyUI clears it on startup
    digest = hashlib.sha1(img.tobytes()).hexdigest()[:20]
    name   = f"daz_media_preview_{img.width}x{img.height}_{digest}.png"
    path   = os.path.join(temp, name)
    if not os.path.exists(path):
        img.save(path, compress_level=1)
    return name


class MediaPreview:
    """Show what a WorkflowConfig's extended_media link carries, as a grid inside
    the node: every image, the first frame of every video and a note for every
    audio. A slot with nothing in it is absent from the link, so it takes no cell.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "extended_media": ("DX_EXTENDED_MEDIA",),
            }
        }

    RETURN_TYPES = ()
    FUNCTION     = "preview"
    CATEGORY     = "utils"
    OUTPUT_NODE  = True

    # The same payload keys the Media Splitter reads, in the order the cells go.
    _PAYLOAD_KEYS = {"images": "image", "videos": "frames", "audios": "audio"}

    def preview(self, extended_media=None):
        block = extended_media if isinstance(extended_media, dict) else {}
        items = []
        for kind, key in self._PAYLOAD_KEYS.items():
            for entry in block.get(kind, []):
                if not isinstance(entry, dict) or entry.get(key) is None:
                    continue
                item = {"kind": kind[:-1],
                        "name": entry.get("name") or os.path.basename(entry.get("path") or "")}
                if kind != "audios":
                    # First of the batch: a still's only image, a clip's first frame.
                    frame = entry[key][0]
                    item["width"], item["height"] = int(frame.shape[1]), int(frame.shape[0])
                    item["filename"] = _save_thumb(frame)
                items.append(item)
        return {"ui": {"media": items}}
