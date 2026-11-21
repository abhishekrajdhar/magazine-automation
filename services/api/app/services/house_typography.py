"""House typography: the bulk copy corrections a sub-editor makes before a page is set.

Deterministic, no model involved. Each rule reports how many changes it made so an editor sees what will change
before applying it. The rules only touch typography (spaces, quotation marks, dashes, the ellipsis, the rupee sign,
"per cent"); they never change a word, so claim verification, which compares normalised text, is unaffected.

Origin: the copy desk rules of the Magazine Autopilot pipeline.
"""

from __future__ import annotations

import re
from typing import Callable

Rule = Callable[[str], tuple[str, int]]


def _smart_double(t: str) -> tuple[str, int]:
    out, n, open_q = [], 0, True
    for i, ch in enumerate(t):
        if ch == '"':
            prev = t[i - 1] if i else " "
            open_q = prev.isspace() or prev in "([{\u2014\u2013"
            out.append("\u201c" if open_q else "\u201d")
            n += 1
        else:
            out.append(ch)
    return "".join(out), n


RULES: list[tuple[str, Rule]] = [
    ("double spaces", lambda t: re.subn(r"[ \t]{2,}", " ", t)),
    ("space before punctuation", lambda t: re.subn(r"(?<=\S)[ \t]+([,.;:!?])(?=\s|$)", r"\1", t)),
    ("straight double quotes", _smart_double),
    ("apostrophes", lambda t: re.subn(r"(?<=\w)'(?=\w)", "\u2019", t)),
    ("opening single quotes", lambda t: re.subn(r"(^|[\s(\[\u201c])'(?=\S)", "\\1\u2018", t)),
    ("closing single quotes", lambda t: re.subn(r"'", "\u2019", t)),
    ("three dots to an ellipsis", lambda t: re.subn(r"\.{3,}", "\u2026", t)),
    ("hyphen between numbers to an en dash", lambda t: re.subn(r"(?<=\d)\s?-\s?(?=\d)", "\u2013", t)),
    ("spaced hyphen to an en dash", lambda t: re.subn(r"(?<=\S)[ \t]+-[ \t]+(?=\S)", " \u2013 ", t)),
    ("double hyphen to an en dash", lambda t: re.subn(r"--", "\u2013", t)),
    ("space after the rupee sign", lambda t: re.subn(r"\u20b9\s+(?=\d)", "\u20b9", t)),
    ("percent to per cent", lambda t: re.subn(r"\bpercent\b", "per cent", t)),
    ("trailing spaces", lambda t: re.subn(r"[ \t]+$", "", t, flags=re.M)),
]


def normalise(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    for name, fn in RULES:
        text, n = fn(text)
        if n:
            counts[name] = counts.get(name, 0) + n
    return text.strip(), counts


def complete_excerpt(intro: str, paragraphs: list[str]) -> tuple[str, str | None]:
    """A CMS excerpt is the first N words of the story with the tail cut off, so it often stops mid-sentence.

    When the opening paragraph carries the whole sentence the intro becomes that sentence; otherwise a trailing
    fragment after a complete sentence is dropped. Returns (intro, what was done or None)."""
    t = intro.strip()
    if not t or t[-1] in ".!?\u201d\u2019\"":
        return intro, None
    head = re.sub(r"\W+", " ", t[:80]).strip().lower()
    for para in paragraphs:
        p = para.strip()
        if head and re.sub(r"\W+", " ", p[:80]).strip().lower().startswith(head[:60]):
            m = re.match(r"(.+?[.!?])(?=\s|$)", p[max(0, len(t) - 20):]) if len(p) > len(t) else None
            if m:
                full = p[:max(0, len(t) - 20)] + m.group(1)
                if len(full) <= 260:
                    return full.strip(), "intro completed from the opening paragraph"
            break
    m2 = re.match(r"^(.*?[.!?])(?:[\u201d\u2019\"]?)\s+\S", t)
    if m2 and len(m2.group(1)) >= 60:
        return m2.group(1).strip(), "trailing fragment dropped from the intro"
    return intro, None


def normalise_article(fields: dict) -> tuple[dict, dict[str, int]]:
    """Apply the rules to an article's copy. `fields` holds kicker, headline, subheadline, byline, intro and body
    (list of blocks); returns (changed fields only, counts per rule)."""
    total: dict[str, int] = {}
    changed: dict = {}

    def bump(counts: dict[str, int]) -> None:
        for k, v in counts.items():
            total[k] = total.get(k, 0) + v

    for key in ("kicker", "headline", "subheadline", "byline", "intro"):
        if fields.get(key):
            new, counts = normalise(fields[key])
            if new != fields[key]:
                changed[key] = new
                bump(counts)
    body = []
    body_changed = False
    for block in fields.get("body") or []:
        new, counts = normalise(block.get("text") or "")
        if new != (block.get("text") or ""):
            body_changed = True
            bump(counts)
            block = {**block, "text": new}
        body.append(block)
    if body_changed:
        changed["body"] = body
    return changed, total
