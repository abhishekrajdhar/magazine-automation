from app.services.claim_verification import Seg, verify_article
from app.services.text_match import extract_quantities, match_quote, raw_number_claims

SEGS = [
    Seg("seg_1", "vid_1", 10.0, 15.0, "Good morning everyone. Um, infrastructure is only public"),
    Seg("seg_2", "vid_1", 15.0, 20.0, "when every citizen can actually use it."),
    Seg("seg_3", "vid_1", 20.0, 30.0, "Last year we onboarded 1,200 gram panchayats and forty two percent of them now file online."),
    Seg("seg_4", "vid_1", 30.0, 40.0, "The budget for the platform was 3.5 crore over three years."),
]


def by_text(claims, text):
    return next(c for c in claims if c.text == text)


def test_quote_spanning_segments_is_verified():
    m = match_quote("Infrastructure is only public when every citizen can actually use it.", [s.text for s in SEGS])
    assert m.status == "verified" and m.index == 0


def test_numbers_and_units():
    q = extract_quantities("forty two percent of 1,200 and 3.5 crore")
    assert [(x.value, x.unit) for x in q] == [(42.0, "percent"), (1200.0, None), (3.5, "crore")]
    assert raw_number_claims("A 42% rise across 1,200 villages") == [("42%", "percentage"), ("1,200", "number")]


def test_verify_article():
    article = {
        "headline": "1,200 panchayats go digital",
        "subheadline": "42% now file online",
        "intro": "The platform cost 3.5 crore, or 35 million by another count, and reached 90% of districts.",
        "body": [
            {"id": "b1", "kind": "quote", "text": "“Infrastructure is only public when every citizen can actually use it.”"},
            {"id": "b2", "kind": "quote", "text": "We onboarded 1,200 gram panchayats last year"},
            {"id": "b3", "kind": "quote", "text": "Digital India will be finished by Tuesday."},
            {"id": "b4", "kind": "paragraph", "text": "It took 3.5 lakh hours."},
        ],
    }
    claims = verify_article(article, SEGS)
    assert by_text(claims, "Infrastructure is only public when every citizen can actually use it.").status == "verified"
    assert by_text(claims, "Infrastructure is only public when every citizen can actually use it.").source.id == "seg_1"
    assert by_text(claims, "We onboarded 1,200 gram panchayats last year").status == "partial"
    assert by_text(claims, "Digital India will be finished by Tuesday.").status == "not_found"
    assert by_text(claims, "1,200").status == "verified"
    assert by_text(claims, "42%").status == "verified"
    assert by_text(claims, "42%").source.id == "seg_3"
    assert by_text(claims, "3.5 crore").status == "verified"
    assert by_text(claims, "90%").status == "not_found"
    assert by_text(claims, "35 million").status == "not_found"
    assert by_text(claims, "3.5 lakh").status == "partial"  # value present, unit differs
    kinds = {c.kind for c in claims}
    assert kinds == {"quote", "number", "percentage"}
