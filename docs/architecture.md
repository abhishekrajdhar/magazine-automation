# Architecture

```
            ┌────────────────────────── Browser (apps/web) ───────────────────────────┐
            │  Workspace store (zustand)  ←→  live-sync  ←→  /api/v1 (same origin)      │
            │  Template composer · page renderer · preflight · verification · exports  │
            └───────────────────────────────────┬──────────────────────────────────────┘
                                                │ Next.js rewrite (server-side)
            ┌───────────────────────────────────▼──────────────────────────────────────┐
            │  FastAPI (services/api)                                                  │
            │  auth/RBAC · projects · media · references · editorial · planner ·       │
            │  preflight · exports · jobs · InDesign bridge endpoints                  │
            │       │ DB-backed job queue  → worker (inline thread or `app.worker`)    │
            │       ├─ reference analysis (PyMuPDF, Pillow/numpy, optional vision LLM) │
            │       ├─ video pipeline (Drive/YouTube/upload → ffmpeg → Whisper → LLM)  │
            │       ├─ editorial generation & assist (Anthropic / OpenAI-compatible)   │
            │       └─ renderers: ReportLab PDF · PNG previews · zip packages          │
            │  PostgreSQL (SQLite locally) · S3-compatible or local storage            │
            └───────────────────────────────────┬──────────────────────────────────────┘
                                                │ bridge token, polling
            ┌───────────────────────────────────▼──────────────────────────────────────┐
            │  InDesign bridge (services/indesign) on a machine with InDesign / Server │
            │  pressflow-render.jsx builds the .indd from the layout contract,         │
            │  exports PDF (digital / PDF/X-4), reports overset, fonts, links          │
            └──────────────────────────────────────────────────────────────────────────┘
```

## Domain model

`apps/web/src/lib/domain/types.ts` is the canonical model. The API mirrors it in Pydantic with camelCase JSON. The main entities are:

- Organisation, Member (with role), Project (including its generation config)
- VideoSource, TranscriptSegment, Speaker, EventSession, ExtractedFact
- Article (with block-level `sourceRefs`)
- ReferenceMagazine, ReferencePage (normalised `LayoutBlock`s), DesignProfile
- Template, MagazinePage (with `PageElement`s in points)
- Asset, PreflightIssue, ExportRecord, Job

## Reference-driven generation

1. **Analysis** (`services/api/app/services/reference_analysis/`) measures the PDF with PyMuPDF and builds a `DesignProfile`:
   - trim size and margins, using robust percentiles with inside/outside resolved by page parity
   - columns and gutter, by clustering the x-starts of body-size lines
   - leading, from the median line pitch
   - eleven type roles
   - the colour palette, by quantising the rendered pages
   - a page type for each page, from heuristics with a confidence score

   Font names are reported as detected; they are never guaranteed.
2. **Correction and approval.** People can fix any property in the profile editor. Corrected paths are recorded in `overrides`, and the profile must be approved before final export.
3. **Templates** (`apps/web/src/lib/templates/`) come in two kinds:
   - *Built-in archetypes* are expressed in fractions of the live area and **snapped to the profile's column grid** at compose time. The same archetype therefore reproduces a 2-, 3- or 4-column reference, and mirrored templates swap their inside and outside on left-hand pages.
   - *Reconstructed templates* (`derive.ts`) turn a reference page's detected blocks into slots. Adjacent body columns merge into one multi-column frame.
4. **Composition** (`compose.ts`) fills templates from approved content:
   - It estimates each body frame's word capacity, distributes paragraphs across the article's pages (filling the last page's frames in proportion), and assigns pull quotes from verbatim quote blocks.
   - It picks images from the article's suggestions, then from its sessions by the project's image preference, and never repeats a photograph.
   - Folios and the contents list are regenerated from the flatplan.
   - The heuristic planner (`lib/planner/recommend.ts`) chooses templates by fit, preferring pages 80–100% full, and orders articles by editorial weight. It is deterministic and labelled as not AI.

## Page rendering

`PageView` renders a page as absolutely positioned HTML in points: real text with CSS columns, hyphenation, drop caps, Q&A styling and pull quotes, plus image frames with crop and focal point. The same renderer drives thumbnails, the editor, the reader, preflight, the print view and the page-preview export.

Overset is measured on that DOM. For multi-column frames it is horizontal overflow; for single-column frames it is where the last block ends. Fit-text works by shrinking the type until the frame fits, down to 85% of the original size.

## Layout contract

`packages/contracts/layout-contract.schema.json` (JSON Schema 2020-12) is the only thing renderers consume. It contains:

- the document setup
- swatches with CMYK values
- paragraph, character and object styles, with fallback font families
- masters with folio settings
- pages, each with simplified fields (headline, body, hero image, pull quotes, caption, `approved`) and `frames` using InDesign `geometricBounds` order
- assets

The browser builds it in `lib/exports/contract.ts`; the full 40-page demo contract validates with zero errors. The API validates every contract it receives and can also build one from saved pages.

## Editorial integrity

- **Facts** are `transcript_verbatim` only when found word for word in their segment; anything else is `ai_interpretation`.
- **Generation** uses approved facts only. Every block must cite segments, and generated drafts start as `draft`.
- **Verification** (`lib/editorial/verify.ts`, mirrored in the API) checks every quotation and number against the cited segments, then against all segments, and reports verified, close match or not found.
- **Approval state** is tracked per article and per page. Final formats are refused while anything is unapproved.

## Modes

- **Demo**: the store is seeded from `lib/demo/*`, persisted in localStorage, and everything is labelled simulated. Processing endpoints aren't called.
- **Live**: `lib/api/live-sync.ts` loads the organisation's data, polls while jobs run, and saves edits to pages, articles, profiles, facts, speakers and sessions back to the API with a short debounce.
