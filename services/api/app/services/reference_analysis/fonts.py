"""Font-name cleaning + classification.

We never claim exact font identification: names come from the PDF's embedded font
dictionary (subset prefixes stripped) and the web `previewFont` is a substitute.
"""

from __future__ import annotations

import re

SUBSET_RE = re.compile(r"^[A-Z]{6}\+")

PREVIEW_FONTS = {
    "serif": "Source Serif 4",
    "sans": "Inter",
    "display": "Playfair Display",
    "mono": "JetBrains Mono",
}

_MONO = ("mono", "courier", "consolas", "menlo", "code", "typewriter")
_DISPLAY = ("display", "didot", "bodoni", "playfair", "abril", "poster", "impact", "bebas", "headline", "titling",
            "fatface", "stencil", "blackletter", "oswald", "anton")
_SERIF = ("times", "minion", "garamond", "georgia", "serif", "caslon", "baskerville", "palatino", "book antiqua",
          "cambria", "merriweather", "charter", "utopia", "century", "sabon", "mercury", "tiempos", "publico", "lora",
          "roman", "nimbusrom", "nimbus rom", "libre baskerville", "crimson", "chronicle", "miller", "freight",
          "plantin", "bembo", "janson", "electra", "perpetua", "goudy", "joanna", "warnock", "adobe text", "noto serif",
          "droid serif", "tinos", "cormorant", "spectral", "literata", "le monde", "guardian egyptian", "clarendon",
          "rockwell", "egyptian", "slab", "dutch", "hoefler", "constantia", "kepler", "arno", "trajan")
_SANS = ("helvetica", "arial", "inter", "myriad", "frutiger", "univers", "futura", "gill", "roboto", "open sans",
         "opensans", "source sans", "sourcesans", "lato", "montserrat", "proxima", "avenir", "gotham", "sans",
         "verdana", "tahoma", "calibri", "segoe", "din", "akzidenz", "franklin", "grotesk", "grotesque", "nimbussan",
         "nimbus san", "arimo", "noto sans", "trebuchet", "lucida grande", "poppins", "nunito", "raleway", "ubuntu",
         "fira sans", "ibm plex sans", "work sans", "graphik", "circular", "brandon", "museo sans", "neue haas")

_WEIGHTS = [
    ("thin", 100), ("hairline", 100), ("extralight", 200), ("ultralight", 200), ("light", 300), ("book", 400),
    ("regular", 400), ("roman", 400), ("medium", 500), ("semibold", 600), ("demibold", 600), ("demi", 600),
    ("extrabold", 800), ("ultrabold", 800), ("heavy", 800), ("black", 900), ("bold", 700),
]


def clean_font_name(name: str | None) -> str:
    if not name:
        return ""
    return SUBSET_RE.sub("", name).strip()


def family_of(name: str) -> str:
    """'MinionPro-Regular' -> 'MinionPro'; 'Times-Roman' -> 'Times'; 'Arial,Bold' -> 'Arial'."""
    n = clean_font_name(name)
    for sep in ("-", ","):
        if sep in n:
            n = n.split(sep, 1)[0]
    n = re.sub(r"(MT|PS|Std|LT|Pro)$", "", n) or n
    return n


def human_family(name: str) -> str:
    """CamelCase family -> spaced ('MinionPro' -> 'Minion Pro') for display/InDesign family hints."""
    fam = family_of(name)
    fam = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", fam)
    return fam.strip() or clean_font_name(name)


def classify_font(name: str, serif_flag: bool | None = None) -> str:
    n = clean_font_name(name).lower().replace("_", " ")
    if any(k in n for k in _MONO):
        return "mono"
    if any(k in n for k in _DISPLAY):
        return "display"
    if any(k in n for k in _SANS):
        return "sans"
    if any(k in n for k in _SERIF):
        return "serif"
    if serif_flag is not None:
        return "serif" if serif_flag else "sans"
    return "sans"


def weight_of(name: str, bold_flag: bool = False) -> int:
    n = clean_font_name(name).lower().replace(" ", "").replace("-", "").replace("_", "")
    style = n
    for key, w in _WEIGHTS:
        if key in style:
            return w
    return 700 if bold_flag else 400


def is_italic(name: str, italic_flag: bool = False) -> bool:
    n = clean_font_name(name).lower()
    return italic_flag or "italic" in n or "oblique" in n or n.endswith("-it")


def is_bold(name: str, bold_flag: bool = False) -> bool:
    return weight_of(name, bold_flag) >= 600


def preview_font_for(classification: str) -> str:
    return PREVIEW_FONTS.get(classification, "Inter")


def reportlab_fallback(classification: str, bold: bool, italic: bool) -> str:
    """Base-14 font used by the ReportLab preview renderer for a style."""
    if classification in ("serif", "display"):
        base = {(False, False): "Times-Roman", (True, False): "Times-Bold", (False, True): "Times-Italic",
                (True, True): "Times-BoldItalic"}
    elif classification == "mono":
        base = {(False, False): "Courier", (True, False): "Courier-Bold", (False, True): "Courier-Oblique",
                (True, True): "Courier-BoldOblique"}
    else:
        base = {(False, False): "Helvetica", (True, False): "Helvetica-Bold", (False, True): "Helvetica-Oblique",
                (True, True): "Helvetica-BoldOblique"}
    return base[(bool(bold), bool(italic))]
