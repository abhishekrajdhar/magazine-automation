# PressFlow AI: Adobe InDesign automation layer

This layer turns a **PressFlow layout contract** (`packages/contracts/layout-contract.schema.json`, `contract_version` `"1.0"`) into a real InDesign document, an `.indd` file and press-ready PDFs. The code lives in `services/indesign/`.

> **Status:** none of the InDesign-facing code has run inside Adobe InDesign or InDesign Server yet. InDesign is not installed on the machine where this layer was built. Read [Testing status](#testing-status) before relying on it.

---

## 1. Architecture

```
 ┌──────────────┐  heartbeat (30 s), jobs/next (poll)   ┌──────────────────────────────┐
 │ PressFlow API│ ◄──────────────────────────────────── │ Bridge worker (Python)       │
 │ services/api │ ──── job JSON, contract, assets.zip ─► │ services/indesign/bridge     │
 │              │ ◄──── POST result (indd, pdf, report)  │  runs on the InDesign machine│
 └──────────────┘                                       └──────────────┬───────────────┘
                                                                        │ one of:
                                  macOS desktop: osascript → AppleScript "do script … language javascript"
                                  Windows desktop: COM  app.DoScript(jsx, ScriptLanguage.JAVASCRIPT, [args])
                                  InDesign Server: SOAP RunScript (scriptFile + scriptArgs)
                                                                        ▼
                                                     ┌──────────────────────────────────┐
                                                     │ extendscript/pressflow-render.jsx │
                                                     │ contract → document → INDD / PDF  │
                                                     │ always writes out/report.json     │
                                                     └──────────────────────────────────┘
```

As an alternative to the bridge, a designer can use the **UXP panel** (`services/indesign/uxp/`) inside InDesign desktop. It claims a job, runs the same renderer, and uploads the result through the same API calls.

### Job lifecycle (bridge)

1. **Startup:** the bridge runs `list-fonts.jsx` once and caches the installed fonts and the InDesign version.
2. **Heartbeat:** every `HEARTBEAT_INTERVAL_SEC` (default 30), on a background thread.
3. **Poll:** `GET jobs/next` every `POLL_INTERVAL_SEC`. A 204 means nothing is queued. A 200 returns a job, which is now claimed.
4. **Prepare:** the bridge downloads the contract and `assets.zip` into `BRIDGE_WORK_DIR/jobs/<jobId>/`. Every zip member is validated before anything is written (see [Security](#10-security)), then the zip is extracted.
5. **Render:** the bridge writes `render-args.json` and runs `pressflow-render.jsx` through the runner.
6. **Collect:** the bridge reads `out/report.json` and checks that every requested output exists, is non-empty and is inside `out/`.
7. **Upload:** on success, a multipart POST with the files and the report. On any failure, a multipart POST with `status=failed` and the error. The job folder is then deleted, unless `BRIDGE_KEEP_JOB_DIRS=1`.

The bridge renders one job at a time, because InDesign desktop is single-threaded. Run more bridges, for example several InDesign Server instances on different ports, to scale out.

---

## 2. Bridge HTTP calls (exact)

Every request carries `Authorization: Bearer <INDESIGN_BRIDGE_TOKEN>` and `User-Agent: pressflow-indesign-bridge/0.1.0`. The token is sent **only** to the origin of `PRESSFLOW_API_URL`. If `contractUrl` or `assetsUrl` points at another host (for example a presigned storage URL), the bridge fetches it without the token.

| # | Call | Body / response |
|---|------|-----------------|
| 1 | `POST {API}/api/v1/indesign/bridge/heartbeat` | JSON `{"bridgeId", "hostname", "mode": "desktop"\|"server", "indesignVersion": "20.0.1.42"\|null, "platform": "darwin"\|"win32"\|"linux", "fonts": ["Minion Pro Bold", …]}`. Any 2xx is accepted. `fonts` is a sorted, de-duplicated list of `"<family> <style>"` strings. |
| 2 | `GET {API}/api/v1/indesign/bridge/jobs/next?bridgeId=<id>` | `204` means no job. `200` returns JSON `{"jobId", "exportId", "format", "contractUrl", "assetsUrl", "options": {"pdfPreset", "includeBleed"}}`. This call is **not retried** after a network error, because claiming is not idempotent. |
| 3 | `GET {API}/api/v1/indesign/bridge/jobs/{jobId}/contract` | The layout contract JSON. The bridge uses `contractUrl` if one is given (relative or absolute), otherwise this path. |
| 4 | `GET {API}/api/v1/indesign/bridge/jobs/{jobId}/assets.zip` | The zip of assets, laid out to match `contract.assets[].file`. The bridge uses `assetsUrl` if one is given. A `404` or `204` is tolerated only when `contract.assets` is empty. |
| 5 | `POST {API}/api/v1/indesign/bridge/jobs/{jobId}/result` | **Success:** `multipart/form-data` with fields `status=succeeded` and `report=<report.json text>`, plus files `indd` (always) and `pdf` (when the format includes a PDF) or `idml`. **Failure:** fields `status=failed`, `error=<message, at most 8000 chars>`, and `report=<json>` if the renderer wrote one. No files are sent on failure. |

**Job `format` to renderer outputs.** The INDD is always produced, for review.

| `format` | outputs | uploaded files |
|---|---|---|
| `indd` | indd | `indd` |
| `pdf`, `pdf_digital`, `digital_pdf` | indd, pdf_digital | `indd`, `pdf` |
| `pdf_print`, `print_pdf` | indd, pdf_print | `indd`, `pdf` |
| `idml` | indd, idml | `indd`, `idml` |
| anything else | the job fails with `unsupported export format` | — |

**Job `options`.**
- `pdfPreset` replaces the preset for the PDF this job produces.
- `includeBleed: true` adds the document bleed to the digital PDF. Print PDFs always include bleed.
- `force: true` is optional, and accepted only as a JSON boolean. It overrides the approval gate (see section 6).

Retries: downloads, uploads and 5xx/429 responses are retried with exponential backoff (1, 2, 4 s…). A 401 or 403 is never retried. The bridge logs `token not accepted` and backs off to 60 s.

**Optional, UXP panel only:** `GET {API}/api/v1/indesign/bridge/jobs?status=queued` returns a JSON array, or `{items: [...]}`, of queued jobs for display. If the API answers 404 or 405, the panel says listing is unavailable. Jobs are always claimed through `jobs/next`.

---

## 3. Contract to InDesign mapping

The contract and InDesign agree on units and coordinates as follows. All geometry is in points. The renderer sets `app.scriptPreferences.measurementUnit = POINTS`, sets the document's view units to points, and sets `viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN`. The frames' `bounds_pt` (`[top, left, bottom, right]`, relative to each page's trim box) can then be assigned directly to `geometricBounds`.

| Contract field | InDesign DOM |
|---|---|
| `document.page_width_pt` / `page_height_pt` | `documentPreferences.pageWidth` / `pageHeight` |
| `document.facing_pages` | `documentPreferences.facingPages` |
| `document.bleed_pt` (default 9) | `documentPreferences.documentBleedUniformSize = true`, `documentBleedTopOffset` (+ bottom/inside/outside) |
| `document.margins.top/bottom/inside/outside` | `marginPreferences.top/bottom/left/right`, set on the document, every master page and every page. In facing documents `left` = inside and `right` = outside. |
| `document.columns`, `gutter_pt` | `marginPreferences.columnCount`, `columnGutter`. `page.columns` overrides the page's column guides. |
| `document.baseline_pt` | `gridPreferences.baselineDivision`, `baselineStart = margins.top`, `baselineGridRelativeOption = TOP_OF_PAGE_…` |
| `document.template_document` | `app.open(<templateRoot>/<path>, showWindow, OpenOptions.OPEN_COPY)` (see section 7) |
| `styles.colors[]` (`name`, `hex`, `cmyk?`) | `document.colors.add({name})`, `model = ColorModel.PROCESS`, then `space = ColorSpace.CMYK` with `colorValue = cmyk`, or `space = ColorSpace.RGB` with `colorValue = [r, g, b]` from `hex`. The names `None`, `Paper`, `Black` and `Registration` map to the built-in swatches. |
| `styles.paragraph[]` | `paragraphStyles.add({name})`. `font_family` + `font_style` → `appliedFont = "Family\tStyle"` and `fontStyle` (with fallback, see section 8). `size_pt` → `pointSize`, `leading_pt` → `leading`, `tracking` → `tracking`, `color` → `fillColor`, `uppercase` → `capitalization = ALL_CAPS`/`NORMAL`, `align` → `justification` (`LEFT_ALIGN`, `CENTER_ALIGN`, `RIGHT_ALIGN`, `LEFT_JUSTIFIED`), `space_before_pt`/`space_after_pt` → `spaceBefore`/`spaceAfter`, `first_line_indent_pt` → `firstLineIndent`, `drop_cap_lines` → `dropCapLines` + `dropCapCharacters = 1` |
| `styles.character[]` | `characterStyles.add({name})`: `appliedFont`/`fontStyle`, `fillColor`. A `font_style` without a family sets only `fontStyle`. |
| `styles.object[]` | `objectStyles.add({name})`. `fill` → `enableFill` + `fillColor`, `stroke` → `enableStroke` + `strokeColor`, `stroke_weight_pt` → `strokeWeight`, `corner_radius_pt` → `enableStrokeAndCornerOptions` + `top/bottom Left/Right CornerOption = ROUNDED_CORNER` and `…CornerRadius`, `text_wrap` → `enableTextWrapAndOthers` + `textWrapPreferences.textWrapMode` (`NONE`, `BOUNDING_BOX_TEXT_WRAP`, `CONTOUR`) |
| `masters[].name` (`"A-Article"`) | `masterSpreads.add(facing ? 2 : 1, {namePrefix: "A", baseName: "Article"})`. In a new document the default empty master (A-Parent/A-Master) is reused for the first contract master. If the prefix is taken, the next free letter is used and a warning is recorded. |
| `masters[].folio` | One text frame per master page, labelled `pressflow:folio`. Content is `SpecialCharacters.AUTO_PAGE_NUMBER` plus `running_text`, separated by an em space. `paragraph_style` is applied, and the frame sits in the bottom or top margin. Outside edge per `page.side` (`LEFT_HAND` → left, otherwise right). `bottom_center` centres it. `none` adds no folio. |
| `pages[]` (sorted by `page_number`) | `documentPreferences.startPageNumber = first page_number` (an even start number in a facing document makes the first page a left page), then `pagesPerDocument = n`. Gaps in numbering → `sections.add(page, {continueNumbering: false, pageNumberStart: n})` plus a warning. A page whose side does not match its number's parity gets a warning. |
| `pages[].master` | `page.appliedMaster = <masterSpread>`. Absent, `"None"` or `"[None]"` → `NothingEnum.NOTHING` |
| `pages[].approved` | Approval gate (section 6) |
| `frames[]` order / `z` | Frames are created in ascending `z` (stable sort, default 0). Later frames stack on top. |
| `frames[].id` | `pageItem.label = id`. Also `insertLabel("pressflow", {"id", "role", "kind", "page"})` for round-tripping. |
| `frames[].label` | `pageItem.name` (Layers panel). Defaults to `id`. |
| `kind: "text"` | `page.textFrames.add({geometricBounds})`. `columns`/`gutter_pt` → `textFramePreferences.textColumnCount`/`textColumnGutter`. `content`: paragraphs split on blank lines (`\n\n`) and joined with `\r`. A single `\n` stays a forced line break. `paragraph_style` → `texts[0].applyParagraphStyle(style, true)` |
| `fit: "shrink_to_fit"` | Point size and leading are reduced in 1 % steps (99 % … 85 %, `shrinkMinScale`), and `overflows` is checked after each `recompose()`. If the text still doesn't fit, a warning is recorded and the frame is listed in `report.overset`. |
| `fit: "grow_frame"` | `textFramePreferences.autoSizingReferencePoint = TOP_CENTER_POINT`, `autoSizingType = HEIGHT_ONLY`. Before CS6, the bottom edge grows in 6 pt steps instead, up to the bleed. A warning is recorded if the frame grows past the trim. |
| `kind: "image"` | `page.rectangles.add()` → `place(File(assetRoot/asset.file), false)` → `fit(FILL_PROPORTIONALLY \| PROPORTIONALLY)` (or nothing for `center`). `scale` multiplies `absoluteHorizontalScale`/`absoluteVerticalScale`, then `fit(CENTER_CONTENT)`. `offset_x`/`offset_y` ∈ [-1, 1] move the image: 0 = centred, −1 = left/top edges aligned, +1 = right/bottom edges aligned (`move(undefined, [dx, dy])`). `credit` → `insertLabel("pressflow.credit")`. |
| `kind: "rect"` | `page.rectangles.add()` with `fill`/`stroke`/`stroke_weight_pt` |
| `kind: "line"` | `page.graphicLines.add({geometricBounds})`, then `paths[0].entirePath = [[left, top], [right, bottom]]`. The stroke defaults to Black 1 pt. |
| `fill` / `stroke` / `stroke_weight_pt` / `opacity` | `fillColor` / `strokeColor` / `strokeWeight` / `transparencySettings.blendingSettings.opacity = opacity × 100`. Image and rect frames without an object style get fill None and stroke None by default. |
| `object_style` | `applyObjectStyle(style, true)`, applied before the frame's own fill, stroke and columns, so those win |
| `assets[].file` | Must be relative with no `..`. Anything else is listed in `missingLinks` and not placed. |
| `assets[].width_px`, `height_px`, `pages[].headline/body/…` | Informational. The renderer draws only `frames[]`. |

**Bleed extension.** With `extendToBleed`, on by default, image and rect frames whose edge lies on an **outside** trim edge (within 0.5 pt) are extended by the bleed: top, bottom, the outside edge, and both sides on single-sided pages. Spine edges are never extended. Without this, full-bleed photos would leave white slivers in the print PDF.

---

## 4. Renderer: arguments and report

`extendscript/pressflow-render.jsx` is ES3 ExtendScript with a built-in JSON polyfill. It uses `//@target indesign` and `//@targetengine "pressflow"` comment directives. It looks for arguments in this order:

1. `arguments[0]`. This is how desktop runners pass a path to a JSON args file. It can also be an inline JSON string, or a list of `key=value` strings.
2. `app.scriptArgs` `argsFile`.
3. `app.scriptArgs` individual keys. This is how the InDesign Server SOAP runner passes them.
4. Interactive dialogs, when the script is run from the Scripts panel. The defaults are then `indd,pdf_digital` written to `<contract folder>/pressflow-out`.

Consumed `scriptArgs` are cleared, so a stale job cannot leak into a later run.

| Arg | Default | Meaning |
|---|---|---|
| `contractPath` | required | layout contract JSON |
| `assetRoot` | contract folder | base folder for `assets[].file` |
| `outDir` | `<contract folder>/pressflow-out` | output folder |
| `outputs` | `indd` | comma list of `indd`, `idml`, `pdf_digital`, `pdf_print` |
| `pdfPresetDigital` | `[High Quality Print]` | PDF preset name |
| `pdfPresetPrint` | `[PDF/X-4:2008]` | PDF preset name. Bleed and crop marks are forced on (see below). |
| `templatePath` | — | absolute path of an `.indt`/`.indd`. Overrides `document.template_document`. |
| `templateRoot` | `assetRoot` | base folder for `document.template_document`. The bridge sets it from `PRESSFLOW_TEMPLATE_ROOT`. |
| `force` | `false` | export final PDFs even if pages are not approved |
| `includeBleed` | `false` | add bleed to the digital PDF |
| `baseName`, `jobId` | slug of `project_id` | output file names, echoed in the report |
| `reportPath` | `<outDir>/report.json` | |
| `closeDocument` / `showWindow` | `true` / `false` (interactive: `false` / `true`) | |
| `shrinkMinScale` | `0.85` | lower bound for `shrink_to_fit` |
| `extendToBleed` | `true` | see the mapping table |

**Print PDF.** The preset is cloned to a temporary preset (`app.pdfExportPresets.add()` plus a copy of `preset.properties`). The clone gets `useDocumentBleedWithPDF = true`, `cropMarks = true` and `pageMarksOffset = max(6, bleed)`. The document is exported with the clone, which is then removed. If the overrides can't be applied, that output **fails**; it never silently falls back to a PDF without crop marks. A missing preset name fails with a list of the installed presets. Localised InDesign builds may name the built-in presets differently; set `PDF_PRESET_DIGITAL` and `PDF_PRESET_PRINT` in that case.

**`report.json`** is always written, including after a fatal error. The renderer also writes `render.log` next to it.

```json
{
  "ok": true, "error": null,
  "pages": 1,
  "overset": [{"page": 12, "frameId": "f3"}],
  "missingFonts": ["Minion Pro Bold"],
  "substitutedFonts": [{"requested": "Minion Pro Bold", "used": "Times New Roman Bold"}],
  "missingLinks": [{"page": 12, "frameId": "f1", "assetId": "ast_0001", "path": "/…/ast_0001.jpg", "reason": "file not found"}],
  "outputs": {"indd": "/…/out/pressflow-exp_1.indd", "pdf_digital": "/…/out/pressflow-exp_1-digital.pdf", "pdf_print": null},
  "durationMs": 8123, "indesignVersion": "20.0.1.42", "indesignApp": "Adobe InDesign 2025",
  "scriptVersion": "1.0.0", "jobId": "job_1", "templateUsed": null,
  "unapprovedPages": [], "blockedOutputs": [], "warnings": [], "errors": []
}
```

`ok` is `false` if anything in `errors` occurred. That covers an invalid contract, a missing template, a frame that could not be created, a failed save or export, and a refused PDF. Overset text, font substitutions and missing images are **not** errors. They are reported in their own lists, so the API and UI can decide whether to block publication.

---

## 5. Installation

### Common

```bash
cd services/indesign/bridge
python3 -m pip install .            # or: uv tool install .   (no runtime dependencies)
# Windows desktop only:
python -m pip install ".[windows]"  # pywin32
```

The wheel bundles `extendscript/*.jsx` (hatch `force-include`). When you run from a checkout, the bridge finds `services/indesign/extendscript/` on its own. Override with `PRESSFLOW_JSX_DIR`.

| Variable | Default | |
|---|---|---|
| `PRESSFLOW_API_URL` | — (required) | e.g. `https://pressflow.example.com` |
| `INDESIGN_BRIDGE_TOKEN` | — (required) | bridge token issued by the API. Never logged. |
| `INDESIGN_MODE` | `desktop` | `desktop` or `server` |
| `INDESIGN_SERVER_URL` | `http://localhost:18383` | SOAP endpoint (server mode) |
| `INDESIGN_APP_ID` | `com.adobe.InDesign` | macOS bundle id (the same for all recent versions) |
| `INDESIGN_COM_PROGID` | `InDesign.Application` | Windows COM ProgID, e.g. `InDesign.Application.2025` to pin a version |
| `BRIDGE_WORK_DIR` | `~/.pressflow-bridge` | job folders, fonts cache |
| `POLL_INTERVAL_SEC` | `5` | |
| `HEARTBEAT_INTERVAL_SEC` | `30` | |
| `RENDER_TIMEOUT_SEC` | `1800` | per job |
| `HTTP_TIMEOUT_SEC` | `60` | uploads use at least 600 s |
| `BRIDGE_ID` | `<hostname>-<mode>` | |
| `PRESSFLOW_TEMPLATE_ROOT` | — | folder holding approved `.indt` templates |
| `PRESSFLOW_JSX_DIR` | auto | |
| `PDF_PRESET_DIGITAL` / `PDF_PRESET_PRINT` | `[High Quality Print]` / `[PDF/X-4:2008]` | |
| `BRIDGE_MAX_ASSETS_BYTES` | 4 GiB | assets.zip download and extraction limit |
| `BRIDGE_KEEP_JOB_DIRS` | `0` | keep job folders for debugging |
| `LOG_FORMAT` / `LOG_LEVEL` | `text` / `INFO` | `json` gives one JSON object per line |

Commands:

```bash
python -m pressflow_bridge --check   # config, API reachable, token accepted, InDesign found; renders nothing
python -m pressflow_bridge --fonts   # run list-fonts.jsx in InDesign and print the result
python -m pressflow_bridge --once    # process at most one job, then exit
python -m pressflow_bridge           # run until SIGINT/SIGTERM (finishes the current job; a second signal aborts)
```

`--check` sends one real heartbeat with an empty font list to test the token, because that is the only bridge endpoint with no effect on jobs. The next regular heartbeat restores the font list.

### InDesign desktop on macOS

- Install InDesign and log in to Creative Cloud as the user who will run the bridge. Desktop InDesign needs a GUI login session, so the bridge cannot run as a background daemon before login.
- **How the runner works:** the bridge writes `render-args.json` and a small AppleScript (`render-args.applescript`, kept in the job folder for debugging). It then runs `osascript <script> <jsx> <args.json> <timeout>`. The script does `tell application id "com.adobe.InDesign" to do script (POSIX file jsx) language javascript with arguments {argsPath}` inside `with timeout of N seconds`. File paths travel as **argv**, never spliced into AppleScript source, so quoting is a non-issue. Only the validated bundle id is interpolated, because `tell application id` must be a literal for InDesign's dictionary terms to compile.
- **Automation permission:** the first run triggers the macOS prompt *"Terminal/python wants to control Adobe InDesign"*. Allow it, or pre-approve under System Settings → Privacy & Security → Automation. Without it, `osascript` fails with error -1743, and the bridge reports the job as failed.
- To run at login, use a LaunchAgent (not a LaunchDaemon) whose `ProgramArguments` runs `python -m pressflow_bridge` with the environment variables above.
- Keep InDesign free of other modal dialogs. The renderer sets `userInteractionLevel = NEVER_INTERACT` while it runs and restores it afterwards.

### InDesign desktop on Windows

- `pip install ".[windows]"` (pywin32). The runner calls `win32com.client.Dispatch("InDesign.Application").DoScript(jsx, 1246973031, [argsFile])` on a worker thread with `CoInitialize`. 1246973031 is `ScriptLanguage.JAVASCRIPT`, the four-char code `'JSLg'`.
- Run the bridge in the interactive user session, for example a Task Scheduler task set to "Run only when user is logged on". COM automation of desktop InDesign does not work from session 0 services.
- If several InDesign versions are installed, pin one with `INDESIGN_COM_PROGID=InDesign.Application.2025`.

### InDesign Server

- Start the server with a SOAP port: `InDesignServer -port 18383` (Windows: `InDesignServer.com -port 18383`).
- Set `INDESIGN_MODE=server` and `INDESIGN_SERVER_URL=http://localhost:18383`.
- The runner POSTs a SOAP 1.1 `RunScript` request. It uses the `IDSP` namespace `http://ns.adobe.com/InDesign/soap/` with unqualified child elements, matching the WSDL's `elementFormDefault="unqualified"`: `<runScriptParameters><scriptLanguage>javascript</scriptLanguage><scriptFile>…</scriptFile><scriptArgs><name>…</name><value>…</value></scriptArgs>…</runScriptParameters>`. Every renderer argument, plus `argsFile`, goes in as a `scriptArgs` pair. The runner treats a non-zero `errorNumber` or a SOAP `Fault` as failure. Faults usually arrive as HTTP 500.
- **Paths must resolve on the server.** The JSX path and `BRIDGE_WORK_DIR` are sent as file paths. Run the bridge on the same host as InDesign Server, or mount the work dir at the same path on both.
- One InDesign Server instance renders one job at a time. For throughput, run several instances on different ports, each with its own bridge (`BRIDGE_ID`, `INDESIGN_SERVER_URL`).
- `--check` runs a one-line `scriptText` (`app.name + ' ' + app.version`) to prove that the server answers.

**Licensing:** InDesign Server is the product Adobe licenses for automated, server-side rendering. Using desktop InDesign as an unattended render service for many users may not be covered by the desktop EULA. Check the Adobe terms that apply to your agreement.

---

## 6. Approval gate

The contract says renderers must refuse final output for content that is not approved. Any page whose `approved` is **not exactly `true`** counts as unapproved, **including pages with no `approved` field**. For such pages:

- `pdf_digital` and `pdf_print` are **not exported**. The report gets `ok: false`, `blockedOutputs`, `unapprovedPages`, and an error explaining that `force=true` overrides the gate.
- The INDD (and IDML) **is still saved** for review. A job with `format: "indd"` therefore succeeds even with unapproved pages.
- `force=true` (job `options.force: true`, or the `force` arg) exports anyway and records a warning.

A failed job uploads `status=failed` with the report, and no files are attached.

---

## 7. Approved-template workflow (exact reproduction)

Building styles from the contract reproduces the *design system* approximately: fonts, sizes, colours and geometry. For exact reproduction of a reference magazine (kerning tables, GREP styles, nested styles, OpenType features, hyphenation and justification settings, master artwork), give the renderer the publication's approved template:

1. In InDesign, save the reference publication as an `.indt` with the same page size, bleed and facing-pages setting as the contract.
2. Name its paragraph, character and object styles, swatches and masters **exactly** as the contract does: `PF Headline`, `PF Body`, `PF Ink`, `A-Article`, and so on. Styles may sit inside style groups.
3. Put the template in `PRESSFLOW_TEMPLATE_ROOT` (bridge) and set `document.template_document` to its path relative to that folder, e.g. `"egov/egov-2026.indt"`. Absolute paths and `..` in the contract are rejected. A missing template **fails** the job rather than silently building from scratch.

When a template is used:
- The document opens as an untitled copy (`OpenOptions.OPEN_COPY`), so the template file is never modified.
- Styles, swatches and masters that exist in the template are **reused as they are**. Their definitions are not overwritten by the contract, and masters that exist get no extra folio. Only names missing from the template are created from the contract.
- The template's page size, bleed and facing setting win. A mismatch with the contract is recorded as a warning.
- Existing document pages are resized to the contract's page count, and their page items are removed. The contract's frames define the pages.
- `report.templateUsed` records the path.

---

## 8. Fonts

- Fonts must be **installed and licensed on the render machine**: system font folders, InDesign's `Fonts` folder, or activated Adobe Fonts for the logged-in user. InDesign Server needs fonts installed for the account the server runs under. Font licences often distinguish desktop use, server use and PDF embedding, so check the licence for each family you deploy.
- The heartbeat publishes the installed `"Family Style"` list (from `list-fonts.jsx`), so the API can warn before a job is queued.
- Resolution order for a requested `font_family` + `font_style`:
  1. Exact match.
  2. Style aliases in the same family (e.g. `Regular` ↔ `Roman`/`Book`, `Semibold` ↔ `SemiBold`/`Demi`).
  3. `fallback_family` with the same style.
  4. `fallback_family` as a PostScript name.
  5. PDF base-14 mapping (`Times-Bold` → Times New Roman Bold / Times Bold / Minion Pro Bold; `Helvetica` → Helvetica / Arial / Myriad Pro…).
  6. `fallback_family` Regular.
  7. Minion Pro, Myriad Pro, Times New Roman, Arial, Helvetica or Times, in the same style, then Regular.
- Every non-exact match is recorded in `report.substitutedFonts` (`{requested, used}`) and `report.missingFonts`. If nothing at all is found, `used` is `null` and the InDesign default font remains. After layout, any font in `document.fonts` whose status is not `INSTALLED` (from a template, for example) is also added to `missingFonts`.

---

## 9. UXP panel

`services/indesign/uxp/`: manifest v5, host `ID` 18.5 or later, plain HTML and JavaScript.

- **Load it:** run `make uxp-sync` in `services/indesign`. This copies the renderer to `uxp/jsx/`, because a UXP plugin can't read files outside its own folder. Then open the **UXP Developer Tool**, choose *Add Plugin*, select `services/indesign/uxp/manifest.json`, and click *Load*. The panel appears under *Plugins → PressFlow*.
- **Settings:** API URL and bridge ID are kept in `localStorage`. The bridge token is kept in UXP `secureStorage`; it is never hard-coded and never written to plugin files.
- **Render next job:**
  1. Claims a job with `jobs/next`, using the panel's bridge ID.
  2. Downloads the contract and `assets.zip` into the UXP temporary folder.
  3. Unpacks the zip with a bundled pure-JS zip reader and DEFLATE decoder (`lib/unzip.js`). Path traversal, absolute paths, symlinks and encrypted entries are rejected, and CRC-32 is verified.
  4. Runs `app.doScript(<renderer source>, ScriptLanguage.JAVASCRIPT, [argsFile])`. The args file is also set as `app.scriptArgs` `argsFile`, which is cleared afterwards.
  5. Reads `report.json` and uploads the result with the same multipart format as the bridge. Failures are reported as `status=failed`.
- *Keep rendered document open* leaves the INDD open for review instead of closing it.
- *Refresh queue* uses the optional listing endpoint (section 2).
- Permissions: `network.domains: "all"`, because the API URL is user-configurable (restrict it to your API host for production), and `localFileSystem: "plugin"`.
- The panel blocks InDesign while the renderer runs. The pure-JS unzip is slower than native code for very large asset sets, so use the bridge for production volume.

---

## 10. Security

- **Zip extraction** (bridge `safezip.py` and UXP `unzip.js`): every member is validated before anything is written. The extractor rejects absolute paths, drive letters, `..`, NUL or `:` in names, and symlinks. It enforces limits on entry count and declared and actual decompressed size; a member that inflates beyond its declared size counts as a zip bomb.
- Contract asset paths and `template_document` must be relative with no `..`. The renderer refuses to place anything else.
- Uploaded outputs must resolve inside the job's `out/` folder, so a hostile report cannot make the bridge upload arbitrary files.
- The bearer token goes only to the API origin. Logs strip query strings from URLs, which matters for presigned URLs. The token never appears in logs or in `--check` output.

---

## Testing status

**Nothing here has been executed inside Adobe InDesign or InDesign Server.** Neither is installed on the development machine. No `.indd` or PDF in this repository, the tests or the reports was produced by InDesign. The mock harness writes placeholder files that are clearly marked `PRESSFLOW-MOCK-OUTPUT`, only into temporary test folders.

### Verified on the development machine (macOS, Node 22, Python 3.13 and 3.14)

| What | How |
|---|---|
| Both `.jsx` files parse | `node --check` (fed via stdin, because Node refuses the `.jsx` extension), `scripts/check-jsx.sh` / `make check-jsx` |
| Both `.jsx` files are ES3 | Strict ES3 parse with acorn (`ecmaVersion: 3`, reserved words disallowed; optional via `ACORN_DIR`). A pytest lint confirms ASCII-only source and no ES5+ built-ins (`JSON.`, `forEach`, `trim`, `Object.keys`…) and no trailing commas. |
| Renderer logic | `tests/js/mock_indesign.js` runs the real `pressflow-render.jsx` in Node against a **fake** InDesign DOM. Covered: argument sources (args file and server-style `scriptArgs`), JSON polyfill, contract validation, report-on-failure, page numbering and sections, master/folio creation, frame creation order, image fitting calls, font substitution chain, approval gate and `force`, shrink-to-fit and grow-frame paths, unsafe asset paths, template reuse (including grouped styles), and the print-preset clone that **fails loudly** if crop marks can't be forced. Enum members and property names the script uses were cross-checked against the public DOM reference (indesignjs.de) for `Sections.add`, `MasterSpreads.add`, `PDFExportPreset`, `Document`, `TextFramePreference`, `Font`, `ObjectStyle`, `FitOptions`, `GridPreference`, `Rectangle`, `Image` and `Page`. That cross-check caught one real bug (`viewPDF` is not a preset property), which is now fixed. |
| Bridge | pytest against a real local HTTP fake API: heartbeat payload and fonts, 204/200 polling, contract and assets download, safe extraction, success upload (multipart parsed back), renderer failure, runner crash without a report, missing or escaping outputs, unsafe zip, unsupported format, bad token, `--once`, `--check`. Also: osascript command and AppleScript text (mocked `subprocess`), SOAP envelope and response parsing (mocked HTTP, envelope checked against the WSDL's unqualified-element form), COM fallback without pywin32, and config parsing. |
| UXP libraries | `node --test tests/js/uxp_libs.test.js`: the DEFLATE decoder matches zlib at levels 0–9, the zip reader handles stored, deflated and Python-`zipfile` archives and rejects traversal, symlinks and encryption and checks CRC; also the multipart builder, URL and token scoping, format mapping |
| Contract | `layout-contract.example.json` validates against the JSON Schema (Draft 2020-12) |

Run everything with `cd services/indesign && make check`, or `uv run --no-project --with pytest --with jsonschema pytest`. Current result: **84 passed**.

### Requires a machine with InDesign (not yet done)

1. `python -m pressflow_bridge --check` and `--fonts` on a real InDesign desktop (macOS and Windows) and on InDesign Server. This confirms the runner invocation, the macOS Automation prompt, COM `DoScript` with an args array, and the SOAP `RunScript` round trip.
2. Render `packages/contracts/layout-contract.example.json` (with a real `photos/ast_0001.jpg`) to INDD, digital PDF and print PDF, then inspect:
   - page 12 as a left-hand page, and the folio position and number;
   - hero image fill and bleed extension;
   - headline shrink-to-fit;
   - two-column body text;
   - crop marks and bleed in the PDF/X-4 output.
3. Behaviour that only real InDesign can show:
   - text composition and overset (the mock uses a crude character-count model);
   - `startPageNumber` page sides;
   - master prefix collisions;
   - `appliedFont = "Family\tStyle"` on styles;
   - cloning a built-in PDF preset via `properties`;
   - `place()` and fitting of real images, plus the `scale` and `offset` maths;
   - auto-sizing;
   - `doc.save()` from an `.indt` opened as a copy;
   - localised preset names.
4. The UXP panel in InDesign 18.5 or later: whether `app.doScript(text, ScriptLanguage.JAVASCRIPT, [args])` passes `arguments[0]` (the `scriptArgs` fallback exists in case it doesn't), `secureStorage`, `fetch` with an `ArrayBuffer` body, and writes to the temp folder.
5. Performance: very large documents and asset sets, and the 30-minute default timeout.

### Open questions for the API team

- `jobs/next` and the result endpoint as implemented here are listed in section 2. The bridge also sends `status=succeeded` on success, and `report` on failure when one exists.
- Unapproved pages: a missing `approved` field is treated as **not approved**. If the backend omits the field for approved pages, final PDFs will be refused.
- `options.force` (a JSON boolean) is the only way to override the approval gate from a job.
- The heartbeat `fonts` field is a list of `"Family Style"` strings.
- The optional `GET …/bridge/jobs?status=queued` endpoint is used by the UXP panel's queue list.
- Claim leases: if a bridge dies mid-job, the API should re-queue claimed jobs that receive no result within some timeout. The bridge does not retry `jobs/next`, because claiming is not idempotent.
