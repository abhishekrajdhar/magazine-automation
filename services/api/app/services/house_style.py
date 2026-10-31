"""PressFlow house style: used when a project has no (approved) reference design profile."""

from __future__ import annotations

from app.schemas.base import TEXT_ROLES
from app.services.reference_analysis.fonts import preview_font_for

_T = {
    # role: (classification, size, leading, weight, colour key, uppercase, italic)
    "kicker": ("sans", 8, 9.5, 700, "accent", True, False),
    "headline": ("serif", 34, 37, 700, "ink", False, False),
    "deck": ("sans", 13, 17, 400, "ink", False, False),
    "byline": ("sans", 8.5, 10.5, 400, "muted", False, False),
    "body": ("serif", 9.5, 13, 400, "ink", False, False),
    "subhead": ("sans", 10.5, 13, 700, "ink", False, False),
    "pullquote": ("serif", 17, 21, 400, "accent", False, True),
    "caption": ("sans", 7.5, 9.5, 400, "muted", False, False),
    "folio": ("sans", 7.5, 9, 600, "ink", True, False),
    "question": ("serif", 9.5, 13, 700, "ink", False, False),
    "stat": ("sans", 44, 46, 700, "accent", False, False),
}

HOUSE_COLORS = {"ink": "#14213D", "paper": "#FFFFFF", "accent": "#1F4FD8", "accentAlt": "#E07A1F", "muted": "#5A6270",
                "rule": "#C9CED6", "palette": ["#14213D", "#1F4FD8", "#E07A1F", "#5A6270", "#C9CED6", "#FFFFFF"]}


def house_profile() -> dict:
    typo = {}
    for role in TEXT_ROLES:
        cls, size, lead, weight, ck, upper, italic = _T[role]
        typo[role] = {"role": role, "detectedFont": None, "classification": cls, "previewFont": preview_font_for(cls),
                      "size": size, "leading": lead, "weight": weight, "tracking": 0, "color": HOUSE_COLORS[ck],
                      "uppercase": upper, "italic": italic, "confidence": 1.0}
    return {
        "id": "house_style",
        "referenceId": "",
        "name": "PressFlow house style",
        "status": "approved",
        "version": 1,
        "page": {"widthPt": 595.28, "heightPt": 841.89, "orientation": "portrait", "bleedPt": 9},
        "margins": {"top": 54, "bottom": 60, "inside": 48, "outside": 42},
        "grid": {"columns": 3, "gutterPt": 14, "baselinePt": 13},
        "typography": typo,
        "colors": dict(HOUSE_COLORS),
        "folio": {"position": "bottom_outside", "showMagazineName": True, "showSection": True},
        "images": {"captionPlacement": "below", "cornerRadius": 0, "fullBleedCover": True},
        "pullQuote": {"style": "rule_above"},
        "pageTypeCounts": {},
        "confidence": {},
        "overrides": [],
    }
