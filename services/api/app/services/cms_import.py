"""Import published copy and pictures from the Elets WordPress sites as article drafts.

A magazine issue is not only event recordings: interviews, features and news already published on the Elets
portals run in print too. An editor would open the CMS, copy the headline, standfirst and body, and download the
photograph; this does the same through each site's public WordPress REST API.

Only the sites listed in SITES are ever contacted, and pictures are only fetched from those hosts. Imported
articles arrive as drafts with no transcript sources, so they go through the same review and approval as any
other copy.

Origin: the ingester of the Magazine Autopilot pipeline.
"""

from __future__ import annotations

import html
import io
import re
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from PIL import Image, UnidentifiedImageError

from app.config import get_settings
from app.ids import new_id
from app.services.house_typography import complete_excerpt

USER_AGENT = "PressFlow/1.0 (editorial import)"

SITES: dict[str, tuple[str, str]] = {
    "egov": ("eGov", "https://egov.eletsonline.com"),
    "bfsi": ("The Banking & Finance Post", "https://bfsi.eletsonline.com"),
    "ehealth": ("eHealth", "https://ehealth.eletsonline.com"),
    "dl": ("digitalLEARNING", "https://digitallearning.eletsonline.com"),
    "brandstory": ("Elets Insights", "https://brandstory.eletsonline.com"),
}

# What an editor asks for -> (WordPress category, extra search, PressFlow article type, kicker)
KINDS: dict[str, dict[str, str]] = {
    "interview": {"label": "Interview", "category": "Interview", "type": "interview", "kicker": "Interview"},
    "government_perspective": {"label": "Government perspective", "category": "Interview",
                               "search": "Secretary OR Minister OR Commissioner OR IAS",
                               "type": "government_perspective", "kicker": "Government Perspective"},
    "article": {"label": "Feature article", "category": "Article", "type": "tech_feature", "kicker": "Feature"},
    "event_report": {"label": "Event report", "category": "Event Report", "type": "event_report",
                     "kicker": "Event Report"},
    "news": {"label": "News", "category": "News", "type": "highlights", "kicker": "News"},
    "company_profile": {"label": "Company profile", "category": "Corporate Updates", "type": "tech_feature",
                        "kicker": "Company Profile"},
}

_BOILERPLATE_START = re.compile(r"^(Also Read|Read More|Click here|Follow us|Share|Subscribe|Download|Watch:|Source:|"
                                r"Image:|Photo:|Tags?:)", re.I)
_BOILERPLATE_END = re.compile(r"(whatsapp|telegram|twitter\.com|x\.com/|facebook\.com|linkedin\.com|"
                              r"eletsonline\.com/subscri|Elets Technomedia|\bENN\b)$", re.I)
_QUESTION = re.compile(r"^(Q\.?|Question:?)\s+")


class CmsError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _site(site: str) -> tuple[str, str]:
    if site not in SITES:
        raise CmsError(f"Unknown site '{site}'. Choose one of: {', '.join(SITES)}.", status=422)
    return SITES[site]


def _kind(kind: str) -> dict[str, str]:
    if kind not in KINDS:
        raise CmsError(f"Unknown kind '{kind}'. Choose one of: {', '.join(KINDS)}.", status=422)
    return KINDS[kind]


def allowed_image_url(url: str) -> bool:
    """Pictures are only fetched over HTTPS from the Elets hosts in SITES (and their subdomains)."""
    try:
        u = urlparse(url)
    except ValueError:
        return False
    hosts = {urlparse(base).hostname for _, base in SITES.values()}
    return u.scheme == "https" and bool(u.hostname) and (u.hostname in hosts or u.hostname.endswith(".eletsonline.com"))


def _get_json(client: httpx.Client, url: str, params: dict | None = None):
    try:
        r = client.get(url, params=params)
    except httpx.HTTPError as e:
        raise CmsError(f"Couldn't reach {urlparse(url).hostname}: {e}") from e
    if r.status_code != 200:
        raise CmsError(f"{urlparse(url).hostname} answered {r.status_code}.")
    try:
        return r.json()
    except ValueError as e:
        raise CmsError(f"{urlparse(url).hostname} did not return JSON.") from e


def _client() -> httpx.Client:
    s = get_settings()
    return httpx.Client(timeout=max(20.0, s.http_timeout_seconds), headers={"User-Agent": USER_AGENT},
                        follow_redirects=False)


# ---------------------------------------------------------------------------------------------- HTML -> paragraphs

class _Text(HTMLParser):
    """HTML -> paragraphs. A paragraph that is bold throughout is a question (interview Q&A)."""

    BLOCK = {"p", "h1", "h2", "h3", "h4", "li", "blockquote", "div", "br", "tr"}
    SKIP = {"script", "style", "figure", "iframe", "noscript"}

    def __init__(self) -> None:
        super().__init__()
        self.paras: list[dict] = []
        self._buf: list[str] = []
        self._bold = 0
        self._bold_chars = 0
        self._tag = "p"
        self._skip = 0
        self._quote = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        if tag in ("strong", "b"):
            self._bold += 1
        if tag in self.BLOCK:
            self._flush()
            self._tag = tag
        if tag == "blockquote":
            self._quote += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
        if tag in ("strong", "b"):
            self._bold = max(0, self._bold - 1)
        if tag in self.BLOCK:
            self._flush()
        if tag == "blockquote":
            self._quote = max(0, self._quote - 1)

    def handle_data(self, data):
        if self._skip:
            return
        self._buf.append(data)
        if self._bold:
            self._bold_chars += len(data.strip())

    def _flush(self):
        text = re.sub(r"\s+", " ", "".join(self._buf)).strip()
        if text:
            kind = "question" if self._bold_chars >= 0.8 * len(text) and len(text) < 400 else "paragraph"
            if self._tag in ("h2", "h3", "h4"):
                kind = "subhead"
            elif self._quote or self._tag == "blockquote":
                kind = "quote"
            elif self._tag == "li":
                kind = "list_item"
            self.paras.append({"kind": kind, "text": html.unescape(text)})
        self._buf, self._bold_chars = [], 0


def html_to_blocks(raw: str) -> list[dict]:
    """Rendered post HTML -> article blocks (paragraph, subhead, quote, question, answer, list_item), with CMS
    boilerplate (share lines, "Also read", sign-offs) removed."""
    p = _Text()
    p.feed(raw or "")
    p.close()
    p._flush()
    out: list[dict] = []
    in_answer = False
    for para in p.paras:
        t, kind = para["text"], para["kind"]
        if _BOILERPLATE_START.match(t):
            continue
        if _BOILERPLATE_END.search(t) and len(t) < 160:
            continue
        if _QUESTION.match(t) and len(t) < 400:
            kind = "question"
        if kind == "question":
            t = _QUESTION.sub("", t).strip()
            if t and t[-1] not in "?.":
                t += "?"
        if len(t) < 3 or (len(t.split()) < 2 and kind != "subhead"):
            continue
        if kind == "question":
            in_answer = True
        elif kind == "subhead":
            in_answer = False
        elif kind == "paragraph" and in_answer:
            kind = "answer"
        out.append({"id": new_id("blk"), "kind": kind, "text": t})
    return out


def strip_tags(raw: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", raw or ""))).strip()


def _excerpt(post: dict) -> str:
    text = strip_tags((post.get("excerpt") or {}).get("rendered"))
    return re.sub(r"\s*\[(?:\u2026|\.\.\.)\]\s*$", "", text).strip()


# ---------------------------------------------------------------------------------------------- listing

def list_posts(site: str, kind: str, search: str | None = None, limit: int = 12) -> list[dict]:
    """Recent posts of one kind on one site, as light previews for the editor to choose from."""
    _, base = _site(site)
    spec = _kind(kind)
    limit = max(1, min(int(limit), 30))
    with _client() as client:
        params: dict[str, str] = {"per_page": str(limit), "_embed": "wp:featuredmedia", "orderby": "date",
                                  "_fields": "id,date,link,title,excerpt,content,_links,_embedded"}
        cats = _get_json(client, f"{base}/wp-json/wp/v2/categories",
                         {"per_page": "100", "search": spec["category"], "_fields": "id,name"})
        cat = next((c["id"] for c in cats if isinstance(c, dict) and c.get("name", "").lower() == spec["category"].lower()),
                   None) if isinstance(cats, list) else None
        if cat:
            params["categories"] = str(cat)
        terms = " ".join(x for x in [(search or "").strip()[:120], "" if search else spec.get("search", "")] if x)
        if terms:
            params["search"] = terms
        posts = _get_json(client, f"{base}/wp-json/wp/v2/posts", params)
    out = []
    for p in posts if isinstance(posts, list) else []:
        if not isinstance(p, dict) or "content" not in p:
            continue
        media = ((p.get("_embedded") or {}).get("wp:featuredmedia") or [{}])[0] or {}
        words = len(strip_tags(p["content"].get("rendered")).split())
        out.append({"id": int(p["id"]), "site": site, "kind": kind, "title": strip_tags(p["title"]["rendered"]),
                    "date": (p.get("date") or "")[:10], "link": p.get("link") or "", "excerpt": _excerpt(p)[:320],
                    "wordCount": words, "imageUrl": media.get("source_url") if allowed_image_url(media.get("source_url") or "") else None})
    return out


# ---------------------------------------------------------------------------------------------- one post -> draft

def fetch_post(site: str, post_id: int) -> dict:
    _, base = _site(site)
    with _client() as client:
        post = _get_json(client, f"{base}/wp-json/wp/v2/posts/{int(post_id)}", {"_embed": "1"})
    if not isinstance(post, dict) or "content" not in post:
        raise CmsError(f"Post {post_id} was not found on {site}.", status=404)
    return post


def draft_from_post(post: dict, site: str, kind: str) -> dict:
    """A WordPress post -> the fields of a PressFlow article draft, plus the pictures worth fetching."""
    magazine, _ = _site(site)
    spec = _kind(kind)
    emb = post.get("_embedded") or {}
    media = (emb.get("wp:featuredmedia") or [{}])[0] or {}
    author = next((a["name"] for a in emb.get("author") or [] if isinstance(a, dict) and a.get("name")), "")
    body = html_to_blocks(post["content"].get("rendered", ""))
    intro = _excerpt(post)
    plain = [b["text"] for b in body if b["kind"] in ("paragraph", "answer")]
    intro, _ = complete_excerpt(intro, plain)
    body = _without_repeated_intro(intro, body)
    images = []
    featured = media.get("source_url") or ""
    if allowed_image_url(featured):
        caption = strip_tags((media.get("caption") or {}).get("rendered")) or ""
        alt = strip_tags(media.get("alt_text"))
        if not caption and len(alt) > 12 and not re.search(r"\.(jpe?g|png)|chatgpt|image", alt, re.I):
            caption = alt
        images.append({"url": featured, "role": "featured", "caption": caption})
    for m in re.finditer(r'<img[^>]+src="([^"]+/wp-content/uploads/[^"]+\.(?:jpe?g|png))"', post["content"].get("rendered", ""), re.I):
        u = m.group(1)
        if allowed_image_url(u) and all(u != i["url"] for i in images) and len(images) < 4 \
                and not re.search(r"-\d+x\d+\.", u):
            images.append({"url": u, "role": "inline", "caption": ""})
    return {
        "type": spec["type"],
        "kicker": f"{spec['kicker']} · {magazine}"[:200],
        "headline": strip_tags(post["title"]["rendered"]),
        "subheadline": "",
        "byline": (author or "Elets News Network")[:300],  # page templates set the "By" themselves
        "intro": intro,
        "body": body,
        "source_url": post.get("link") or "",
        "date": (post.get("date") or "")[:10],
        "images": images,
        "word_count": sum(len(b["text"].split()) for b in body),
    }


def _without_repeated_intro(intro: str, body: list[dict]) -> list[dict]:
    """The CMS excerpt is the story's opening words, so the first paragraph starts by repeating the intro. On the
    page the intro is set as the standfirst and then the body, which would print those sentences twice: the
    repeated opening is taken off the first paragraph (and the paragraph dropped when nothing else is left)."""
    if not body or not intro or body[0]["kind"] != "paragraph":
        return body

    def key(word: str) -> str:
        return re.sub(r"\W+", "", word).lower()

    lead = [k for k in map(key, intro.split()) if k]
    words = body[0]["text"].split()
    i = matched = 0
    while i < len(words) and matched < len(lead):
        k = key(words[i])
        if k and k != lead[matched]:
            return body
        matched += 1 if k else 0
        i += 1
    if matched < len(lead):
        return body
    rest = " ".join(words[i:]).strip()
    if len(rest.split()) < 4:
        return body[1:]
    return [{**body[0], "text": rest[0].upper() + rest[1:]}, *body[1:]]


def download_image(url: str, max_bytes: int) -> tuple[bytes, int, int, str, str] | None:
    """(bytes, width, height, extension, content type) for a picture on an Elets host; None if it can't be used."""
    if not allowed_image_url(url):
        return None
    try:
        with _client() as client, client.stream("GET", url) as r:
            if r.status_code != 200:
                return None
            buf = bytearray()
            for chunk in r.iter_bytes(256 * 1024):
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    return None
        data = bytes(buf)
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
            fmt = (im.format or "").upper()
    except (httpx.HTTPError, UnidentifiedImageError, OSError, ValueError):
        return None
    known = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"), "WEBP": (".webp", "image/webp")}
    if fmt not in known:
        return None
    return data, w, h, *known[fmt]
