"""Deterministic heuristic flatplan (no AI), composed with the frontend's built-in template IDs.

Sequence: cover -> inside-front ad -> TOC -> editorial -> lead event report -> keynotes/government perspectives
-> panels & interviews interleaved with ads -> features/highlights -> infographic -> speaker profiles -> gallery
-> back-cover ad. Article page counts come from word count vs. the templates' body capacity in the design profile;
importance, image availability and the reference's page-type mix decide trimming and template choice.
"""

from __future__ import annotations

import math

from app.services.composer import ComposeContext, PlanEntry, compose_magazine
from app.services.page_builder import article_paragraphs, body_capacities, paragraph_cost
from app.services.template_specs import SPEC_BY_ID

IMPORTANCE = {"event_report": 1.0, "keynote": 0.9, "government_perspective": 0.85, "interview": 0.8, "panel": 0.75,
              "tech_feature": 0.6, "highlights": 0.5, "speaker_profiles": 0.5, "photo_captions": 0.4, "editorial": 0.95}
SECTION = {"event_report": "Event report", "keynote": "Keynote", "government_perspective": "Government perspective",
           "interview": "Interview", "panel": "Panel", "tech_feature": "Feature", "highlights": "Highlights",
           "speaker_profiles": "Profiles", "photo_captions": "Gallery", "editorial": "Editorial"}
OPENER = {"event_report": "tpl_report_hero", "interview": "tpl_interview_opener"}
CONTINUATION = {"interview": "tpl_interview_qa"}


def _words(article: dict) -> int:
    return sum(paragraph_cost(p) for p in article_paragraphs(article, {}, set()))


def _cap(template_id: str, profile: dict) -> int:
    return sum(body_capacities(SPEC_BY_ID[template_id], profile, 1)) or 1


def _stats_count(article: dict) -> int:
    return sum(1 for b in article.get("body") or [] if b.get("kind") == "list_item" and "|" in (b.get("text") or ""))


def article_entries(a: dict, page_type: str, profile: dict, has_images: bool) -> list[PlanEntry]:
    n_words = _words(a)
    single = "tpl_perspective_single"
    if page_type == "two_column_article" and n_words <= _cap(single, profile):
        return [PlanEntry(page_type, single, (a.get("headline") or SECTION.get(a["type"], "Article"))[:60], a["id"])]
    opener = OPENER.get(page_type, "tpl_feature_opener")
    cont_default = CONTINUATION.get(page_type, "tpl_article_image" if has_images else "tpl_article_quote")
    first, cont = _cap(opener, profile), _cap(cont_default, profile)
    n = 1 if n_words <= first else min(6, 1 + math.ceil((n_words - first) / cont))
    out = []
    for i in range(n):
        if i == 0:
            tid = opener
        elif page_type == "interview":
            tid = "tpl_interview_qa"
        else:  # alternate image / quote continuations; a short last page gets the image-led layout
            tid = "tpl_article_image_heavy" if (i == n - 1 and n > 2 and has_images) else (
                "tpl_article_image" if (has_images and i % 2 == 1) else "tpl_article_quote")
        label = (a.get("headline") or SECTION.get(a["type"], "Article"))[:60] + (f" ({i + 1}/{n})" if n > 1 else "")
        out.append(PlanEntry(page_type, tid, label, a["id"]))
    return out


def cover_template(project: dict, existing_pages: list[dict], reference_templates: dict[str, dict] | None) -> str:
    """The cover rebuilt from this project's reference (live masthead/headline frames) when there is one, else the
    built-in full-bleed cover. A cover already on the flatplan keeps its template."""
    current = next((p.get("templateId") for p in existing_pages if p.get("pageType") == "cover"), None)
    if current:
        return current
    prefix = f"tpl_ref_{project.get('referenceId')}_p"
    for tid, t in sorted((reference_templates or {}).items()):
        if tid.startswith(prefix) and t.get("pageType") == "cover" and any(s.get("id") == "headline" for s in t.get("slots") or []):
            return tid
    return "tpl_cover_fullbleed"


def recommend(project: dict, config: dict, articles: list[dict], assets: list[dict], profile: dict,
              existing_pages: list[dict], target: int | None = None, speakers: list[dict] | None = None,
              facts: list[dict] | None = None, reference_templates: dict[str, dict] | None = None
              ) -> tuple[list[dict], list[str]]:
    target = int(target or config.get("targetPageCount") or project.get("targetPageCount") or 24)
    rationale: list[str] = [f"Heuristic plan for {target} pages (deterministic; no AI involved)."]
    ref_counts: dict = profile.get("pageTypeCounts") or {}
    photos = [a["id"] for a in assets if a.get("kind") in ("photo", "video_frame")]
    ads = [a["id"] for a in assets if a.get("kind") == "ad"]
    has_images = bool(photos)
    usable = [a for a in articles if a.get("status") != "rejected"]
    by_type: dict[str, list[dict]] = {}
    for a in sorted(usable, key=lambda a: (-IMPORTANCE.get(a["type"], 0.3), -_words(a))):
        by_type.setdefault(a["type"], []).append(a)

    ad_budget = int(config.get("adPageCount", 0)) if config.get("includeAdvertisements", True) else 0
    ad_iter = iter(ads)

    def ad_entry(label: str) -> PlanEntry:
        return PlanEntry("advertisement", "tpl_ad_full", label, ad_asset_id=next(ad_iter, None))

    if ad_budget:
        rationale.append(f"{ad_budget} advertisement page(s) requested ({len(ads)} ad artwork(s) uploaded); placed inside "
                         "front, between long reads and on the back cover.")
    discussion_type = "two_column_article"
    if ref_counts.get("event_report", 0) > ref_counts.get("two_column_article", 0):
        discussion_type = "event_report"
    if ref_counts:
        rationale.append("Reference page mix: " + ", ".join(f"{k} ×{v}" for k, v in sorted(ref_counts.items())) +
                         f"; keynotes/panels use the reference's dominant article layout ({discussion_type}).")

    old_cover = next((p for p in existing_pages if p.get("pageType") == "cover"), None)
    cover_image = [e["assetId"] for e in (old_cover or {}).get("elements") or []
                   if e.get("role") == "hero_image" and e.get("assetId")][:1]
    front: list[PlanEntry] = [PlanEntry("cover", cover_template(project, existing_pages, reference_templates), "Cover",
                                        image_ids=cover_image or None)]
    if ad_budget:
        front.append(ad_entry("Advertisement (inside front cover)"))
        ad_budget -= 1
    if config.get("includeToc", True):
        front.append(PlanEntry("toc", "tpl_toc_classic", "Contents"))
    if config.get("includeEditorial", True):
        ed = (by_type.get("editorial") or [None])[0]
        front.append(PlanEntry("editorial", "tpl_editorial_portrait", "Editorial", ed["id"] if ed else None))

    body: list[list[PlanEntry]] = []  # groups (an article's pages stay together)
    if config.get("includeEventReports", True):
        for a in by_type.get("event_report", []):
            body.append(article_entries(a, "event_report", profile, has_images))
    for t in ("keynote", "government_perspective"):
        for a in by_type.get(t, []):
            body.append(article_entries(a, discussion_type, profile, has_images))
    discussions = []
    if config.get("includeInterviews", True):
        discussions += [article_entries(a, "interview", profile, has_images) for a in by_type.get("interview", [])]
    discussions += [article_entries(a, discussion_type, profile, has_images) for a in by_type.get("panel", [])]
    back_ad = 1 if ad_budget else 0
    mid_ads = max(0, ad_budget - back_ad)
    for i, g in enumerate(discussions):
        body.append(g)
        if mid_ads and i < len(discussions) - 1:
            body.append([ad_entry("Advertisement")])
            mid_ads -= 1
    for t in ("tech_feature", "highlights"):
        for a in by_type.get(t, []):
            if _stats_count(a) >= 3:
                body.append([PlanEntry("infographic", "tpl_infographic_stats", (a.get("headline") or "In numbers")[:60], a["id"])])
            else:
                body.append(article_entries(a, "two_column_article", profile, has_images))
    for a in by_type.get("speaker_profiles", []):
        n = max(1, math.ceil(len(a.get("speakerIds") or []) / 12))
        body.append([PlanEntry("speaker_profile", "tpl_speakers_grid", "Speaker profiles" + (f" ({i + 1}/{n})" if n > 1 else ""),
                               a["id"]) for i in range(n)])
    gallery_art = (by_type.get("photo_captions") or [None])[0]
    if len(photos) >= 4 or gallery_art:
        g = [PlanEntry("photo_gallery", "tpl_gallery_grid", "Photo gallery", gallery_art["id"] if gallery_art else None)]
        if len(photos) >= 10:
            g.append(PlanEntry("photo_gallery", "tpl_gallery_mosaic", "Photo gallery (2/2)",
                               gallery_art["id"] if gallery_art else None))
        body.append(g)
        if len(photos) < 4:
            rationale.append("Gallery planned but fewer than 4 photos are uploaded; image frames will be empty.")
    while mid_ads:
        body.append([ad_entry("Advertisement")])
        mid_ads -= 1
    back = [ad_entry("Advertisement (back cover)")] if back_ad else []

    importance = {a["id"]: IMPORTANCE.get(a["type"], 0.3) for a in usable}

    def total() -> int:
        return len(front) + sum(len(g) for g in body) + len(back)

    if total() > target:
        rationale.append(f"Content needs {total()} pages; trimming to {target}.")
        while total() > target:
            multi = [g for g in body if len(g) > 1]
            if multi:
                g = min(multi, key=lambda g: importance.get(g[0].article_id or "", 0.3))
                removed = g.pop(-1 if g[-1].template_id != "tpl_report_hero" else -1)
                rationale.append(f"Shortened '{removed.label}' (continuation removed; copy will need cutting).")
                continue
            ad_groups = [g for g in body if g[0].page_type == "advertisement"]
            if ad_groups:
                body.remove(ad_groups[-1])
                rationale.append("Removed a mid-book advertisement to fit the page budget.")
                continue
            if body:
                g = min(body, key=lambda g: importance.get(g[0].article_id or "", 0.3))
                body.remove(g)
                rationale.append(f"Dropped '{g[0].label}' (lowest editorial importance).")
                continue
            if len(front) > 1:
                rationale.append(f"Dropped '{front.pop().label}'.")
                continue
            break
    elif total() < target:
        pad = target - total()
        rationale.append(f"Content fills {total()} pages; {pad} placeholder page(s) added to reach {target}.")
        for i in range(pad):
            body.append([PlanEntry("two_column_article", "tpl_feature_opener", f"Unassigned page {i + 1}")])
        rationale.append("Unassigned pages are placeholders; write or generate more articles, or lower the page count.")
    if target % 4:
        rationale.append(f"Note: {target} pages is not a multiple of 4; saddle-stitched print usually needs one.")

    plan = front + [e for g in body for e in g] + back

    # keep locked pages at their positions (their content is preserved verbatim)
    locked = sorted([p for p in existing_pages if p.get("locked")], key=lambda p: p.get("position", 0))
    for lp in locked:
        pos = min(int(lp.get("position", 0)), len(plan))
        plan.insert(pos, PlanEntry(lp["pageType"], lp["templateId"], lp.get("label", ""), lp.get("articleId"),
                                   locked=True, id=lp["id"]))
        rationale.append(f"Kept locked page '{lp.get('label') or lp['pageType']}' at position {pos + 1}.")
    while len(plan) > target and any(not e.locked and e.page_type != "cover" for e in plan):
        victim = next(e for e in reversed(plan) if not e.locked and e.page_type != "cover")
        plan.remove(victim)

    ctx = ComposeContext(profile=profile, project=project, articles=articles, speakers=speakers or [],
                         facts=facts or [], assets=assets, reference_templates=reference_templates or {},
                         image_preference=config.get("imagePreference") or "speakers_first")
    composed = compose_magazine(plan, ctx)
    by_id = {lp["id"]: lp for lp in locked}
    pages = [by_id[e.id] if e.locked else composed[i] for i, e in enumerate(plan)]
    # page ids are positional in the frontend composer; make them unique per plan
    for i, p in enumerate(pages):
        if not p.get("locked"):
            p["id"] = f"pg_{project['id'][-8:]}_{i + 1:03d}"
    rationale.append(f"Planned {len(pages)} pages with the built-in templates, resolved against the design profile "
                     f"({profile['page']['widthPt']}×{profile['page']['heightPt']} pt, {profile['grid']['columns']} columns).")
    return pages, rationale
