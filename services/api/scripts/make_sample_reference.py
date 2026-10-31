"""Generate a synthetic but realistic 12-page A4 reference magazine PDF.

Known grid (used by the analyser tests):
  page      A4 595.28 x 841.89 pt, facing pages (page 1 = recto)
  margins   top 54, bottom 60, inside 48, outside 42
  grid      3 columns, 14 pt gutter, baseline 13 pt
  body      Times-Roman 9.5 / 13
  headlines Helvetica-Bold; deck Helvetica 13/17; captions Helvetica 7.5/9.5
  pull quote Times-Italic 17/21 (accent), folio Helvetica-Bold 7.5 bottom-outside

All people, organisations and quotations are fictional.

Usage:  uv run python scripts/make_sample_reference.py [--out PATH ...]
"""

from __future__ import annotations

import argparse
import io
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Frame, Paragraph

W, H = 595.28, 841.89
TOP, BOTTOM, INSIDE, OUTSIDE = 54.0, 60.0, 48.0, 42.0
COLS, GUTTER, LEADING, BODY = 3, 14.0, 13.0, 9.5
INK = HexColor("#14213D")
ACCENT = HexColor("#1F4FD8")
ACCENT_ALT = HexColor("#E07A1F")
MUTED = HexColor("#5A6270")
RULE = HexColor("#C9CED6")
TINT = HexColor("#EEF2FB")
MAG = "eGov Horizons"
ISSUE = "November 2026"

API_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = API_ROOT.parent.parent
DEFAULT_OUTS = [
    API_ROOT / "tests" / "fixtures" / "sample-reference.pdf",
    REPO_ROOT / "apps" / "web" / "public" / "samples" / "pressflow-sample-reference.pdf",
]

# ----------------------------------------------------------------- styles
body = ParagraphStyle("body", fontName="Times-Roman", fontSize=BODY, leading=LEADING, alignment=TA_JUSTIFY,
                      textColor=INK, firstLineIndent=9)
body_first = ParagraphStyle("body_first", parent=body, firstLineIndent=0)
subhead = ParagraphStyle("subhead", fontName="Helvetica-Bold", fontSize=10.5, leading=LEADING, textColor=INK,
                         spaceBefore=LEADING, spaceAfter=0)  # one grid line keeps text on the baseline grid
question = ParagraphStyle("question", fontName="Times-Bold", fontSize=BODY, leading=LEADING, textColor=INK,
                          alignment=TA_LEFT, spaceBefore=0)
answer = ParagraphStyle("answer", parent=body, firstLineIndent=0)
headline_xl = ParagraphStyle("hxl", fontName="Helvetica-Bold", fontSize=30, leading=33, textColor=INK)
headline_l = ParagraphStyle("hl", fontName="Helvetica-Bold", fontSize=26, leading=29, textColor=INK)
deck = ParagraphStyle("deck", fontName="Helvetica", fontSize=13, leading=17, textColor=INK)
caption = ParagraphStyle("caption", fontName="Helvetica", fontSize=7.5, leading=9.5, textColor=MUTED)
pull = ParagraphStyle("pull", fontName="Times-Italic", fontSize=17, leading=21, textColor=ACCENT)
bio = ParagraphStyle("bio", fontName="Times-Roman", fontSize=8.5, leading=11, textColor=INK, alignment=TA_LEFT)

# ----------------------------------------------------------------- copy (fictional)
SENTENCES = [
    "Delegates from twenty-two state departments spent the morning comparing how their citizen service portals handle peak demand during scholarship season.",
    "The discussion kept returning to a simple question: who maintains the data once the pilot funding ends and the consultants leave?",
    "Several district officers described moving land-record requests from paper registers to a shared workflow engine in under six months.",
    "Procurement teams said the hardest part of cloud adoption was not technology but rewriting tender language written for physical servers.",
    "A panel on cybersecurity argued that most incidents in public systems still begin with a reused password or an unpatched remote desktop.",
    "Speakers agreed that interoperable registries matter more than any single flagship application.",
    "The state health mission presented results from linking immunisation records with the birth registry across four pilot districts.",
    "Officials stressed that grievance redressal data should be published as open dashboards rather than buried in annual reports.",
    "One municipal commissioner explained how ward-level sensors now feed a single operations room that coordinates water tankers during summer shortages.",
    "Startups at the exhibition demonstrated document verification tools built on consent-based data sharing frameworks.",
    "The afternoon track focused on training: thousands of frontline staff need practical skills, not another certificate course.",
    "Participants warned that artificial intelligence pilots often stall because the underlying records are incomplete or inconsistently coded.",
    "A finance department team shared how automated reconciliation cut the time to close monthly accounts from three weeks to five days.",
    "Rural connectivity remains uneven, and several speakers urged designers to build services that degrade gracefully on slow networks.",
    "The education department described a teacher attendance system that was redesigned after headmasters pointed out it ignored field visits.",
    "Accessibility featured prominently, with a call to test every public form with screen readers and regional language keyboards.",
    "Industry representatives asked for clearer data residency rules so that vendors can plan sovereign cloud investments with confidence.",
    "Several states have begun publishing service level commitments for online certificates, with automatic escalation when deadlines slip.",
    "The closing plenary returned to trust: citizens adopt digital services when they are predictable, transparent and easy to correct.",
    "Organisers announced that working groups on procurement, data standards and capacity building will report back at next year's edition.",
    "Moderators pressed panellists on costs, asking how much of each project budget is reserved for maintenance after launch.",
    "A transport department official walked through how permit renewals moved online without forcing applicants to visit an office.",
    "The agriculture session showcased soil health records that farmers can now access through a voice-based helpline.",
    "Delegates noted that small municipalities often lack even a single full-time engineer to manage their websites.",
]

QUOTES = [
    "Infrastructure is only public when every citizen can actually use it.",
    "We stopped counting launches and started counting the services people finish without help.",
    "Data that nobody maintains becomes a liability the day after the inauguration.",
]

PEOPLE = [
    ("Dr. Meera Raghavan", "Principal Secretary (IT), State of Vindhyachal"),
    ("Arjun Malhotra-Iyer", "Chief Digital Officer, Coastal Metro Authority"),
    ("Kavita Deshpande-Rao", "Director, Institute for Public Systems"),
    ("Imran Siddiqui-Nair", "Commissioner, Rivergate Municipal Corporation"),
    ("Sunita Bhardwaj-Kamat", "Head of Cyber Resilience, Fictional National Data Centre"),
    ("Thomas Varghese-Lal", "Founder, OpenForms Civic Labs"),
]


def paragraphs(seed: int, count: int, sentences=(4, 6)) -> list[str]:
    rnd = random.Random(seed)
    out = []
    for _ in range(count):
        n = rnd.randint(*sentences)
        out.append(" ".join(rnd.sample(SENTENCES, n)))
    return out


# ----------------------------------------------------------------- placeholder imagery

def _photo(seed: int, w: int, h: int, kind: str = "stage") -> bytes:
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    top = (rnd.randint(10, 50), rnd.randint(20, 60), rnd.randint(60, 120))
    bottom = (rnd.randint(120, 200), rnd.randint(60, 120), rnd.randint(30, 80))
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))
    if kind == "stage":
        for _ in range(6):  # stage lights
            cx, r = rnd.randint(0, w), rnd.randint(w // 12, w // 5)
            d.ellipse([cx - r, -r, cx + r, r], fill=(255, 240, 200))
        d.rectangle([0, int(h * 0.55), w, int(h * 0.62)], fill=(40, 30, 40))  # stage edge
        for _ in range(60):  # audience heads
            x, y = rnd.randint(0, w), rnd.randint(int(h * 0.7), h)
            r = rnd.randint(w // 60, w // 35)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(rnd.randint(10, 40),) * 3)
    elif kind == "portrait":
        cx = w // 2
        d.ellipse([cx - w // 5, int(h * 0.18), cx + w // 5, int(h * 0.18) + 2 * w // 5], fill=(70, 55, 50))
        d.ellipse([cx - w // 2.2, int(h * 0.62), cx + w // 2.2, int(h * 1.3)], fill=(30, 40, 70))
    else:  # abstract / ad
        for _ in range(9):
            x, y, r = rnd.randint(0, w), rnd.randint(0, h), rnd.randint(w // 8, w // 3)
            col = (rnd.randint(20, 90), rnd.randint(60, 140), rnd.randint(150, 230))
            d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    img = img.filter(ImageFilter.GaussianBlur(radius=max(2, w // 120)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=62, optimize=True)
    return buf.getvalue()


class Images:
    def __init__(self):
        self.cache: dict[str, ImageReader] = {}

    def get(self, name: str, seed: int, w: int, h: int, kind: str) -> ImageReader:
        if name not in self.cache:
            self.cache[name] = ImageReader(io.BytesIO(_photo(seed, w, h, kind)))
        return self.cache[name]


# ----------------------------------------------------------------- page helpers

def margins_for(page_no: int) -> tuple[float, float]:
    """(left, right) margins. Odd pages are recto: inside on the left."""
    return (INSIDE, OUTSIDE) if page_no % 2 == 1 else (OUTSIDE, INSIDE)


def content_box(page_no: int) -> tuple[float, float, float, float]:
    left, right = margins_for(page_no)
    return left, BOTTOM, W - left - right, H - TOP - BOTTOM  # x, y(bottom), w, h  (ReportLab coords)


def col_geom(page_no: int, cols: int = COLS) -> list[tuple[float, float]]:
    x, _, w, _ = content_box(page_no)
    cw = (w - (cols - 1) * GUTTER) / cols
    return [(x + i * (cw + GUTTER), cw) for i in range(cols)]


def folio(c: Canvas, page_no: int, section: str) -> None:
    left, right = margins_for(page_no)
    c.setFont("Helvetica-Bold", 7.5)
    c.setFillColor(INK)
    text = f"{page_no}   {MAG.upper()} · {ISSUE.upper()} · {section.upper()}" if page_no % 2 == 1 else \
        f"{section.upper()} · {MAG.upper()} · {ISSUE.upper()}   {page_no}"
    if page_no % 2 == 1:
        c.drawRightString(W - right, 30, text)
    else:
        c.drawString(left, 30, text)


def kicker(c: Canvas, x: float, y_top: float, text: str, color=ACCENT) -> None:
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(color)
    c.drawString(x, H - y_top - 8, text.upper())


def para_at(c: Canvas, text: str, style: ParagraphStyle, x: float, y_top: float, w: float) -> float:
    """Draw a paragraph with its top at `y_top` (distance from page top). Returns height."""
    p = Paragraph(text, style)
    _, h = p.wrap(w, H)
    p.drawOn(c, x, H - y_top - h)
    return h


def flow_columns(c: Canvas, story: list, cols: list[tuple[float, float]], y_top: float, y_bottom: float) -> list:
    """Flow `story` through columns between y_top and y_bottom (distances from page top). Returns leftovers."""
    story = list(story)
    y_top = TOP + math.ceil((y_top - TOP) / LEADING - 1e-6) * LEADING  # snap to the 13 pt baseline grid
    for x, w in cols:
        f = Frame(x, y_bottom - 0.5, w, H - y_top - y_bottom + 0.5, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        while story:
            if f.add(story[0], c, trySplit=0):
                story.pop(0)
                continue
            parts = f.split(story[0], c)  # split the paragraph across the column break
            if len(parts) >= 2 and f.add(parts[0], c, trySplit=0):
                story[0:1] = parts[1:]
            break
        if not story:
            break
    return story


def body_story(seed: int, n: int, subheads: list[str] | None = None) -> list:
    out: list = []
    paras = paragraphs(seed, n)
    for i, t in enumerate(paras):
        if subheads and i and i % 3 == 0:
            out.append(Paragraph(subheads.pop(0), subhead))
            out.append(Paragraph(t, body_first))
        else:
            out.append(Paragraph(t, body_first if i == 0 else body))
    return out


def image_with_caption(c: Canvas, img: ImageReader, x: float, y_top: float, w: float, h: float, text: str) -> float:
    c.drawImage(img, x, H - y_top - h, w, h)
    ch = para_at(c, text, caption, x, y_top + h + 4, w)
    return h + 4 + ch


# ----------------------------------------------------------------- pages

def page_cover(c: Canvas, imgs: Images) -> None:
    c.drawImage(imgs.get("cover", 11, 900, 1273, "stage"), 0, 0, W, H)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 66)
    c.drawString(OUTSIDE - 6, H - 112, MAG)
    c.setFont("Helvetica", 11)
    c.drawString(INSIDE, H - 134, f"{ISSUE.upper()}  ·  VOL. 22  ·  ISSUE 11  ·  SAMPLE REFERENCE EDITION")
    c.setFillColor(ACCENT_ALT)
    c.rect(INSIDE, 236, 60, 4, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 34)
    c.drawString(INSIDE, 196, "Building the Rails")
    c.drawString(INSIDE, 158, "for Digital Governance")
    c.setFont("Helvetica", 13)
    c.drawString(INSIDE, 128, "Inside the National eGovernance Summit 2026: platforms, procurement and public trust")
    c.setFont("Helvetica-Bold", 10)
    c.drawString(INSIDE, 92, "PLUS  In conversation with Dr. Meera Raghavan  ·  The summit in numbers  ·  Voices from the floor")


def page_toc(c: Canvas, imgs: Images, n: int) -> None:
    x, _, w, _ = content_box(n)
    kicker(c, x, TOP, "In this issue")
    para_at(c, "Contents", headline_xl, x, TOP + 16, w)
    entries = [
        (3, "From the Editor", "Why the plumbing of digital government deserves our attention."),
        (4, "Building the Rails for Digital Governance", "A full report from the National eGovernance Summit 2026."),
        (6, "Procurement Without the Paperwork", "How state tender teams are rewriting rules for cloud services."),
        (7, "In Conversation: Dr. Meera Raghavan", "On registries, resilience and the cost of maintenance."),
        (9, "The Summit in Pictures", "Moments from the plenary halls and the exhibition floor."),
        (10, "Voices from the Summit", "Six speakers who shaped the conversation."),
        (11, "The Summit in Numbers", "Delegates, sessions and states, at a glance."),
        (12, "Advertisement", "GovCloud Sovereign Platform."),
    ]
    y = TOP + 70
    col_w = w * 0.58
    for num, title, desc in entries:
        c.setFont("Helvetica-Bold", 16)
        c.setFillColor(ACCENT)
        c.drawString(x, H - y - 16, f"{num:02d}")
        para_at(c, title, ParagraphStyle("toct", fontName="Helvetica-Bold", fontSize=11, leading=13, textColor=INK),
                x + 40, y + 1, col_w - 40)
        para_at(c, desc, ParagraphStyle("tocd", parent=body_first, alignment=TA_LEFT), x + 40, y + 16, col_w - 40)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.5)
        c.line(x, H - y - 40, x + col_w, H - y - 40)
        y += 52
    ix = x + col_w + 18
    iw = w - col_w - 18
    image_with_caption(c, imgs.get("hero", 21, 960, 640, "stage"), ix, TOP + 70, iw, iw * 0.67,
                       "The plenary hall on the opening morning of the summit.")
    image_with_caption(c, imgs.get("portrait1", 31, 360, 450, "portrait"), ix, TOP + 70 + iw * 0.67 + 40, iw * 0.6,
                       iw * 0.75, "Dr. Meera Raghavan, interviewed on page 7.")
    para_at(c, "All people, organisations and quotations in this sample publication are fictional and were "
               "generated to test layout analysis.", caption, x, H - BOTTOM - 30, col_w)
    folio(c, n, "Contents")


def page_editorial(c: Canvas, imgs: Images, n: int) -> None:
    x, _, w, _ = content_box(n)
    kicker(c, x, TOP, "From the Editor")
    h = para_at(c, "The Quiet Work That Makes Digital Government Real", headline_xl, x, TOP + 16, w * 0.85)
    y = TOP + 16 + h + 10
    cols = col_geom(n, 2)
    story = body_story(301, 16)
    sig_h = 30.0
    story = flow_columns(c, story, cols[:1], y, BOTTOM)
    flow_columns(c, story, cols[1:], y, BOTTOM + sig_h)
    sx, sw = cols[1]
    para_at(c, "Rohan Vashisht-Menon<br/>Editor-in-Chief", ParagraphStyle(
        "sig", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=INK), sx, H - BOTTOM - sig_h + 6, sw)
    folio(c, n, "Editorial")


def page_event_report_1(c: Canvas, imgs: Images, n: int) -> None:
    x, _, w, _ = content_box(n)
    kicker(c, x, TOP, "Event report · National eGovernance Summit 2026")
    h = para_at(c, "Building the Rails for Digital Governance", headline_l, x, TOP + 16, w)
    y = TOP + 16 + h + 6
    h = para_at(c, "Two days, forty sessions and one recurring theme: shared public infrastructure only works "
                   "when someone is accountable for keeping it running.", deck, x, y, w * 0.9)
    y += h + 6
    c.setFont("Helvetica", 8.5)
    c.setFillColor(MUTED)
    c.drawString(x, H - y - 8.5, "By Ananya Kulkarni-Shah  ·  Photographs by the eGov Horizons desk")
    y += 20
    hh = image_with_caption(c, imgs.get("hero", 21, 960, 640, "stage"), x, y, w, 210,
                            "Delegates at the inaugural session of the National eGovernance Summit 2026.")
    y += hh + 12
    story = body_story(401, 24, ["Registries before apps", "The maintenance gap"])
    rest = flow_columns(c, story, col_geom(n), y, BOTTOM)
    folio(c, n, "Event report")
    return rest


def page_event_report_2(c: Canvas, imgs: Images, n: int) -> None:
    cols = col_geom(n)
    # pull quote spanning columns 1-2 in the middle of the page
    (x0, cw) = cols[0]
    span_w = cw * 2 + GUTTER
    pq_top = 330.0
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.5)
    c.line(x0, H - pq_top, x0 + span_w, H - pq_top)
    ph = para_at(c, f"“{QUOTES[0]}”", pull, x0, pq_top + 8, span_w)
    para_at(c, "— Dr. Meera Raghavan, Principal Secretary (IT), State of Vindhyachal", caption, x0,
            pq_top + 8 + ph + 4, span_w)
    pq_bottom = pq_top + 8 + ph + 24
    # image with caption in column 3
    x3, cw3 = cols[2]
    ih = image_with_caption(c, imgs.get("feature", 41, 960, 640, "stage"), x3, TOP, cw3, 120,
                            "A breakout session on registry interoperability drew a standing-room crowd.")
    story = body_story(501, 28, ["Procurement in the cloud era", "Skills on the front line"])
    # columns 1-2: above and below the pull quote
    story = flow_columns(c, story, cols[:2], TOP, H - pq_top + 12)
    story = flow_columns(c, story, cols[:2], pq_bottom, BOTTOM)
    flow_columns(c, story, [cols[2]], TOP + ih + 12, BOTTOM)
    folio(c, n, "Event report")


def page_feature(c: Canvas, imgs: Images, n: int) -> None:
    x, _, w, _ = content_box(n)
    kicker(c, x, TOP, "Feature · Procurement")
    h = para_at(c, "Procurement Without the Paperwork", headline_xl, x, TOP + 16, w)
    y = TOP + 16 + h + 6
    h = para_at(c, "State tender teams are rewriting rules written for physical servers. The results are uneven, "
                   "but the direction is clear.", deck, x, y, w * 0.85)
    y += h + 14
    hh = image_with_caption(c, imgs.get("abstract1", 51, 960, 640, "abstract"), x, y, w, 190,
                            "Vendors demonstrated sovereign cloud offerings at the exhibition.")
    y += hh + 12
    story = body_story(601, 20, ["What changed in the tenders"])
    flow_columns(c, story, col_geom(n, 2), y, BOTTOM)
    folio(c, n, "Feature")


def qa_story(seed: int, pairs: int) -> list:
    rnd = random.Random(seed)
    qs = [
        "What did the summit get right this year?",
        "Why do registries matter more than individual applications?",
        "How should states budget for maintenance after a launch?",
        "What is the biggest cybersecurity risk you see today?",
        "How do you measure whether a digital service is working?",
        "What role should startups play in public platforms?",
        "Where does artificial intelligence fit in your roadmap?",
        "What advice would you give a new district collector?",
        "How do you handle services for citizens with poor connectivity?",
        "What would you change about procurement rules tomorrow?",
    ]
    out: list = []
    for i in range(pairs):
        out.append(Paragraph(f"Q. {qs[i % len(qs)]}", question))
        n = rnd.randint(4, 6)
        out.append(Paragraph(" ".join(rnd.sample(SENTENCES, n)), answer))
    return out


def page_interview_1(c: Canvas, imgs: Images, n: int):
    x, _, w, _ = content_box(n)
    kicker(c, x, TOP, "Interview")
    h = para_at(c, "In Conversation: Dr. Meera Raghavan", headline_xl, x, TOP + 16, w * 0.7)
    y = TOP + 16 + h + 6
    h = para_at(c, "The Principal Secretary (IT) of the fictional State of Vindhyachal on registries, resilience "
                   "and why maintenance is a policy decision.", deck, x, y, w * 0.68)
    pw = w * 0.26
    image_with_caption(c, imgs.get("portrait1", 31, 360, 450, "portrait"), x + w - pw, TOP + 16, pw, pw * 1.25,
                       "Dr. Meera Raghavan at the summit.")
    y = max(y + h, TOP + 16 + pw * 1.25 + 24) + 12
    story = qa_story(701, 24)
    rest = flow_columns(c, story, col_geom(n), y, BOTTOM)
    folio(c, n, "Interview")
    return rest


def page_interview_2(c: Canvas, imgs: Images, n: int, rest: list):
    story = list(rest) + qa_story(801, 20)
    cols = col_geom(n)
    (x0, cw) = cols[0]
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.5)
    c.line(x0, H - TOP, x0 + cw * 2 + GUTTER, H - TOP)
    ph = para_at(c, f"“{QUOTES[1]}”", pull, x0, TOP + 8, cw * 2 + GUTTER)
    story = flow_columns(c, story, cols[:2], TOP + 8 + ph + 20, BOTTOM)
    flow_columns(c, story, [cols[2]], TOP, BOTTOM)
    folio(c, n, "Interview")


def page_gallery(c: Canvas, imgs: Images, n: int) -> None:
    x, _, w, _ = content_box(n)
    kicker(c, x, TOP, "Photo gallery")
    h = para_at(c, "The Summit in Pictures", headline_xl, x, TOP + 16, w)
    y0 = TOP + 16 + h + 14
    cw = (w - GUTTER) / 2
    ih = 150.0
    caps = [
        "Registration desks opened at eight on the first morning.",
        "A packed plenary for the inaugural address.",
        "Exhibitors from twelve states showcased citizen services.",
        "Panellists debate data standards for registries.",
        "Students from a civic technology fellowship presented prototypes.",
        "The closing plenary and announcement of working groups.",
    ]
    for i in range(6):
        r, col = divmod(i, 2)
        gx = x + col * (cw + GUTTER)
        gy = y0 + r * (ih + 46)
        image_with_caption(c, imgs.get(f"g{i}", 900 + i, 720, 480, "stage" if i % 2 == 0 else "abstract"),
                           gx, gy, cw, ih, caps[i])
    folio(c, n, "Gallery")


def page_profiles(c: Canvas, imgs: Images, n: int) -> None:
    x, _, w, _ = content_box(n)
    kicker(c, x, TOP, "Speaker profiles")
    h = para_at(c, "Voices from the Summit", headline_xl, x, TOP + 16, w)
    y0 = TOP + 16 + h + 14
    cols = col_geom(n)
    rnd = random.Random(1001)
    for i, (name, role) in enumerate(PEOPLE):
        r, ci = divmod(i, 3)
        cx, cw = cols[ci]
        py = y0 + r * 330
        ph = cw * 1.22
        c.drawImage(imgs.get(f"portrait{i + 1}", 31 + i, 360, 450, "portrait"), cx, H - py - ph, cw, ph)
        ty = py + ph + 8
        para_at(c, name, ParagraphStyle("pn", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=INK),
                cx, ty, cw)
        para_at(c, role, ParagraphStyle("pr", fontName="Helvetica", fontSize=8, leading=10, textColor=MUTED),
                cx, ty + 14, cw)
        para_at(c, " ".join(rnd.sample(SENTENCES, 2)), bio, cx, ty + 40, cw)
    folio(c, n, "Profiles")


def page_numbers(c: Canvas, imgs: Images, n: int) -> None:
    x, _, w, _ = content_box(n)
    c.setFillColor(TINT)
    c.rect(0, H - 300, W, 300 - TOP + 54, stroke=0, fill=1)
    kicker(c, x, TOP, "Infographic")
    h = para_at(c, "The Summit in Numbers", headline_xl, x, TOP + 16, w)
    stats = [("4,200", "delegates registered across two days"), ("40", "sessions in four parallel tracks"),
             ("22", "states and union territories represented"), ("63%", "of sessions featured a live demonstration"),
             ("118", "startups on the exhibition floor"), ("9", "working groups announced at the close")]
    cols = col_geom(n)
    for i, (num, label) in enumerate(stats):
        r, ci = divmod(i, 3)
        cx, cw = cols[ci]
        y = TOP + 16 + h + 30 + r * 120
        c.setFont("Helvetica-Bold", 46)
        c.setFillColor(ACCENT if i % 2 == 0 else ACCENT_ALT)
        c.drawString(cx, H - y - 46, num)
        para_at(c, label, ParagraphStyle("sl", fontName="Helvetica", fontSize=9, leading=11.5, textColor=INK),
                cx, y + 56, cw)
    # bar chart
    by = 560.0
    c.setFont("Helvetica-Bold", 10.5)
    c.setFillColor(INK)
    c.drawString(x, H - by, "Sessions by track")
    tracks = [("Platforms & registries", 12), ("Cybersecurity", 9), ("AI in governance", 11), ("Skills", 8)]
    for i, (label, val) in enumerate(tracks):
        yy = by + 20 + i * 34
        c.setFont("Helvetica", 9)
        c.setFillColor(INK)
        c.drawString(x, H - yy - 9, label)
        c.setFillColor(ACCENT)
        c.rect(x + 140, H - yy - 14, val * 24, 16, stroke=0, fill=1)
        c.setFillColor(INK)
        c.drawString(x + 146 + val * 24, H - yy - 10, str(val))
    para_at(c, "Source: summit organisers (fictional data for this sample).", caption, x, H - BOTTOM - 12, w)
    folio(c, n, "In numbers")


def page_ad(c: Canvas, imgs: Images, n: int) -> None:
    c.drawImage(imgs.get("ad", 61, 900, 1273, "abstract"), 0, 0, W, H)
    c.setFillColor(white)
    c.setFont("Helvetica", 7)
    c.drawRightString(W - 24, H - 24, "ADVERTISEMENT")
    c.setFont("Helvetica-Bold", 40)
    c.drawString(OUTSIDE, H - 420, "GovCloud")
    c.drawString(OUTSIDE, H - 464, "Sovereign Platform")
    c.setFont("Helvetica", 14)
    c.drawString(OUTSIDE, H - 494, "Hosted in-country. Audited. Built for public services.")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(OUTSIDE, 90, "Register for the 2027 pilot programme  ·  www.govcloud.example")


def build(out_paths: list[Path]) -> bytes:
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=(W, H), pageCompression=1)
    c.setTitle(f"{MAG} — {ISSUE} (PressFlow sample reference)")
    c.setAuthor("PressFlow sample generator")
    c.setSubject("Synthetic reference magazine for layout analysis. All people and organisations are fictional.")
    c.setCreator("PressFlow scripts/make_sample_reference.py (ReportLab)")
    imgs = Images()

    page_cover(c, imgs); c.showPage()                       # 1  cover
    page_toc(c, imgs, 2); c.showPage()                      # 2  contents
    page_editorial(c, imgs, 3); c.showPage()                # 3  editorial
    page_event_report_1(c, imgs, 4); c.showPage()           # 4  event report
    page_event_report_2(c, imgs, 5); c.showPage()           # 5  event report (cont.)
    page_feature(c, imgs, 6); c.showPage()                  # 6  2-column feature
    rest = page_interview_1(c, imgs, 7); c.showPage()       # 7  interview
    page_interview_2(c, imgs, 8, rest or []); c.showPage()  # 8  interview (cont.)
    page_gallery(c, imgs, 9); c.showPage()                  # 9  photo gallery
    page_profiles(c, imgs, 10); c.showPage()                # 10 speaker profiles
    page_numbers(c, imgs, 11); c.showPage()                 # 11 infographic
    page_ad(c, imgs, 12); c.showPage()                      # 12 full-page ad
    c.save()
    data = buf.getvalue()
    for p in out_paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    return data


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", action="append", type=Path, help="output path (repeatable)")
    args = ap.parse_args(argv)
    outs = args.out or DEFAULT_OUTS
    data = build(outs)
    for p in outs:
        print(f"wrote {p} ({len(data) / 1024:.0f} KiB)")
    if len(data) > 1.5 * 1024 * 1024:
        print("WARNING: sample exceeds 1.5 MB", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
