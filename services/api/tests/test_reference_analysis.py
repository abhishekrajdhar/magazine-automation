"""The analyser must recover the sample's known grid (see scripts/make_sample_reference.py)."""

import pytest

from app.schemas.base import TEXT_ROLES
from app.schemas.reference import DesignProfile, ReferencePage
from app.services.reference_analysis import analyse_pdf
from tests.conftest import SAMPLE_PDF


@pytest.fixture(scope="module")
def result():
    return analyse_pdf(SAMPLE_PDF.read_bytes())


def test_page_size_a4(result):
    page = result.profile["page"]
    assert abs(page["widthPt"] - 595.28) < 1 and abs(page["heightPt"] - 841.89) < 1
    assert page["orientation"] == "portrait"
    assert result.page_count == 12


def test_grid(result):
    grid = result.profile["grid"]
    assert grid["columns"] == 3
    assert abs(grid["gutterPt"] - 14) <= 2
    assert abs(grid["baselinePt"] - 13) <= 0.5


def test_margins_within_6pt(result):
    m = result.profile["margins"]
    for key, expected in {"top": 54, "bottom": 60, "inside": 48, "outside": 42}.items():
        assert abs(m[key] - expected) <= 6, (key, m[key])


def test_typography(result):
    t = result.profile["typography"]
    assert set(t) == set(TEXT_ROLES)
    assert abs(t["body"]["size"] - 9.5) <= 0.25
    assert t["body"]["classification"] == "serif"
    assert t["body"]["previewFont"] == "Source Serif 4"
    assert t["headline"]["size"] >= 24 and t["headline"]["classification"] == "sans"
    assert t["headline"]["weight"] >= 700
    assert t["pullquote"]["italic"] is True
    assert abs(t["caption"]["size"] - 7.5) <= 0.5
    assert t["kicker"]["uppercase"] is True
    assert t["question"]["weight"] >= 700
    assert t["stat"]["size"] >= 40
    assert t["subhead"]["confidence"] > 0.2  # found with evidence, not defaulted


def test_colours(result):
    c = result.profile["colors"]
    assert c["ink"] == "#14213D"
    assert c["paper"] == "#FFFFFF"
    assert c["accent"] == "#1F4FD8"
    assert c["accentAlt"] == "#E07A1F"


def test_page_types(result):
    types = {p["pageNumber"]: p["layoutType"] for p in result.pages}
    assert types[1] == "cover"
    assert types[2] == "toc"
    assert types[7] == "interview"
    assert types[9] == "photo_gallery"
    assert types[12] == "advertisement"
    assert types[10] == "speaker_profile"
    assert types[11] == "infographic"
    assert types[4] == "event_report"
    assert types[6] == "two_column_article"
    counts = result.profile["pageTypeCounts"]
    assert sum(counts.values()) == 12


def test_folio_and_images(result):
    assert result.profile["folio"]["position"] == "bottom_outside"
    assert result.profile["images"]["fullBleedCover"] is True
    assert result.profile["images"]["captionPlacement"] == "below"
    assert result.profile["pullQuote"]["style"] == "rule_above"


def test_shapes_match_types_ts(result):
    profile = DesignProfile.model_validate({**result.profile, "id": "dsp_x", "referenceId": "ref_x", "name": "x",
                                            "status": "draft", "version": 1, "overrides": []})
    assert profile.grid.columns == 3
    for p in result.pages:
        rp = ReferencePage.model_validate({**{k: v for k, v in p.items() if k != "features"}, "id": "rpg",
                                           "referenceId": "ref_x", "corrected": False})
        assert rp.blocks, p["pageNumber"]
        for b in rp.blocks:
            assert 0 <= b.x <= 1 and 0 <= b.y <= 1 and 0 <= b.w <= 1 and 0 <= b.h <= 1
    body_blocks = [b for p in result.pages for b in p["blocks"] if b.get("role") == "body"]
    assert body_blocks and all(b["fontName"] == "Times-Roman" for b in body_blocks[:5])
