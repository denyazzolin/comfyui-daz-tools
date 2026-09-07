from .workflow_config_base import _EXTENDED_MEDIA_SLOTS

# The editor numbers its media slots from 1, and its first image and audio slot
# is the take's own image_path / audio_path — which the config node already puts
# on its own image and audio outputs. So the extended rows this node fans out
# start at 2 there, and at 1 for video, where there is no root slot to skip.
_LABEL_OFFSET = {"images": 1, "videos": 0, "audios": 1}


class MediaSplitter:
    """Fan a WorkflowConfig's extended_media bundle out into one output per slot.

    The config nodes carry every extra image, video and audio on a single
    extended_media link rather than a dozen sockets; this is where that link is
    unpacked. Slot numbers are fixed, so an output is always the same slot of the
    take whatever else is loaded — a slot with nothing in it hands on nothing.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "extended_media": ("DX_EXTENDED_MEDIA",),
            }
        }

    # Derived from the same slot counts the editor and the loader use, so the
    # three stay in step.
    RETURN_TYPES = (("IMAGE",) * _EXTENDED_MEDIA_SLOTS["images"]
                    + ("IMAGE",) * _EXTENDED_MEDIA_SLOTS["videos"]
                    + ("AUDIO",) * _EXTENDED_MEDIA_SLOTS["audios"])
    RETURN_NAMES = tuple(
        f"{kind[:-1]}_{i + 1 + _LABEL_OFFSET[kind]}"
        for kind in ("images", "videos", "audios")
        for i in range(_EXTENDED_MEDIA_SLOTS[kind]))
    FUNCTION     = "split"
    CATEGORY     = "utils"
    OUTPUT_NODE  = False

    # A video slot is an image batch, so its payload lives under a different key
    # than a still's.
    _PAYLOAD_KEYS = {"images": "image", "videos": "frames", "audios": "audio"}

    def split(self, extended_media=None):
        block = extended_media if isinstance(extended_media, dict) else {}
        out = []
        for kind in ("images", "videos", "audios"):
            key     = self._PAYLOAD_KEYS[kind]
            by_slot = {e.get("slot"): e.get(key)
                       for e in block.get(kind, []) if isinstance(e, dict)}
            out.extend(by_slot.get(i + 1) for i in range(_EXTENDED_MEDIA_SLOTS[kind]))
        return tuple(out)
