from .workflow_config_base import _EXTENDED_MEDIA_SLOTS, _MEDIA_ROOT_SLOTS

_KINDS = ("images", "videos", "audios")


def _slots(kind):
    """The slot numbers this node fans a kind out into, in output order.

    An extended_media row numbers itself from 1, and the take's own image_path
    and audio_path sit in front of those as slot 0. Video has no such root
    field, so it starts at 1. Adding the root count back turns a slot into the
    number the editor shows: image slot 0 is the editor's image 1.
    """
    return range(1 - _MEDIA_ROOT_SLOTS[kind], _EXTENDED_MEDIA_SLOTS[kind] + 1)


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
    RETURN_TYPES = (("IMAGE",) * len(_slots("images"))
                    + ("IMAGE",) * len(_slots("videos"))
                    + ("AUDIO",) * len(_slots("audios")))
    RETURN_NAMES = tuple(
        f"{kind[:-1]}_{s + _MEDIA_ROOT_SLOTS[kind]}"
        for kind in _KINDS for s in _slots(kind))
    FUNCTION     = "split"
    CATEGORY     = "utils"
    OUTPUT_NODE  = False

    # A video slot is an image batch, so its payload lives under a different key
    # than a still's.
    _PAYLOAD_KEYS = {"images": "image", "videos": "frames", "audios": "audio"}

    def split(self, extended_media=None):
        block = extended_media if isinstance(extended_media, dict) else {}
        out = []
        for kind in _KINDS:
            key     = self._PAYLOAD_KEYS[kind]
            by_slot = {e.get("slot"): e.get(key)
                       for e in block.get(kind, []) if isinstance(e, dict)}
            out.extend(by_slot.get(s) for s in _slots(kind))
        return tuple(out)
