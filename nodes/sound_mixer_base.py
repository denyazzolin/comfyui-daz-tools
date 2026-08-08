"""Shared REST route for the Sound Mixer node's movie panel.
Imported once from nodes/__init__.py; Python's module cache guarantees the
route is registered exactly once.
"""
import os

from .video_utils import probe_video_file

try:
    from server import PromptServer
    from aiohttp import web
    import folder_paths

    @PromptServer.instance.routes.get("/daz/sound-mixer/video-info")
    async def _daz_sound_mixer_video_info(request):
        filename = os.path.basename(request.rel_url.query.get("filename", ""))
        if not filename:
            return web.json_response({"error": "filename is required"}, status=400)
        path = os.path.join(folder_paths.get_input_directory(), filename)
        if not os.path.exists(path):
            return web.json_response({"error": f"'{filename}' not found"}, status=404)
        try:
            info = probe_video_file(path, "SoundMixer")
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
        return web.json_response(info)
except Exception as e:
    print(f"[DAZ TOOLS] SoundMixer: could not register video-info route — {e}")
