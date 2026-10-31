"""Deterministic claim verification for articles (no LLM).

Checks every quote block, and every number/percentage in the article text, against the
transcript segments linked to the article (block sourceRefs, quote facts, sessions' videos).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.text_match import extract_quantities, match_quote, raw_number_claims


@dataclass
class Seg:
    id: str
    video_id: str
    start: float
    end: float
    text: str


@dataclass
class Claim:
    text: str
    kind: str  # quote | number | percentage
    status: str  # verified | not_found | partial
    location: str
    source: Seg | None = None
    note: str | None = None


def _value_matches(a: float, b: float) -> bool:
    return abs(a - b) <= max(1e-6, 0.0005 * max(abs(a), abs(b)))


def verify_article(article: dict, segments: list[Seg]) -> list[Claim]:
    """`article` uses API (camelCase) keys: headline, subheadline, kicker, intro, body[]."""
    texts = [s.text for s in segments]
    claims: list[Claim] = []

    # ---- quote blocks
    for b in article.get("body") or []:
        if b.get("kind") != "quote":
            continue
        q = (b.get("text") or "").strip().strip("“”\"")
        if not q:
            continue
        m = match_quote(q, texts)
        src = segments[m.index] if m.index is not None and m.status != "not_found" else None
        note = None if m.status == "verified" else (
            f"Closest transcript match covers {int(m.score * 100)}% of the quote." if m.status == "partial"
            else "Quote text not found in the linked transcript segments.")
        claims.append(Claim(q, "quote", m.status, f"body:{b.get('id')}", src, note))

    # ---- numbers / percentages
    seg_q = [(s, extract_quantities(s.text)) for s in segments]
    fields = [("headline", article.get("headline")), ("subheadline", article.get("subheadline")),
              ("kicker", article.get("kicker")), ("intro", article.get("intro"))]
    fields += [(f"body:{b.get('id')}", b.get("text")) for b in (article.get("body") or []) if b.get("kind") != "quote"]
    seen: set[tuple[str, str]] = set()
    for loc, text in fields:
        if not text:
            continue
        for disp, kind in raw_number_claims(text):
            key = (disp, loc)
            if key in seen:
                continue
            seen.add(key)
            q = extract_quantities(disp)
            if not q:
                continue
            target = q[0]
            exact = partial = None
            for s, qs in seg_q:
                for sq in qs:
                    if not _value_matches(sq.value, target.value):
                        continue
                    if (target.unit or None) == (sq.unit or None) or target.unit is None:
                        exact = exact or s
                    else:
                        partial = partial or s
                if exact:
                    break
            if exact:
                claims.append(Claim(disp, kind, "verified", loc, exact))
            elif partial:
                claims.append(Claim(disp, kind, "partial", loc, partial,
                                    "The value appears in the transcript but with a different unit."))
            else:
                claims.append(Claim(disp, kind, "not_found", loc, None,
                                    "This figure does not appear in the linked transcript segments."))
    return claims
