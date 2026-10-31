"""Deterministic text normalisation + matching used for quote provenance and claim verification."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_PUNCT = re.compile(r"[^\w\s%.]", re.UNICODE)
_WS = re.compile(r"\s+")
FILLERS = {"um", "uh", "erm", "er", "ah", "hmm", "mm"}


def normalise(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").lower()
    t = t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = t.replace("per cent", "percent").replace("%", " percent ")
    t = re.sub(r"(?<=\d),(?=\d)", "", t)  # 1,200 -> 1200
    t = _PUNCT.sub(" ", t)
    t = re.sub(r"\.(?!\d)", " ", t)  # drop sentence dots, keep decimals
    words = [w for w in _WS.split(t) if w and w not in FILLERS]
    return " ".join(words)


def tokens(text: str) -> list[str]:
    return normalise(text).split()


@dataclass
class MatchResult:
    status: str  # verified | partial | not_found
    score: float
    index: int | None = None  # index of the best-matching segment


def match_quote(quote: str, segment_texts: list[str], window: int = 3) -> MatchResult:
    """Find `quote` in the transcript.

    verified  = normalised quote appears verbatim inside a window of up to `window` consecutive segments.
    partial   = >= 60% of the quote's tokens appear as one contiguous run (or >= 80% in order within a window).
    not_found = otherwise.
    """
    q = normalise(quote)
    if not q:
        return MatchResult("not_found", 0.0)
    qt = q.split()
    norm = [normalise(s) for s in segment_texts]
    best = MatchResult("not_found", 0.0)
    for i in range(len(norm)):
        joined = " ".join(norm[i:i + window])
        if f" {q} " in f" {joined} ":
            # attribute to the first segment containing the start of the quote
            start = i
            for j in range(i, min(len(norm), i + window)):
                if qt[0] in norm[j].split():
                    start = j
                    break
            return MatchResult("verified", 1.0, start)
        run = _longest_common_run(qt, joined.split())
        score = run / len(qt)
        if score > best.score:
            best = MatchResult("partial" if score >= 0.6 else "not_found", round(score, 2), i)
    if best.status == "not_found" and best.score < 0.6:
        # ordered-subsequence fallback (handles inserted fillers / minor edits)
        for i in range(len(norm)):
            joined = " ".join(norm[i:i + window]).split()
            sub = _subsequence_ratio(qt, joined)
            if sub >= 0.8 and sub > best.score:
                best = MatchResult("partial", round(sub, 2), i)
    return best


def _longest_common_run(a: list[str], b: list[str]) -> int:
    if not a or not b:
        return 0
    best = 0
    prev = [0] * (len(b) + 1)
    for i in range(1, len(a) + 1):
        cur = [0] * (len(b) + 1)
        ai = a[i - 1]
        for j in range(1, len(b) + 1):
            if ai == b[j - 1]:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best:
                    best = cur[j]
        prev = cur
    return best


def _subsequence_ratio(q: list[str], t: list[str]) -> float:
    if not q:
        return 0.0
    k = 0
    for w in t:
        if k < len(q) and w == q[k]:
            k += 1
    return k / len(q)


# ---------------------------------------------------------------- numbers

UNITS = {
    "percent": "percent", "%": "percent", "per": None,
    "crore": "crore", "crores": "crore", "cr": "crore",
    "lakh": "lakh", "lakhs": "lakh", "lac": "lakh",
    "million": "million", "mn": "million", "billion": "billion", "bn": "billion",
    "thousand": "thousand", "trillion": "trillion",
}
NUM_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?:\s*(percent|crores?|cr|lakhs?|lac|million|mn|billion|bn|thousand|trillion))?(?![\w])")

_ONES = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
         "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
         "seventeen": 17, "eighteen": 18, "nineteen": 19}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_SCALE = {"hundred": 100}


@dataclass(frozen=True)
class Quantity:
    value: float
    unit: str | None
    raw: str


def words_to_digits(text: str) -> str:
    """Convert simple spelled-out numbers ('forty two percent' -> '42 percent')."""
    words = text.split()
    out: list[str] = []
    i = 0
    while i < len(words):
        w = words[i].replace("-", " ").split()
        if w and (w[0] in _ONES or w[0] in _TENS):
            total, cur, j, consumed = 0, 0, i, False
            while j < len(words):
                parts = words[j].split("-")
                ok = True
                for p in parts:
                    if p in _ONES:
                        cur += _ONES[p]
                    elif p in _TENS:
                        cur += _TENS[p]
                    elif p in _SCALE and cur:
                        cur *= _SCALE[p]
                    elif p == "and" and consumed:
                        pass
                    else:
                        ok = False
                        break
                if not ok:
                    break
                consumed = True
                j += 1
            total += cur
            if consumed:
                out.append(str(total))
                i = j
                continue
        out.append(words[i])
        i += 1
    return " ".join(out)


def extract_quantities(text: str) -> list[Quantity]:
    norm = words_to_digits(normalise(text))
    out = []
    for m in NUM_RE.finditer(norm):
        unit = m.group(2)
        out.append(Quantity(float(m.group(1)), UNITS.get(unit) if unit else None, m.group(0).strip()))
    return out


def raw_number_claims(text: str) -> list[tuple[str, str]]:
    """Numbers as written in article text: [(display_text, kind)] where kind is number|percentage."""
    claims = []
    pattern = re.compile(
        r"(?<![\w.])(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)(\s*(?:%|per\s?cent|percent))?"
        r"(\s*(?:crores?|lakhs?|million|billion|mn|bn|thousand|trillion))?(?![\w])",
        re.I,
    )
    for m in pattern.finditer(text or ""):
        disp = m.group(0).strip()
        kind = "percentage" if m.group(2) else "number"
        claims.append((disp, kind))
    return claims
