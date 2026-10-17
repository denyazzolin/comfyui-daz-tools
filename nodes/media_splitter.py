from .workflow_config_base import _EXTENDED_MEDIA_SLOTS, _MEDIA_ROOT_SLOTS

_KINDS = ("images", "videos", "audios")

# The longest a slot's own name is shown on its output.
_LABEL_MAX = 40


def _slots(kind):
    """The slot numbers this node fans a kind out into, in output order.

    An extended_media row numbers itself from 1, and the take's own image_path
    and audio_path sit in front of those as slot 0. Video has no such root
    field, so it starts at 1. Adding the root count back turns a slot into the
    number the editor shows: image slot 0 is the editor's image 1.
    """
    return range(1 - _MEDIA_ROOT_SLOTS[kind], _EXTENDED_MEDIA_SLOTS[kind] + 1)


def _label(kind, entry):
    """What an output is labelled with for this slot, or "" to keep its own name.

    The slot's name, cut to _LABEL_MAX. A video's own sound is the video's name
    behind "audio:", silent or not.
    """
    if not isinstance(entry, dict):
        return ""
    name = str(entry.get("name") or "").strip()[:_LABEL_MAX].strip()
    if kind == "video_audio":
        return f"audio:{name}" if name else ""
    return name


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
    # three stay in step. "preview" hands the input on untouched, behind the
    # slots so that existing links keep their indices. Typed like the input, it
    # is also the one output ComfyUI still feeds when the node is bypassed.
    # Each video slot's own sound follows it, one output per video slot.
    RETURN_TYPES = (("IMAGE",) * len(_slots("images"))
                    + ("IMAGE",) * len(_slots("videos"))
                    + ("AUDIO",) * len(_slots("audios"))
                    + ("DX_EXTENDED_MEDIA",)
                    + ("AUDIO",) * len(_slots("videos")))
    RETURN_NAMES = (tuple(
        f"{kind[:-1]}_{s + _MEDIA_ROOT_SLOTS[kind]}"
        for kind in _KINDS for s in _slots(kind)) + ("preview",)
        + tuple(f"audio_from_video{s + _MEDIA_ROOT_SLOTS['videos']}"
                for s in _slots("videos")))
    FUNCTION     = "split"
    CATEGORY     = "utils"
    OUTPUT_NODE  = False

    # A video slot is an image batch, so its payload lives under a different key
    # than a still's.
    _PAYLOAD_KEYS = {"images": "image", "videos": "frames", "audios": "audio"}

    def split(self, extended_media=None):
        block = extended_media if isinstance(extended_media, dict) else {}
        out, labels = [], []
        for kind in _KINDS:
            key     = self._PAYLOAD_KEYS[kind]
            by_slot = {e.get("slot"): e
                       for e in block.get(kind, []) if isinstance(e, dict)}
            for s in _slots(kind):
                entry = by_slot.get(s)
                out.append(entry.get(key) if entry else None)
                labels.append([f"{kind[:-1]}_{s + _MEDIA_ROOT_SLOTS[kind]}",
                               _label(kind, entry)])
        out.append(extended_media)
        videos = {e.get("slot"): e
                  for e in block.get("videos", []) if isinstance(e, dict)}
        for s in _slots("videos"):
            entry = videos.get(s)
            out.append(entry.get("audio") if entry else None)
            labels.append([f"audio_from_video{s + _MEDIA_ROOT_SLOTS['videos']}",
                           _label("video_audio", entry)])
        # An [output name, label] pair for every output but preview; the editor
        # side relabels the sockets with them once the run comes back.
        return {"ui": {"labels": labels}, "result": tuple(out)}
