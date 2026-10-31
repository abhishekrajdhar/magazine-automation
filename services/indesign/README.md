# PressFlow: InDesign automation layer

This service renders PressFlow layout contracts into Adobe InDesign documents (`.indd`) and press-ready PDFs. It uses the reference magazine's design system, or an approved `.indt` template.

> **Not yet run inside InDesign.** InDesign was not available where this was built. Syntax, ES3 compatibility, the renderer's logic (against a mock DOM), the bridge and the UXP libraries are tested. The real InDesign round trip still needs a machine with InDesign. See [docs/indesign.md, "Testing status"](../../docs/indesign.md#testing-status).

```
PressFlow API ──jobs/next, contract, assets.zip──► bridge (Python, on the InDesign machine)
      ▲                                               │ osascript (macOS) │ COM (Windows) │ SOAP RunScript (InDesign Server)
      └──── POST result: indd, pdf, report ◄──────────┴──► extendscript/pressflow-render.jsx → report.json
```

## Layout

```
services/indesign/
├── extendscript/
│   ├── pressflow-render.jsx   # contract → InDesign document → INDD / PDF + report.json (ES3 ExtendScript)
│   └── list-fonts.jsx         # installed fonts as JSON (bridge heartbeat)
├── bridge/                    # Python bridge worker, stdlib only (pywin32 optional for Windows)
│   ├── pyproject.toml
│   └── pressflow_bridge/      # config, api, runners, jobs, safezip, multipart, worker, check
├── uxp/                       # UXP panel (manifest v5) for InDesign desktop
│   ├── manifest.json, index.html, main.js
│   ├── lib/unzip.js, lib/pressflow.js
│   └── jsx/pressflow-render.jsx   # copy of the renderer (make uxp-sync)
├── tests/                     # pytest + Node tests (mock InDesign DOM, UXP libs)
├── scripts/check-jsx.sh       # node --check on all .jsx/.js (+ optional strict ES3 parse)
├── Makefile, pytest.ini
```

## Quick start

```bash
cd services/indesign
make check            # node --check on the JSX/JS + full pytest suite (84 tests)

# Bridge, on the machine running InDesign desktop or InDesign Server:
cd bridge && python3 -m pip install .          # Windows desktop: pip install ".[windows]"
export PRESSFLOW_API_URL=https://pressflow.example.com
export INDESIGN_BRIDGE_TOKEN=...               # issued by the API; never logged
export INDESIGN_MODE=desktop                   # or: server + INDESIGN_SERVER_URL=http://localhost:18383
python -m pressflow_bridge --check             # API reachable? token accepted? InDesign found? (renders nothing)
python -m pressflow_bridge                     # poll for jobs; SIGINT/SIGTERM finishes the current job
```

Run the renderer by hand from InDesign: *Window → Utilities → Scripts → User*, add `extendscript/pressflow-render.jsx`, and double-click it. It asks for a contract JSON and an asset folder, then writes `pressflow-out/` next to the contract.

UXP panel: run `make uxp-sync`, then in the **UXP Developer Tool** choose *Add Plugin*, select `uxp/manifest.json` and click *Load*. Enter the API URL and bridge token in the panel's settings.

## Key behaviours

- **Approval gate:** pages without `approved: true` block `pdf_digital` and `pdf_print` (the report gets `ok: false`). The INDD is still saved for review. `force=true` overrides the gate.
- **Fonts:** missing fonts are substituted through `fallback_family`, a PDF base-14 mapping and last-resort families. Every substitution is reported in `substitutedFonts` and `missingFonts`. Fonts must be installed and licensed on the render machine.
- **Templates:** an approved `.indt` whose style, swatch and master names match the contract is reproduced exactly. The renderer reuses those definitions and creates only the missing names.
- **Text fitting:** `shrink_to_fit` reduces size and leading in 1 % steps down to 85 %. `grow_frame` uses InDesign auto-sizing. Frames that remain overset are listed in `report.overset`.
- **Failures are failures:** the bridge uploads `status=failed` when there is no report, when `ok: false`, when an output is missing, empty or outside the job folder, when a zip is unsafe, or when the format is unsupported. Placeholder outputs are never uploaded.

Full details: [docs/indesign.md](../../docs/indesign.md). It covers the architecture, the exact HTTP calls, the contract-to-DOM mapping table, installation for macOS, Windows and InDesign Server, the UXP panel, fonts and licensing, the template workflow, security and testing status.
