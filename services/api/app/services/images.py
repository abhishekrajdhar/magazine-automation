"""AI image generation (OpenAI-compatible /images/generations).

Generated images are always labelled as AI-generated on the asset (tag + credit). The prompt framing keeps them to
editorial illustration: no text baked into the picture (cover lines and captions stay live text) and no real,
identifiable people (speakers must be shown with real photographs).
"""

from __future__ import annotations

import base64
import io

import httpx
from PIL import Image

from app.config import get_settings

ASPECT_SIZES = {"portrait": "1024x1536", "landscape": "1536x1024", "square": "1024x1024"}
AI_TAG = "ai-generated"
FRAMING = ("Editorial image for a printed news magazine. Do not include any text, lettering, logos, watermarks or "
           "captions. Do not depict real, identifiable people; any people shown must be anonymous. ")


class ImageGenError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def configured() -> tuple[bool, str]:
    s = get_settings()
    if s.image_provider == "none":
        return False, "IMAGE_PROVIDER=none: AI image generation is switched off."
    if not s.openai_api_key:
        return False, "AI images need OPENAI_API_KEY (OpenAI-compatible /images/generations)."
    return True, f"{s.image_model} via {s.openai_base_url}"


def generate(prompt: str, aspect: str) -> tuple[bytes, int, int]:
    """Returns (png_bytes, width, height). Raises ImageGenError with a message fit for the editor."""
    s = get_settings()
    ok, detail = configured()
    if not ok:
        raise ImageGenError(detail, status=503)
    size = ASPECT_SIZES.get(aspect)
    if size is None:
        raise ImageGenError(f"aspect must be one of {', '.join(ASPECT_SIZES)}", status=422)
    try:
        r = httpx.post(
            f"{s.openai_base_url.rstrip('/')}/images/generations",
            headers={"Authorization": f"Bearer {s.openai_api_key}"},
            json={"model": s.image_model, "prompt": FRAMING + prompt.strip(), "size": size, "quality": s.image_quality,
                  "n": 1},
            timeout=s.image_timeout_seconds,
        )
    except httpx.HTTPError as e:
        raise ImageGenError(f"Couldn't reach the image service: {e}") from e
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message") or r.text[:300]
        except ValueError:
            msg = r.text[:300]
        # 400 is usually the provider's content policy or a bad parameter: the editor can rephrase.
        raise ImageGenError(f"The image service refused the request: {msg}", status=422 if r.status_code == 400 else 502)
    item = (r.json().get("data") or [{}])[0]
    if item.get("b64_json"):
        raw = base64.b64decode(item["b64_json"])
    elif item.get("url"):
        raw = httpx.get(item["url"], timeout=s.image_timeout_seconds).content
    else:
        raise ImageGenError("The image service returned no image.")
    with Image.open(io.BytesIO(raw)) as im:
        w, h = im.size
        if im.format != "PNG":
            buf = io.BytesIO()
            im.save(buf, "PNG")
            raw = buf.getvalue()
    return raw, w, h
