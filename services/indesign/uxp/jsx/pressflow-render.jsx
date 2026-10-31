//@target indesign
//@targetengine "pressflow"
/*
 * PressFlow AI - InDesign renderer (ExtendScript, ES3).
 *
 * Renders a PressFlow layout contract (packages/contracts/layout-contract.schema.json,
 * contract_version "1.0") into an Adobe InDesign document, saves .indd / exports PDFs,
 * and ALWAYS writes report.json (also on failure).
 *
 * STATUS: written against the documented InDesign scripting DOM (CS6 .. 2025) but NOT
 * yet executed inside InDesign. See docs/indesign.md, "Testing status".
 *
 * Arguments (first source that yields arguments wins):
 *   1. arguments[0] from doScript(..., withArguments) / AppleScript "do script ... with
 *      arguments" / COM DoScript: either a path to a JSON args file (recommended), a JSON
 *      object string, or a list of "key=value" strings.
 *   2. app.scriptArgs "argsFile" (path to a JSON args file).
 *   3. app.scriptArgs individual keys (InDesign Server SOAP RunScript scriptArgs).
 *   4. Interactive dialogs (desktop only, when the script is run from the Scripts panel).
 *
 * Keys:
 *   contractPath (required)  layout contract JSON
 *   assetRoot                folder that contract.assets[].file is relative to (default: contract folder)
 *   outDir                   output folder (default: <contract folder>/pressflow-out)
 *   outputs                  comma list of indd,idml,pdf_digital,pdf_print (default: indd)
 *   pdfPresetDigital         default "[High Quality Print]"
 *   pdfPresetPrint           default "[PDF/X-4:2008]" (bleed + crop marks forced on)
 *   templatePath             absolute .indt/.indd; overrides document.template_document
 *   templateRoot             folder that document.template_document is relative to (default: assetRoot)
 *   force                    "true" exports final PDFs even if pages are not approved
 *   includeBleed             "true" adds document bleed to the digital PDF
 *   baseName                 output file base name (default: slug of project_id / title)
 *   jobId                    echoed into the report
 *   reportPath               default <outDir>/report.json
 *   closeDocument            default true (false in interactive mode)
 *   showWindow               default false (true in interactive mode)
 *   shrinkMinScale           lower bound for fit:"shrink_to_fit" (default 0.85)
 *   extendToBleed            extend image/rect frames touching an outside trim edge into the bleed (default true)
 */

var __PF_TOP_ARGS = (typeof arguments !== "undefined") ? arguments : null;

(function (topArgs) {
    var SCRIPT_VERSION = "1.0.0";
    var SUPPORTED_CONTRACT = "1.0";
    var T0 = new Date().getTime();
    var LOG = [];

    // ------------------------------------------------------------------ helpers (ES3)
    function now() { return new Date().getTime(); }
    function isArray(v) { return Object.prototype.toString.call(v) === "[object Array]"; }
    function has(o, k) { return o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k); }
    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function indexOf(arr, v) {
        var i;
        for (i = 0; i < arr.length; i++) { if (arr[i] === v) { return i; } }
        return -1;
    }
    function pushUnique(arr, v) { if (indexOf(arr, v) < 0) { arr.push(v); } }
    function isNum(v) { return typeof v === "number" && !isNaN(v) && isFinite(v); }
    function num(v, d) {
        if (v === null || v === undefined || v === "") { return d; }
        var n = Number(v);
        return isNaN(n) ? d : n;
    }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function round2(n) { return Math.round(n * 100) / 100; }
    function toBool(v, d) {
        if (v === true || v === false) { return v; }
        if (v === null || v === undefined || v === "") { return d; }
        var s = String(v).toLowerCase();
        if (s === "true" || s === "1" || s === "yes" || s === "on") { return true; }
        if (s === "false" || s === "0" || s === "no" || s === "off") { return false; }
        return d;
    }
    function errText(e) {
        if (e === null || e === undefined) { return "unknown error"; }
        var s = (e.message !== undefined) ? String(e.message) : String(e);
        if (e.line) { s += " (line " + e.line + ")"; }
        return s;
    }
    function log(msg) {
        var line = "[+" + (now() - T0) + "ms] " + msg;
        LOG.push(line);
        try { $.writeln("[pressflow] " + line); } catch (e) { /* no console */ }
    }
    function isMac() {
        try { return File.fs === "Macintosh"; } catch (e) { return false; }
    }
    function slug(s) {
        var out = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (out.length > 60) { out = out.substring(0, 60).replace(/-+$/g, ""); }
        return out;
    }

    // ------------------------------------------------------------------ JSON polyfill
    var PFJSON = (function () {
        var ESC = { "\"": "\"", "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t" };
        var QUOTE = { "\\": "\\\\", "\"": "\\\"", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };

        function parse(text) {
            var s = String(text), i = 0, n;
            if (s.charCodeAt(0) === 0xFEFF) { s = s.substring(1); }
            n = s.length;
            function fail(msg) { throw new Error("Invalid JSON: " + msg + " at offset " + i); }
            function ws() {
                var c;
                while (i < n) {
                    c = s.charAt(i);
                    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; } else { break; }
                }
            }
            function word(w, v) {
                if (s.substring(i, i + w.length) !== w) { fail("expected '" + w + "'"); }
                i += w.length;
                return v;
            }
            function number() {
                var m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+\-]?[0-9]+)?/.exec(s.substring(i, i + 64));
                if (!m) { fail("bad number"); }
                i += m[0].length;
                return Number(m[0]);
            }
            function string() {
                var out = "", q, b, c, hex;
                i++; // opening quote
                while (true) {
                    q = s.indexOf("\"", i);
                    b = s.indexOf("\\", i);
                    if (q < 0) { fail("unterminated string"); }
                    if (b >= 0 && b < q) {
                        out += s.substring(i, b);
                        c = s.charAt(b + 1);
                        if (c === "u") {
                            hex = s.substring(b + 2, b + 6);
                            if (!/^[0-9a-fA-F]{4}$/.test(hex)) { i = b; fail("bad unicode escape"); }
                            out += String.fromCharCode(parseInt(hex, 16));
                            i = b + 6;
                        } else {
                            if (!has(ESC, c)) { i = b; fail("bad escape"); }
                            out += ESC[c];
                            i = b + 2;
                        }
                    } else {
                        out += s.substring(i, q);
                        i = q + 1;
                        return out;
                    }
                }
            }
            function array() {
                var a = [], c;
                i++;
                ws();
                if (s.charAt(i) === "]") { i++; return a; }
                while (true) {
                    a.push(value());
                    ws();
                    c = s.charAt(i);
                    if (c === ",") { i++; continue; }
                    if (c === "]") { i++; return a; }
                    fail("expected ',' or ']'");
                }
            }
            function object() {
                var o = {}, k, c;
                i++;
                ws();
                if (s.charAt(i) === "}") { i++; return o; }
                while (true) {
                    ws();
                    if (s.charAt(i) !== "\"") { fail("expected string key"); }
                    k = string();
                    ws();
                    if (s.charAt(i) !== ":") { fail("expected ':'"); }
                    i++;
                    o[k] = value();
                    ws();
                    c = s.charAt(i);
                    if (c === ",") { i++; continue; }
                    if (c === "}") { i++; return o; }
                    fail("expected ',' or '}'");
                }
            }
            function value() {
                var c;
                ws();
                if (i >= n) { fail("unexpected end of input"); }
                c = s.charAt(i);
                if (c === "{") { return object(); }
                if (c === "[") { return array(); }
                if (c === "\"") { return string(); }
                if (c === "t") { return word("true", true); }
                if (c === "f") { return word("false", false); }
                if (c === "n") { return word("null", null); }
                if (c === "-" || (c >= "0" && c <= "9")) { return number(); }
                fail("unexpected character '" + c + "'");
                return null;
            }
            var result = value();
            ws();
            if (i < n) { fail("unexpected trailing characters"); }
            return result;
        }

        function quote(str) {
            return "\"" + String(str).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
                if (has(QUOTE, c)) { return QUOTE[c]; }
                var h = c.charCodeAt(0).toString(16);
                while (h.length < 4) { h = "0" + h; }
                return "\\u" + h;
            }) + "\"";
        }

        function stringify(v, indent, cur) {
            var t, inner, nl, sep, parts = [], i, k;
            indent = indent || "";
            cur = cur || "";
            if (v === null || v === undefined) { return "null"; }
            t = typeof v;
            if (t === "number") { return isFinite(v) ? String(v) : "null"; }
            if (t === "boolean") { return v ? "true" : "false"; }
            if (t === "string") { return quote(v); }
            if (t === "function") { return "null"; }
            inner = cur + indent;
            nl = indent ? "\n" : "";
            sep = indent ? ": " : ":";
            if (isArray(v)) {
                for (i = 0; i < v.length; i++) { parts.push(inner + stringify(v[i], indent, inner)); }
                return parts.length ? "[" + nl + parts.join("," + nl) + nl + cur + "]" : "[]";
            }
            for (k in v) {
                if (has(v, k) && v[k] !== undefined && typeof v[k] !== "function") {
                    parts.push(inner + quote(k) + sep + stringify(v[k], indent, inner));
                }
            }
            return parts.length ? "{" + nl + parts.join("," + nl) + nl + cur + "}" : "{}";
        }

        return { parse: parse, stringify: stringify };
    }());

    // ------------------------------------------------------------------ files & paths
    function ensureFolder(folder) {
        if (!folder) { return; }
        if (folder.exists) { return; }
        ensureFolder(folder.parent);
        folder.create();
    }
    function readTextFile(path) {
        var f = new File(path), s;
        if (!f.exists) { throw new Error("File not found: " + path); }
        f.encoding = "UTF-8";
        if (!f.open("r")) { throw new Error("Cannot open " + path + ": " + f.error); }
        s = f.read();
        f.close();
        return s;
    }
    function writeTextFile(path, text) {
        var f = new File(path);
        ensureFolder(f.parent);
        f.encoding = "UTF-8";
        f.lineFeed = "Unix";
        if (!f.open("w")) { throw new Error("Cannot write " + path + ": " + f.error); }
        f.write(text);
        f.close();
        return f.fsName;
    }
    function joinPath(a, b) {
        a = String(a);
        b = String(b);
        var sep = (a.indexOf("\\") >= 0 && a.indexOf("/") < 0) ? "\\" : "/";
        b = b.replace(/[\\\/]+/g, sep);
        if (!a) { return b; }
        var last = a.charAt(a.length - 1);
        if (last === "/" || last === "\\") { return a + b; }
        return a + sep + b;
    }
    function isAbsolutePath(p) {
        p = String(p);
        return p.charAt(0) === "/" || p.charAt(0) === "~" || /^[A-Za-z]:/.test(p) || p.substring(0, 2) === "\\\\";
    }
    function isSafeRelativePath(p) {
        var parts, i;
        if (p === null || p === undefined) { return false; }
        p = String(p);
        if (!p || isAbsolutePath(p) || p.charAt(0) === "\\") { return false; }
        parts = p.split(/[\\\/]+/);
        for (i = 0; i < parts.length; i++) { if (parts[i] === "..") { return false; } }
        return true;
    }

    // ------------------------------------------------------------------ report
    function newReport() {
        var r = {
            ok: false,
            pages: 0,
            overset: [],
            missingFonts: [],
            substitutedFonts: [],
            missingLinks: [],
            outputs: { indd: null, pdf_digital: null, pdf_print: null },
            durationMs: 0,
            indesignVersion: null,
            indesignApp: null,
            scriptVersion: SCRIPT_VERSION,
            jobId: null,
            templateUsed: null,
            unapprovedPages: [],
            blockedOutputs: [],
            warnings: [],
            errors: []
        };
        try { r.indesignVersion = String(app.version); } catch (e) { /* ignore */ }
        try { r.indesignApp = String(app.name); } catch (e2) { /* ignore */ }
        return r;
    }

    // ------------------------------------------------------------------ arguments
    var ARG_KEYS = ["contractPath", "assetRoot", "outDir", "outputs", "pdfPresetDigital", "pdfPresetPrint",
        "templatePath", "templateRoot", "force", "includeBleed", "baseName", "jobId", "reportPath",
        "closeDocument", "showWindow", "shrinkMinScale", "extendToBleed"];
    var OUTPUT_KINDS = ["indd", "idml", "pdf_digital", "pdf_print"];

    function argsFromObject(obj, into) {
        var i, k;
        for (i = 0; i < ARG_KEYS.length; i++) {
            k = ARG_KEYS[i];
            if (has(obj, k) && obj[k] !== null && obj[k] !== undefined) { into[k] = obj[k]; }
        }
        return into;
    }

    function readArgs(top) {
        var a = {}, first, i, kv, eq, src = null, af;
        if (top && top.length > 0 && top[0] !== undefined && top[0] !== null && String(top[0]) !== "") {
            first = String(top[0]);
            if (trim(first).charAt(0) === "{") {
                argsFromObject(PFJSON.parse(first), a);
                src = "arguments[0] (JSON)";
            } else if (/\.json$/i.test(first) && new File(first).exists) {
                argsFromObject(PFJSON.parse(readTextFile(first)), a);
                src = "arguments[0] (args file " + first + ")";
            } else {
                for (i = 0; i < top.length; i++) {
                    kv = String(top[i]);
                    eq = kv.indexOf("=");
                    if (eq > 0) { a[trim(kv.substring(0, eq))] = kv.substring(eq + 1); }
                }
                src = "arguments (key=value)";
            }
        }
        if (!src) {
            try {
                if (app.scriptArgs.isDefined("argsFile")) {
                    af = app.scriptArgs.getValue("argsFile");
                    argsFromObject(PFJSON.parse(readTextFile(af)), a);
                    src = "scriptArgs.argsFile";
                }
                for (i = 0; i < ARG_KEYS.length; i++) {
                    if (app.scriptArgs.isDefined(ARG_KEYS[i])) {
                        a[ARG_KEYS[i]] = app.scriptArgs.getValue(ARG_KEYS[i]);
                        if (!src) { src = "scriptArgs"; }
                    }
                }
                // scriptArgs persist for the whole desktop session; clear them so a later
                // interactive run does not silently reuse a previous job's arguments.
                if (src) { try { app.scriptArgs.clear(); } catch (eClear) { /* ignore */ } }
            } catch (eArgs) {
                if (src) { throw eArgs; }
            }
        }
        if (!src) {
            a = interactiveArgs();
            src = "interactive";
        }
        a.__source = src;
        return a;
    }

    function interactiveArgs() {
        var isServer = false, cf, af, a = { interactive: true };
        try { isServer = String(app.name).indexOf("Server") >= 0; } catch (e) { isServer = false; }
        if (isServer) { throw new Error("No arguments supplied (InDesign Server requires scriptArgs)."); }
        cf = File.openDialog("PressFlow: choose a layout contract (.json)",
            isMac() ? function (f) { return (f instanceof Folder) || /\.json$/i.test(f.name); } : "JSON:*.json,All files:*.*");
        if (!cf) { throw new Error("Cancelled: no layout contract selected."); }
        a.contractPath = cf.fsName;
        af = Folder.selectDialog("PressFlow: choose the asset root folder (Cancel = the contract's folder)");
        a.assetRoot = af ? af.fsName : cf.parent.fsName;
        a.outDir = joinPath(cf.parent.fsName, "pressflow-out");
        a.outputs = "indd,pdf_digital";
        return a;
    }

    function parseOutputs(v) {
        var list = isArray(v) ? v : String(v || "").split(","), out = [], i, k;
        for (i = 0; i < list.length; i++) {
            k = trim(String(list[i])).toLowerCase();
            if (!k) { continue; }
            if (indexOf(OUTPUT_KINDS, k) < 0) { throw new Error("Unknown output '" + k + "' (allowed: " + OUTPUT_KINDS.join(", ") + ")"); }
            pushUnique(out, k);
        }
        return out;
    }

    function normalizeArgs(a) {
        var o = {}, cf;
        if (!a.contractPath) { throw new Error("Missing required argument: contractPath"); }
        o.contractPath = String(a.contractPath);
        cf = new File(o.contractPath);
        o.interactive = !!a.interactive;
        o.assetRoot = a.assetRoot ? String(a.assetRoot) : cf.parent.fsName;
        o.outDir = a.outDir ? String(a.outDir) : joinPath(cf.parent.fsName, "pressflow-out");
        o.outputs = parseOutputs(a.outputs || "indd");
        o.pdfPresetDigital = a.pdfPresetDigital ? String(a.pdfPresetDigital) : "[High Quality Print]";
        o.pdfPresetPrint = a.pdfPresetPrint ? String(a.pdfPresetPrint) : "[PDF/X-4:2008]";
        o.templatePath = a.templatePath ? String(a.templatePath) : "";
        o.templateRoot = a.templateRoot ? String(a.templateRoot) : o.assetRoot;
        o.force = toBool(a.force, false);
        o.includeBleed = toBool(a.includeBleed, false);
        o.baseName = a.baseName ? slug(a.baseName) : "";
        o.jobId = a.jobId ? String(a.jobId) : "";
        o.reportPath = a.reportPath ? String(a.reportPath) : joinPath(o.outDir, "report.json");
        o.closeDocument = toBool(a.closeDocument, !o.interactive);
        o.showWindow = toBool(a.showWindow, o.interactive);
        o.shrinkMinScale = clamp(num(a.shrinkMinScale, 0.85), 0.5, 1);
        o.extendToBleed = toBool(a.extendToBleed, true);
        return o;
    }

    // ------------------------------------------------------------------ contract validation
    var FRAME_KINDS = ["text", "image", "rect", "line"];

    function validateContract(c) {
        var p = [], d, i, j, pg, fr, seenPages = {}, seenAssets = {}, b;
        if (!c || typeof c !== "object" || isArray(c)) { throw new Error("Contract is not a JSON object."); }
        if (c.contract_version !== SUPPORTED_CONTRACT) {
            p.push("unsupported contract_version '" + c.contract_version + "' (renderer supports " + SUPPORTED_CONTRACT + ")");
        }
        d = c.document;
        if (!d || typeof d !== "object") { p.push("document missing"); } else {
            if (!isNum(d.page_width_pt) || d.page_width_pt <= 0) { p.push("document.page_width_pt must be > 0"); }
            if (!isNum(d.page_height_pt) || d.page_height_pt <= 0) { p.push("document.page_height_pt must be > 0"); }
            if (!d.margins || typeof d.margins !== "object") { p.push("document.margins missing"); }
            if (!isNum(d.columns) || d.columns < 1) { p.push("document.columns must be >= 1"); }
            if (!isNum(d.gutter_pt) || d.gutter_pt < 0) { p.push("document.gutter_pt must be >= 0"); }
        }
        if (!c.styles || !isArray(c.styles.colors) || !isArray(c.styles.paragraph)) { p.push("styles.colors and styles.paragraph must be arrays"); }
        if (!isArray(c.assets)) { p.push("assets must be an array"); } else {
            for (i = 0; i < c.assets.length; i++) {
                if (!c.assets[i] || !c.assets[i].id) { p.push("assets[" + i + "].id missing"); continue; }
                if (seenAssets[c.assets[i].id]) { p.push("duplicate asset id " + c.assets[i].id); }
                seenAssets[c.assets[i].id] = true;
            }
        }
        if (!isArray(c.pages) || c.pages.length < 1) { p.push("pages must be a non-empty array"); } else {
            for (i = 0; i < c.pages.length; i++) {
                pg = c.pages[i];
                if (!pg || !isNum(pg.page_number) || pg.page_number < 1 || Math.floor(pg.page_number) !== pg.page_number) {
                    p.push("pages[" + i + "].page_number must be an integer >= 1");
                    continue;
                }
                if (seenPages[pg.page_number]) { p.push("duplicate page_number " + pg.page_number); }
                seenPages[pg.page_number] = true;
                if (!isArray(pg.frames)) { p.push("page " + pg.page_number + ": frames must be an array"); continue; }
                for (j = 0; j < pg.frames.length; j++) {
                    fr = pg.frames[j];
                    if (!fr || !fr.id) { p.push("page " + pg.page_number + " frame[" + j + "]: id missing"); continue; }
                    if (indexOf(FRAME_KINDS, fr.kind) < 0) { p.push("page " + pg.page_number + " frame " + fr.id + ": unknown kind '" + fr.kind + "'"); }
                    b = fr.bounds_pt;
                    if (!isArray(b) || b.length !== 4 || !isNum(b[0]) || !isNum(b[1]) || !isNum(b[2]) || !isNum(b[3])) {
                        p.push("page " + pg.page_number + " frame " + fr.id + ": bounds_pt must be 4 numbers [top, left, bottom, right]");
                    } else if (fr.kind !== "line" && (b[2] <= b[0] || b[3] <= b[1])) {
                        p.push("page " + pg.page_number + " frame " + fr.id + ": bounds_pt has zero/negative size");
                    }
                }
            }
        }
        if (p.length) {
            throw new Error("Contract validation failed: " + p.slice(0, 12).join("; ") + (p.length > 12 ? " (+" + (p.length - 12) + " more)" : ""));
        }
    }

    // ------------------------------------------------------------------ context
    function newContext(opts, contract, report) {
        var ctx = {
            opts: opts,
            contract: contract,
            report: report,
            doc: null,
            templateMode: false,
            swatches: {},
            pstyles: {},
            cstyles: {},
            ostyles: {},
            masters: {},
            assets: {},
            textFrames: [],
            pages: [],
            unapproved: [],
            fontIndex: null,
            substituted: {},
            W: contract.document.page_width_pt,
            H: contract.document.page_height_pt,
            bleed: num(contract.document.bleed_pt, 9),
            facing: !!contract.document.facing_pages
        };
        var i, pages = contract.pages.slice(0), sorted = true;
        for (i = 0; i < contract.assets.length; i++) { ctx.assets[contract.assets[i].id] = contract.assets[i]; }
        for (i = 1; i < pages.length; i++) { if (pages[i].page_number < pages[i - 1].page_number) { sorted = false; } }
        if (!sorted) {
            pages.sort(function (a, b) { return a.page_number - b.page_number; });
        }
        ctx.pages = pages;
        for (i = 0; i < pages.length; i++) {
            if (pages[i].approved !== true) { ctx.unapproved.push(pages[i].page_number); }
        }
        report.unapprovedPages = ctx.unapproved.slice(0);
        ctx.warn = function (m) { log("WARN " + m); report.warnings.push(m); };
        ctx.fail = function (m) { log("ERROR " + m); report.errors.push(m); };
        if (!sorted) { ctx.warn("contract pages were not sorted by page_number; rendering in page_number order"); }
        return ctx;
    }

    // ------------------------------------------------------------------ app preferences
    function applyScriptPrefs() {
        var saved = {};
        try { saved.uil = app.scriptPreferences.userInteractionLevel; app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) { /* ignore */ }
        try { saved.mu = app.scriptPreferences.measurementUnit; app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS; } catch (e2) { /* CS5 and older */ }
        try { saved.redraw = app.scriptPreferences.enableRedraw; app.scriptPreferences.enableRedraw = false; } catch (e3) { /* server */ }
        try { saved.viewPDF = app.pdfExportPreferences.viewPDF; app.pdfExportPreferences.viewPDF = false; } catch (e4) { /* ignore */ }
        return saved;
    }
    function restoreScriptPrefs(saved) {
        if (!saved) { return; }
        try { if (saved.uil !== undefined) { app.scriptPreferences.userInteractionLevel = saved.uil; } } catch (e1) { /* ignore */ }
        try { if (saved.mu !== undefined) { app.scriptPreferences.measurementUnit = saved.mu; } } catch (e2) { /* ignore */ }
        try { if (saved.redraw !== undefined) { app.scriptPreferences.enableRedraw = saved.redraw; } } catch (e3) { /* ignore */ }
        try { if (saved.viewPDF !== undefined) { app.pdfExportPreferences.viewPDF = saved.viewPDF; } } catch (e4) { /* ignore */ }
    }

    function trySet(ctx, obj, prop, val, what) {
        try {
            obj[prop] = val;
            return true;
        } catch (e) {
            ctx.warn("could not set " + prop + " on " + what + ": " + errText(e));
            return false;
        }
    }

    // ------------------------------------------------------------------ document
    function resolveTemplate(ctx) {
        var o = ctx.opts, t = ctx.contract.document.template_document, f;
        if (o.templatePath) {
            f = new File(o.templatePath);
            if (!f.exists) { throw new Error("templatePath not found: " + o.templatePath); }
            return f;
        }
        if (t) {
            if (!isSafeRelativePath(t)) { throw new Error("document.template_document must be a relative path inside templateRoot: " + t); }
            f = new File(joinPath(o.templateRoot, t));
            if (!f.exists) { throw new Error("document.template_document not found: " + f.fsName); }
            return f;
        }
        return null;
    }

    function openOrCreateDocument(ctx) {
        var tpl = resolveTemplate(ctx), doc;
        if (tpl) {
            log("opening template " + tpl.fsName);
            try { doc = app.open(tpl, ctx.opts.showWindow, OpenOptions.OPEN_COPY); } catch (e) { doc = app.open(tpl); }
            if (isArray(doc)) { doc = doc[0]; }
            ctx.templateMode = true;
            ctx.report.templateUsed = tpl.fsName;
        } else {
            log("creating new document");
            try { doc = app.documents.add(ctx.opts.showWindow); } catch (e2) { doc = app.documents.add(); }
        }
        ctx.doc = doc;
        try {
            doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
            doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
        } catch (e3) { ctx.warn("could not set document measurement units: " + errText(e3)); }
        // Frame bounds in the contract are relative to each page's trim box.
        try { doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN; } catch (e4) { ctx.warn("could not set rulerOrigin=PAGE_ORIGIN: " + errText(e4)); }
        try { doc.zeroPoint = [0, 0]; } catch (e5) { /* ignore */ }
        return doc;
    }

    function setMarginPrefs(ctx, mp, columns, what) {
        var m = ctx.contract.document.margins, d = ctx.contract.document;
        trySet(ctx, mp, "top", num(m.top, 36), what);
        trySet(ctx, mp, "bottom", num(m.bottom, 36), what);
        // For facing-page documents InDesign treats left as "inside" and right as "outside".
        trySet(ctx, mp, "left", num(m.inside, 36), what);
        trySet(ctx, mp, "right", num(m.outside, 36), what);
        trySet(ctx, mp, "columnCount", columns || d.columns || 1, what);
        trySet(ctx, mp, "columnGutter", num(d.gutter_pt, 12), what);
    }

    function setupDocument(ctx) {
        var doc = ctx.doc, d = ctx.contract.document, dp = doc.documentPreferences, m = d.margins;
        if (ctx.templateMode) {
            // Keep the approved template's geometry; only warn if it disagrees with the contract.
            try {
                ctx.W = Number(dp.pageWidth);
                ctx.H = Number(dp.pageHeight);
                ctx.facing = !!dp.facingPages;
                ctx.bleed = Number(dp.documentBleedTopOffset);
            } catch (e) { /* keep contract values */ }
            if (Math.abs(ctx.W - d.page_width_pt) > 0.5 || Math.abs(ctx.H - d.page_height_pt) > 0.5) {
                ctx.warn("template page size " + round2(ctx.W) + "x" + round2(ctx.H) + "pt differs from contract " + d.page_width_pt + "x" + d.page_height_pt + "pt; using template size");
            }
            if (ctx.facing !== !!d.facing_pages) { ctx.warn("template facing_pages differs from contract; using template setting"); }
            return;
        }
        trySet(ctx, dp, "facingPages", !!d.facing_pages, "documentPreferences");
        trySet(ctx, dp, "pageWidth", d.page_width_pt, "documentPreferences");
        trySet(ctx, dp, "pageHeight", d.page_height_pt, "documentPreferences");
        try { dp.documentBleedUniformSize = true; } catch (e1) { /* ignore */ }
        trySet(ctx, dp, "documentBleedTopOffset", ctx.bleed, "documentPreferences");
        try {
            dp.documentBleedBottomOffset = ctx.bleed;
            dp.documentBleedInsideOrLeftOffset = ctx.bleed;
            dp.documentBleedOutsideOrRightOffset = ctx.bleed;
        } catch (e2) { /* uniform size already applied */ }
        setMarginPrefs(ctx, doc.marginPreferences, d.columns, "document marginPreferences");
        if (isNum(d.baseline_pt) && d.baseline_pt > 0) {
            try {
                doc.gridPreferences.baselineDivision = d.baseline_pt;
                doc.gridPreferences.baselineStart = num(m.top, 0);
                doc.gridPreferences.baselineGridRelativeOption = BaselineGridRelativeOption.TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION;
            } catch (e3) { ctx.warn("could not configure baseline grid: " + errText(e3)); }
        }
    }

    function setupPages(ctx) {
        var doc = ctx.doc, dp = doc.documentPreferences, n = ctx.pages.length, first = ctx.pages[0].page_number, i, pg, sec;
        // Start page number: an even start number in a facing document makes page 1 a left page.
        try {
            dp.startPageNumber = first;
        } catch (e1) {
            try {
                sec = doc.sections.item(0);
                sec.continueNumbering = false;
                sec.pageNumberStart = first;
                ctx.warn("documentPreferences.startPageNumber unavailable; used section numbering (page sides may not match)");
            } catch (e2) { ctx.warn("could not set start page number " + first + ": " + errText(e2)); }
        }
        try { dp.pagesPerDocument = n; } catch (e3) { /* fall back to explicit add/remove */ }
        while (doc.pages.length < n) { doc.pages.add(LocationOptions.AT_END); }
        while (doc.pages.length > n) { doc.pages.item(doc.pages.length - 1).remove(); }
        // Restart numbering where the contract skips page numbers (e.g. 12, 13, 20).
        for (i = 1; i < n; i++) {
            if (ctx.pages[i].page_number !== ctx.pages[i - 1].page_number + 1) {
                try {
                    doc.sections.add(doc.pages.item(i), { continueNumbering: false, pageNumberStart: ctx.pages[i].page_number });
                    ctx.warn("page numbers jump from " + ctx.pages[i - 1].page_number + " to " + ctx.pages[i].page_number + "; started a new section");
                } catch (e4) {
                    ctx.warn("could not start a section at page " + ctx.pages[i].page_number + ": " + errText(e4));
                }
            }
        }
        if (ctx.templateMode) {
            // Template document pages may contain placeholder items; the contract defines all page items.
            for (i = 0; i < n; i++) {
                pg = doc.pages.item(i);
                try { if (pg.pageItems.length > 0) { pg.pageItems.everyItem().remove(); } } catch (e5) {
                    ctx.warn("could not clear template items on page index " + i + ": " + errText(e5));
                }
            }
        }
    }

    // ------------------------------------------------------------------ swatches
    var RESERVED_SWATCHES = { "none": "None", "[none]": "None", "paper": "Paper", "[paper]": "Paper", "black": "Black", "[black]": "Black", "registration": "Registration", "[registration]": "Registration" };

    function hexToRgb(hex) {
        var h = String(hex).replace(/^#/, "");
        return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
    }

    function findSwatch(ctx, name) {
        var s, key;
        if (!name) { return null; }
        if (has(ctx.swatches, name)) { return ctx.swatches[name]; }
        key = String(name).toLowerCase();
        if (has(RESERVED_SWATCHES, key)) { name = RESERVED_SWATCHES[key]; }
        try { s = ctx.doc.swatches.itemByName(name); if (s.isValid) { return s; } } catch (e1) { /* ignore */ }
        try { s = ctx.doc.colors.itemByName(name); if (s.isValid) { return s; } } catch (e2) { /* ignore */ }
        return null;
    }

    function buildSwatches(ctx) {
        var list = ctx.contract.styles.colors || [], i, c, col, exists;
        for (i = 0; i < list.length; i++) {
            c = list[i];
            if (has(RESERVED_SWATCHES, String(c.name).toLowerCase())) {
                ctx.warn("colour '" + c.name + "' is a reserved InDesign swatch; using the built-in swatch");
                continue;
            }
            col = ctx.doc.colors.itemByName(c.name);
            exists = col.isValid;
            if (exists && ctx.templateMode) { ctx.swatches[c.name] = col; continue; }
            try {
                if (!exists) { col = ctx.doc.colors.add({ name: c.name }); }
                col.model = ColorModel.PROCESS;
                if (isArray(c.cmyk) && c.cmyk.length === 4) {
                    col.space = ColorSpace.CMYK;
                    col.colorValue = [num(c.cmyk[0], 0), num(c.cmyk[1], 0), num(c.cmyk[2], 0), num(c.cmyk[3], 0)];
                } else {
                    col.space = ColorSpace.RGB;
                    col.colorValue = hexToRgb(c.hex);
                }
                ctx.swatches[c.name] = col;
            } catch (e) {
                ctx.fail("could not create colour '" + c.name + "': " + errText(e));
            }
        }
    }

    // ------------------------------------------------------------------ fonts
    var STYLE_ALIASES = {
        "regular": ["Regular", "Roman", "Book", "Normal", "Plain"],
        "roman": ["Roman", "Regular", "Book"],
        "italic": ["Italic", "Oblique"],
        "oblique": ["Oblique", "Italic"],
        "semibold": ["Semibold", "SemiBold", "Semi Bold", "Demibold", "DemiBold", "Demi"],
        "bold": ["Bold"],
        "bold italic": ["Bold Italic", "BoldItalic", "Bold Oblique"],
        "light": ["Light", "Book"],
        "medium": ["Medium", "Semibold"]
    };
    // PDF base-14 names (used by the ReportLab preview renderer as fallback_family).
    var BASE14 = {
        "times-roman": [["Times New Roman", "Regular"], ["Times", "Roman"], ["Times", "Regular"], ["Minion Pro", "Regular"]],
        "times-bold": [["Times New Roman", "Bold"], ["Times", "Bold"], ["Minion Pro", "Bold"]],
        "times-italic": [["Times New Roman", "Italic"], ["Times", "Italic"], ["Minion Pro", "Italic"]],
        "times-bolditalic": [["Times New Roman", "Bold Italic"], ["Times", "Bold Italic"], ["Minion Pro", "Bold Italic"]],
        "helvetica": [["Helvetica", "Regular"], ["Arial", "Regular"], ["Helvetica Neue", "Regular"], ["Myriad Pro", "Regular"]],
        "helvetica-bold": [["Helvetica", "Bold"], ["Arial", "Bold"], ["Helvetica Neue", "Bold"], ["Myriad Pro", "Bold"]],
        "helvetica-oblique": [["Helvetica", "Oblique"], ["Arial", "Italic"], ["Helvetica Neue", "Italic"], ["Myriad Pro", "Italic"]],
        "helvetica-boldoblique": [["Helvetica", "Bold Oblique"], ["Arial", "Bold Italic"], ["Myriad Pro", "Bold Italic"]],
        "courier": [["Courier New", "Regular"], ["Courier", "Regular"]],
        "courier-bold": [["Courier New", "Bold"], ["Courier", "Bold"]]
    };
    var LAST_RESORT_FAMILIES = ["Minion Pro", "Myriad Pro", "Times New Roman", "Arial", "Helvetica", "Times"];

    function everyItemProp(coll, prop) {
        var v = null, i, out;
        try { v = coll.everyItem()[prop]; } catch (e) { v = null; }
        if (v === null || v === undefined) {
            out = [];
            var len = 0;
            try { len = coll.length; } catch (e2) { len = 0; }
            for (i = 0; i < len; i++) {
                try { out.push(coll.item(i)[prop]); } catch (e3) { out.push(null); }
            }
            return out;
        }
        return isArray(v) ? v : [v];
    }

    function getFontIndex(ctx) {
        var idx, fam, sty, ps, i, k;
        if (ctx.fontIndex) { return ctx.fontIndex; }
        idx = { byKey: {}, byPs: {}, count: 0 };
        fam = everyItemProp(app.fonts, "fontFamily");
        sty = everyItemProp(app.fonts, "fontStyleName");
        ps = everyItemProp(app.fonts, "postscriptName");
        for (i = 0; i < fam.length; i++) {
            if (!fam[i]) { continue; }
            k = (String(fam[i]) + "\t" + String(sty[i] || "")).toLowerCase();
            idx.byKey[k] = { family: String(fam[i]), style: String(sty[i] || "") };
            if (ps[i]) { idx.byPs[String(ps[i]).toLowerCase()] = idx.byKey[k]; }
            idx.count++;
        }
        log("font index: " + idx.count + " installed fonts");
        ctx.fontIndex = idx;
        return idx;
    }

    function lookupFont(idx, family, style) {
        var k = (String(family) + "\t" + String(style)).toLowerCase();
        return has(idx.byKey, k) ? idx.byKey[k] : null;
    }

    function styleCandidates(style) {
        var key = String(style || "Regular").toLowerCase(), out = [String(style || "Regular")], i, al;
        if (has(STYLE_ALIASES, key)) {
            al = STYLE_ALIASES[key];
            for (i = 0; i < al.length; i++) { pushUnique(out, al[i]); }
        }
        return out;
    }

    // Returns {family, style, exact} or null when nothing usable is installed.
    function resolveFont(ctx, family, style, fallback) {
        var idx = getFontIndex(ctx), hit, i, j, styles = styleCandidates(style), list, b14;
        style = style || "Regular";
        if (family) {
            hit = lookupFont(idx, family, style);
            if (hit) { return { family: hit.family, style: hit.style, exact: true }; }
            for (i = 1; i < styles.length; i++) {
                hit = lookupFont(idx, family, styles[i]);
                if (hit) { return { family: hit.family, style: hit.style, exact: false }; }
            }
        }
        if (fallback) {
            for (i = 0; i < styles.length; i++) {
                hit = lookupFont(idx, fallback, styles[i]);
                if (hit) { return { family: hit.family, style: hit.style, exact: false }; }
            }
            if (has(idx.byPs, String(fallback).toLowerCase())) {
                hit = idx.byPs[String(fallback).toLowerCase()];
                return { family: hit.family, style: hit.style, exact: false };
            }
            b14 = String(fallback).toLowerCase();
            if (has(BASE14, b14)) {
                list = BASE14[b14];
                for (i = 0; i < list.length; i++) {
                    hit = lookupFont(idx, list[i][0], list[i][1]);
                    if (hit) { return { family: hit.family, style: hit.style, exact: false }; }
                }
            }
            hit = lookupFont(idx, fallback, "Regular");
            if (hit) { return { family: hit.family, style: hit.style, exact: false }; }
        }
        for (j = 0; j < LAST_RESORT_FAMILIES.length; j++) {
            for (i = 0; i < styles.length; i++) {
                hit = lookupFont(idx, LAST_RESORT_FAMILIES[j], styles[i]);
                if (hit) { return { family: hit.family, style: hit.style, exact: false }; }
            }
        }
        for (j = 0; j < LAST_RESORT_FAMILIES.length; j++) {
            hit = lookupFont(idx, LAST_RESORT_FAMILIES[j], "Regular");
            if (hit) { return { family: hit.family, style: hit.style, exact: false }; }
        }
        return null;
    }

    function applyFont(ctx, styleObj, family, style, fallback, what) {
        var requested = family + " " + (style || "Regular"), res = resolveFont(ctx, family, style || "Regular", fallback), used;
        if (!res) {
            pushUnique(ctx.report.missingFonts, requested);
            if (!has(ctx.substituted, requested)) {
                ctx.substituted[requested] = true;
                ctx.report.substitutedFonts.push({ requested: requested, used: null });
            }
            ctx.warn(what + ": font '" + requested + "' is not installed and no fallback was found; InDesign default font kept");
            return;
        }
        used = res.family + " " + res.style;
        if (!res.exact) {
            pushUnique(ctx.report.missingFonts, requested);
            if (!has(ctx.substituted, requested)) {
                ctx.substituted[requested] = true;
                ctx.report.substitutedFonts.push({ requested: requested, used: used });
            }
            log(what + ": substituted '" + requested + "' -> '" + used + "'");
        }
        try { styleObj.appliedFont = res.family + "\t" + res.style; } catch (e) { trySet(ctx, styleObj, "appliedFont", res.family, what); }
        trySet(ctx, styleObj, "fontStyle", res.style, what);
    }

    // ------------------------------------------------------------------ styles
    var ALIGN = null;
    function alignEnum(a) {
        if (!ALIGN) {
            ALIGN = {
                left: Justification.LEFT_ALIGN,
                center: Justification.CENTER_ALIGN,
                right: Justification.RIGHT_ALIGN,
                justify: Justification.LEFT_JUSTIFIED
            };
        }
        return has(ALIGN, a) ? ALIGN[a] : null;
    }

    // Finds a style by name anywhere in the document, including inside style groups
    // (approved templates often group their styles; collection.itemByName only sees the root).
    function findStyle(ctx, kind, name) {
        var all = null, i, coll, s;
        try {
            all = kind === "paragraph" ? ctx.doc.allParagraphStyles : (kind === "character" ? ctx.doc.allCharacterStyles : ctx.doc.allObjectStyles);
        } catch (e) { all = null; }
        if (all) {
            for (i = 0; i < all.length; i++) {
                try { if (String(all[i].name) === String(name)) { return all[i]; } } catch (e2) { /* ignore */ }
            }
        }
        coll = kind === "paragraph" ? ctx.doc.paragraphStyles : (kind === "character" ? ctx.doc.characterStyles : ctx.doc.objectStyles);
        try { s = coll.itemByName(name); if (s.isValid) { return s; } } catch (e3) { /* ignore */ }
        return null;
    }

    function buildParagraphStyles(ctx) {
        var list = ctx.contract.styles.paragraph || [], i, p, ps, what, sw, al;
        for (i = 0; i < list.length; i++) {
            p = list[i];
            what = "paragraph style '" + p.name + "'";
            try {
                ps = findStyle(ctx, "paragraph", p.name);
                if (ps && ctx.templateMode) { ctx.pstyles[p.name] = ps; continue; }
                if (!ps) { ps = ctx.doc.paragraphStyles.add({ name: p.name }); }
            } catch (e) {
                ctx.fail("could not create " + what + ": " + errText(e));
                continue;
            }
            ctx.pstyles[p.name] = ps;
            applyFont(ctx, ps, p.font_family, p.font_style || "Regular", p.fallback_family, what);
            trySet(ctx, ps, "pointSize", p.size_pt, what);
            trySet(ctx, ps, "leading", p.leading_pt, what);
            if (has(p, "tracking")) { trySet(ctx, ps, "tracking", p.tracking, what); }
            if (p.color) {
                sw = findSwatch(ctx, p.color);
                if (sw) { trySet(ctx, ps, "fillColor", sw, what); } else { ctx.warn(what + ": colour '" + p.color + "' not found"); }
            }
            if (has(p, "uppercase")) { trySet(ctx, ps, "capitalization", p.uppercase ? Capitalization.ALL_CAPS : Capitalization.NORMAL, what); }
            if (p.align) {
                al = alignEnum(p.align);
                if (al !== null) { trySet(ctx, ps, "justification", al, what); }
            }
            if (has(p, "space_before_pt")) { trySet(ctx, ps, "spaceBefore", p.space_before_pt, what); }
            if (has(p, "space_after_pt")) { trySet(ctx, ps, "spaceAfter", p.space_after_pt, what); }
            if (has(p, "first_line_indent_pt")) { trySet(ctx, ps, "firstLineIndent", p.first_line_indent_pt, what); }
            if (has(p, "drop_cap_lines")) {
                trySet(ctx, ps, "dropCapLines", p.drop_cap_lines, what);
                trySet(ctx, ps, "dropCapCharacters", p.drop_cap_lines > 0 ? 1 : 0, what);
            }
        }
    }

    function buildCharacterStyles(ctx) {
        var list = ctx.contract.styles.character || [], i, c, cs, what, sw;
        for (i = 0; i < list.length; i++) {
            c = list[i];
            what = "character style '" + c.name + "'";
            try {
                cs = findStyle(ctx, "character", c.name);
                if (cs && ctx.templateMode) { ctx.cstyles[c.name] = cs; continue; }
                if (!cs) { cs = ctx.doc.characterStyles.add({ name: c.name }); }
            } catch (e) {
                ctx.fail("could not create " + what + ": " + errText(e));
                continue;
            }
            ctx.cstyles[c.name] = cs;
            if (c.font_family) {
                applyFont(ctx, cs, c.font_family, c.font_style || "Regular", null, what);
            } else if (c.font_style) {
                trySet(ctx, cs, "fontStyle", c.font_style, what);
            }
            if (c.color) {
                sw = findSwatch(ctx, c.color);
                if (sw) { trySet(ctx, cs, "fillColor", sw, what); } else { ctx.warn(what + ": colour '" + c.color + "' not found"); }
            }
        }
    }

    function setCorners(ctx, target, radius, what) {
        try {
            target.topLeftCornerOption = CornerOptions.ROUNDED_CORNER;
            target.topRightCornerOption = CornerOptions.ROUNDED_CORNER;
            target.bottomLeftCornerOption = CornerOptions.ROUNDED_CORNER;
            target.bottomRightCornerOption = CornerOptions.ROUNDED_CORNER;
            target.topLeftCornerRadius = radius;
            target.topRightCornerRadius = radius;
            target.bottomLeftCornerRadius = radius;
            target.bottomRightCornerRadius = radius;
        } catch (e) {
            try {
                target.cornerOption = CornerOptions.ROUNDED_CORNER;
                target.cornerRadius = radius;
            } catch (e2) { ctx.warn(what + ": could not set corner radius: " + errText(e2)); }
        }
    }

    function buildObjectStyles(ctx) {
        var list = ctx.contract.styles.object || [], i, o, os, what, sw, wrap;
        for (i = 0; i < list.length; i++) {
            o = list[i];
            what = "object style '" + o.name + "'";
            try {
                os = findStyle(ctx, "object", o.name);
                if (os && ctx.templateMode) { ctx.ostyles[o.name] = os; continue; }
                if (!os) { os = ctx.doc.objectStyles.add({ name: o.name }); }
            } catch (e) {
                ctx.fail("could not create " + what + ": " + errText(e));
                continue;
            }
            ctx.ostyles[o.name] = os;
            if (o.fill) {
                sw = findSwatch(ctx, o.fill);
                if (sw) { try { os.enableFill = true; } catch (e1) { /* ignore */ } trySet(ctx, os, "fillColor", sw, what); } else { ctx.warn(what + ": fill colour '" + o.fill + "' not found"); }
            }
            if (o.stroke) {
                sw = findSwatch(ctx, o.stroke);
                if (sw) { try { os.enableStroke = true; } catch (e2) { /* ignore */ } trySet(ctx, os, "strokeColor", sw, what); } else { ctx.warn(what + ": stroke colour '" + o.stroke + "' not found"); }
            }
            if (has(o, "stroke_weight_pt")) {
                try { os.enableStroke = true; } catch (e3) { /* ignore */ }
                trySet(ctx, os, "strokeWeight", o.stroke_weight_pt, what);
            }
            if (has(o, "corner_radius_pt") && o.corner_radius_pt > 0) {
                try { os.enableStrokeAndCornerOptions = true; } catch (e4) { /* ignore */ }
                setCorners(ctx, os, o.corner_radius_pt, what);
            }
            if (o.text_wrap) {
                wrap = o.text_wrap === "bounding_box" ? TextWrapModes.BOUNDING_BOX_TEXT_WRAP :
                    (o.text_wrap === "contour" ? TextWrapModes.CONTOUR : TextWrapModes.NONE);
                try { os.enableTextWrapAndOthers = true; } catch (e5) { /* ignore */ }
                try { os.textWrapPreferences.textWrapMode = wrap; } catch (e6) { ctx.warn(what + ": could not set text wrap: " + errText(e6)); }
            }
        }
    }

    function lookupParagraphStyle(ctx, name) {
        var ps;
        if (!name) { return null; }
        if (has(ctx.pstyles, name)) { return ctx.pstyles[name]; }
        ps = findStyle(ctx, "paragraph", name);
        if (ps) { ctx.pstyles[name] = ps; }
        return ps;
    }
    function lookupObjectStyle(ctx, name) {
        var os;
        if (!name) { return null; }
        if (has(ctx.ostyles, name)) { return ctx.ostyles[name]; }
        os = findStyle(ctx, "object", name);
        if (os) { ctx.ostyles[name] = os; }
        return os;
    }

    // ------------------------------------------------------------------ masters & folios
    function findMasterByName(doc, name) {
        var i, ms;
        for (i = 0; i < doc.masterSpreads.length; i++) {
            ms = doc.masterSpreads.item(i);
            try { if (String(ms.name) === String(name)) { return ms; } } catch (e) { /* ignore */ }
        }
        return null;
    }

    function splitMasterName(name) {
        var s = String(name), dash = s.indexOf("-");
        if (dash > 0 && dash <= 4) { return { prefix: s.substring(0, dash), baseName: s.substring(dash + 1) || s }; }
        return { prefix: "", baseName: s };
    }

    function freePrefix(doc) {
        var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", used = {}, i;
        for (i = 0; i < doc.masterSpreads.length; i++) {
            try { used[String(doc.masterSpreads.item(i).namePrefix)] = true; } catch (e) { /* ignore */ }
        }
        for (i = 0; i < letters.length; i++) { if (!used[letters.charAt(i)]) { return letters.charAt(i); } }
        return "Z" + doc.masterSpreads.length;
    }

    function renameMaster(ctx, ms, parts, contractName) {
        try { ms.baseName = parts.baseName; } catch (e1) { ctx.warn("master '" + contractName + "': could not set baseName: " + errText(e1)); }
        if (parts.prefix) {
            try { ms.namePrefix = parts.prefix; } catch (e2) {
                ctx.warn("master '" + contractName + "': prefix '" + parts.prefix + "' unavailable, using '" + ms.namePrefix + "'");
            }
        }
    }

    function pageSide(ctx, pg, index, count) {
        try {
            if (pg.side == PageSideOptions.LEFT_HAND) { return "left"; }
            if (pg.side == PageSideOptions.RIGHT_HAND) { return "right"; }
            if (pg.side == PageSideOptions.SINGLE_SIDED) { return "single"; }
        } catch (e) { /* fall through */ }
        if (!ctx.facing) { return "single"; }
        return (count === 2 && index === 0) ? "left" : "right";
    }

    function folioGeometry(ctx, position, side, h) {
        var m = ctx.contract.document.margins, W = ctx.W, H = ctx.H, gap, top, bottom, leftM, rightM, align;
        if (side === "left") { leftM = num(m.outside, 36); rightM = num(m.inside, 36); } else { leftM = num(m.inside, 36); rightM = num(m.outside, 36); }
        if (position === "top_outside") {
            gap = Math.min(12, num(m.top, 36) / 3);
            bottom = num(m.top, 36) - gap;
            top = Math.max(0, bottom - h);
        } else {
            gap = Math.min(12, num(m.bottom, 36) / 3);
            top = H - num(m.bottom, 36) + gap;
            bottom = Math.min(H, top + h);
            if (bottom - top < h) { top = Math.max(0, bottom - h); }
        }
        if (position === "bottom_center") {
            align = "center";
        } else {
            align = (side === "left") ? "left" : "right";
        }
        return { bounds: [top, leftM, bottom, W - rightM], align: align };
    }

    function addFolio(ctx, ms, folio, contractName) {
        var ps = lookupParagraphStyle(ctx, folio.paragraph_style), size = 8, h, i, pg, side, geo, tf, story, running, sep = "\u2003";
        if (folio.paragraph_style && !ps) { ctx.warn("master '" + contractName + "': folio paragraph style '" + folio.paragraph_style + "' not found"); }
        try { if (ps && isNum(Number(ps.pointSize))) { size = Number(ps.pointSize); } } catch (e) { /* default */ }
        h = Math.max(12, size * 2);
        running = folio.running_text ? String(folio.running_text) : "";
        for (i = 0; i < ms.pages.length; i++) {
            pg = ms.pages.item(i);
            side = pageSide(ctx, pg, i, ms.pages.length);
            geo = folioGeometry(ctx, folio.position || "bottom_outside", side, h);
            try {
                tf = pg.textFrames.add({ geometricBounds: geo.bounds });
                tf.label = "pressflow:folio";
                try { tf.name = "PF Folio"; } catch (eName) { /* CS4 */ }
                if (geo.align === "right") {
                    tf.contents = running ? running + sep : "";
                    tf.insertionPoints.item(-1).contents = SpecialCharacters.AUTO_PAGE_NUMBER;
                } else if (geo.align === "left") {
                    tf.contents = running ? sep + running : "";
                    tf.insertionPoints.item(0).contents = SpecialCharacters.AUTO_PAGE_NUMBER;
                } else {
                    tf.contents = running ? running + sep : "";
                    tf.insertionPoints.item(-1).contents = SpecialCharacters.AUTO_PAGE_NUMBER;
                }
                story = tf.parentStory;
                if (ps) { applyParagraphStyleTo(ctx, story, ps, "folio"); }
                try { story.texts.item(0).justification = alignEnum(geo.align); } catch (eJ) { /* ignore */ }
                try {
                    tf.textFramePreferences.verticalJustification = (folio.position === "top_outside") ? VerticalJustification.BOTTOM_ALIGN : VerticalJustification.TOP_ALIGN;
                } catch (eV) { /* ignore */ }
            } catch (e2) {
                ctx.fail("master '" + contractName + "': could not create folio on master page " + i + ": " + errText(e2));
            }
        }
    }

    function buildMasters(ctx) {
        var list = ctx.contract.masters || [], doc = ctx.doc, reusedDefault = false, i, m, ms, parts, created, j;
        for (i = 0; i < list.length; i++) {
            m = list[i];
            created = false;
            ms = findMasterByName(doc, m.name);
            if (!ms) {
                parts = splitMasterName(m.name);
                try {
                    if (!ctx.templateMode && !reusedDefault && doc.masterSpreads.length > 0) {
                        // A brand-new document ships with one empty master (A-Master / A-Parent): reuse it.
                        ms = doc.masterSpreads.item(0);
                        reusedDefault = true;
                    } else {
                        try {
                            ms = doc.masterSpreads.add(ctx.facing ? 2 : 1, { namePrefix: parts.prefix || freePrefix(doc), baseName: parts.baseName });
                        } catch (eAdd) {
                            ms = doc.masterSpreads.add(ctx.facing ? 2 : 1);
                            try { ms.namePrefix = freePrefix(doc); } catch (eP) { /* keep InDesign's prefix */ }
                            parts.prefix = "";
                        }
                    }
                    renameMaster(ctx, ms, parts, m.name);
                    created = true;
                } catch (e) {
                    ctx.fail("could not create master '" + m.name + "': " + errText(e));
                    continue;
                }
                try { if (String(ms.name) !== String(m.name)) { ctx.warn("master '" + m.name + "' was created as '" + ms.name + "'"); } } catch (eN) { /* ignore */ }
            } else {
                log("reusing master '" + m.name + "'");
            }
            ctx.masters[m.name] = ms;
            if (created) {
                for (j = 0; j < ms.pages.length; j++) {
                    setMarginPrefs(ctx, ms.pages.item(j).marginPreferences, ctx.contract.document.columns, "master '" + m.name + "' page " + j);
                }
                if (m.folio && m.folio.position && m.folio.position !== "none") { addFolio(ctx, ms, m.folio, m.name); }
            }
        }
    }

    function applyMaster(ctx, page, cp) {
        var name = cp.master, ms;
        if (!name || name === "None" || name === "[None]") {
            try { page.appliedMaster = NothingEnum.NOTHING; } catch (e) { ctx.warn("page " + cp.page_number + ": could not clear master: " + errText(e)); }
            return;
        }
        ms = has(ctx.masters, name) ? ctx.masters[name] : findMasterByName(ctx.doc, name);
        if (!ms) {
            ctx.warn("page " + cp.page_number + ": master '" + name + "' not found; no master applied");
            try { page.appliedMaster = NothingEnum.NOTHING; } catch (e2) { /* ignore */ }
            return;
        }
        try { page.appliedMaster = ms; } catch (e3) { ctx.fail("page " + cp.page_number + ": could not apply master '" + name + "': " + errText(e3)); }
    }

    // ------------------------------------------------------------------ frames
    function sortFrames(frames) {
        var arr = [], out = [], i;
        for (i = 0; i < frames.length; i++) { arr.push({ f: frames[i], i: i, z: num(frames[i].z, 0) }); }
        arr.sort(function (a, b) { return (a.z - b.z) || (a.i - b.i); });
        for (i = 0; i < arr.length; i++) { out.push(arr[i].f); }
        return out;
    }

    function bleedBounds(ctx, side, b) {
        var bl = ctx.bleed, eps = 0.5, t = b[0], l = b[1], bo = b[2], r = b[3], leftOutside, rightOutside;
        if (!ctx.opts.extendToBleed || !bl) { return b; }
        leftOutside = !ctx.facing || side !== "right";
        rightOutside = !ctx.facing || side !== "left";
        if (Math.abs(t) <= eps) { t = -bl; }
        if (Math.abs(bo - ctx.H) <= eps) { bo = ctx.H + bl; }
        if (leftOutside && Math.abs(l) <= eps) { l = -bl; }
        if (rightOutside && Math.abs(r - ctx.W) <= eps) { r = ctx.W + bl; }
        return [t, l, bo, r];
    }

    function noneSwatch(ctx) {
        try { return ctx.doc.swatches.itemByName("None"); } catch (e) { return null; }
    }

    function applyObjectStyleTo(ctx, item, f, where) {
        var os = lookupObjectStyle(ctx, f.object_style);
        if (!os) { ctx.warn(where + ": object style '" + f.object_style + "' not found"); return false; }
        try { item.applyObjectStyle(os, true); } catch (e) {
            try { item.appliedObjectStyle = os; } catch (e2) { ctx.warn(where + ": could not apply object style: " + errText(e2)); return false; }
        }
        return true;
    }

    function applyFillStroke(ctx, item, f, where, clearDefaults) {
        var sw, none;
        if (f.fill) {
            sw = findSwatch(ctx, f.fill);
            if (sw) { trySet(ctx, item, "fillColor", sw, where); } else { ctx.warn(where + ": fill colour '" + f.fill + "' not found"); }
        } else if (clearDefaults) {
            none = noneSwatch(ctx);
            if (none) { try { item.fillColor = none; } catch (e1) { /* ignore */ } }
        }
        if (f.stroke) {
            sw = findSwatch(ctx, f.stroke);
            if (sw) { trySet(ctx, item, "strokeColor", sw, where); } else { ctx.warn(where + ": stroke colour '" + f.stroke + "' not found"); }
        } else if (clearDefaults) {
            none = noneSwatch(ctx);
            try { item.strokeWeight = 0; } catch (e2) { /* ignore */ }
            if (none) { try { item.strokeColor = none; } catch (e3) { /* ignore */ } }
        }
        if (has(f, "stroke_weight_pt")) { trySet(ctx, item, "strokeWeight", f.stroke_weight_pt, where); }
        if (has(f, "opacity")) {
            try { item.transparencySettings.blendingSettings.opacity = clamp(num(f.opacity, 1), 0, 1) * 100; } catch (e4) { ctx.warn(where + ": could not set opacity: " + errText(e4)); }
        }
    }

    function tagItem(ctx, item, f, cp) {
        try { item.label = String(f.id); } catch (e1) { ctx.warn("frame " + f.id + ": could not set label"); }
        try { item.name = String(f.label || f.id); } catch (e2) { /* name is CS5+ */ }
        try {
            item.insertLabel("pressflow", PFJSON.stringify({ id: f.id, role: f.role || null, kind: f.kind, page: cp.page_number }));
        } catch (e3) { /* ignore */ }
    }

    // Contract text: paragraphs separated by a blank line ("\n\n"); a single "\n" is a forced line break.
    function contractTextToInDesign(s) {
        var paras, out = [], i, p;
        s = String(s || "").replace(/\r\n?/g, "\n");
        paras = s.split(/\n[ \t]*\n+/);
        for (i = 0; i < paras.length; i++) {
            p = paras[i].replace(/^\n+|\n+$/g, "");
            if (trim(p) !== "") { out.push(p); }
        }
        // In InDesign text "\r" ends a paragraph and "\n" is a forced line break.
        return out.join("\r");
    }

    function applyParagraphStyleTo(ctx, story, ps, where) {
        try {
            story.texts.item(0).applyParagraphStyle(ps, true);
        } catch (e) {
            try { story.paragraphs.everyItem().appliedParagraphStyle = ps; } catch (e2) {
                ctx.warn(where + ": could not apply paragraph style: " + errText(e2));
            }
        }
    }

    function recompose(tf) {
        try { tf.parentStory.recompose(); } catch (e) { /* composition is also forced by reading overflows */ }
    }

    function shrinkToFit(ctx, tf, ps, where) {
        var txt, baseSize, baseLeading, k, f, minK = Math.round(ctx.opts.shrinkMinScale * 100);
        recompose(tf);
        if (!tf.overflows) { return true; }
        txt = tf.parentStory.texts.item(0);
        baseSize = num(ps ? ps.pointSize : txt.pointSize, NaN);
        baseLeading = ps ? ps.leading : txt.leading;
        // Leading.AUTO is an enum (a large number in ExtendScript): only scale explicit leading.
        try { if (baseLeading == Leading.AUTO) { baseLeading = NaN; } } catch (eL) { /* ignore */ }
        baseLeading = num(baseLeading, NaN);
        if (isNum(baseLeading) && (baseLeading <= 0 || baseLeading > 5000)) { baseLeading = NaN; }
        if (!isNum(baseSize) || baseSize <= 0 || baseSize > 5000) { ctx.warn(where + ": shrink_to_fit skipped (could not read a single point size)"); return false; }
        for (k = 99; k >= minK; k--) {
            f = k / 100;
            try {
                txt.pointSize = round2(baseSize * f);
                if (isNum(baseLeading)) { txt.leading = round2(baseLeading * f); }
            } catch (e) {
                ctx.warn(where + ": shrink_to_fit failed: " + errText(e));
                return false;
            }
            recompose(tf);
            if (!tf.overflows) {
                log(where + ": shrink_to_fit at " + k + "%");
                return true;
            }
        }
        ctx.warn(where + ": still overset after shrinking to " + minK + "%");
        return false;
    }

    function growFrame(ctx, tf, where) {
        var gb, maxBottom = ctx.H + ctx.bleed, steps = 0;
        try {
            tf.textFramePreferences.autoSizingReferencePoint = AutoSizingReferenceEnum.TOP_CENTER_POINT;
            tf.textFramePreferences.autoSizingType = AutoSizingTypeEnum.HEIGHT_ONLY;
            recompose(tf);
        } catch (e) {
            // Pre-CS6 fallback: grow the bottom edge in 6pt steps up to the bleed edge.
            gb = tf.geometricBounds;
            while (tf.overflows && gb[2] < maxBottom && steps < 400) {
                gb = [gb[0], gb[1], Math.min(maxBottom, gb[2] + 6), gb[3]];
                tf.geometricBounds = gb;
                steps++;
            }
        }
        try {
            gb = tf.geometricBounds;
            if (gb[2] > ctx.H) { ctx.warn(where + ": grow_frame extended the frame past the trim edge (bottom " + round2(gb[2]) + "pt)"); }
        } catch (e2) { /* ignore */ }
    }

    function makeTextFrame(ctx, page, cp, f, where) {
        var tf, ps = null, text, hasOs = false;
        tf = page.textFrames.add({ geometricBounds: f.bounds_pt });
        tagItem(ctx, tf, f, cp);
        if (f.object_style) { hasOs = applyObjectStyleTo(ctx, tf, f, where); }
        try {
            tf.textFramePreferences.textColumnCount = f.columns ? f.columns : 1;
            tf.textFramePreferences.textColumnGutter = has(f, "gutter_pt") ? f.gutter_pt : num(ctx.contract.document.gutter_pt, 12);
        } catch (e1) { ctx.warn(where + ": could not set text columns: " + errText(e1)); }
        applyFillStroke(ctx, tf, f, where, false);
        if (f.paragraph_style) {
            ps = lookupParagraphStyle(ctx, f.paragraph_style);
            if (!ps) { ctx.warn(where + ": paragraph style '" + f.paragraph_style + "' not found"); }
        }
        text = contractTextToInDesign(f.content);
        if (text) { tf.contents = text; }
        if (ps) { applyParagraphStyleTo(ctx, tf.parentStory, ps, where); }
        if (text) {
            if (f.fit === "shrink_to_fit") { shrinkToFit(ctx, tf, ps, where); } else if (f.fit === "grow_frame") { growFrame(ctx, tf, where); }
        }
        ctx.textFrames.push({ tf: tf, page: cp.page_number, frameId: f.id });
        return tf;
    }

    function missingLink(ctx, cp, f, assetId, path, reason) {
        ctx.report.missingLinks.push({ page: cp ? cp.page_number : null, frameId: f ? f.id : null, assetId: assetId || null, path: path || null, reason: reason });
        ctx.warn((f ? "frame " + f.id + ": " : "") + "image not placed (" + reason + ")" + (path ? ": " + path : ""));
    }

    function placeImage(ctx, rect, cp, f, where) {
        var img = f.image, asset, file, g, fb, gb, s, ox, oy, dx, dy;
        asset = has(ctx.assets, img.asset_id) ? ctx.assets[img.asset_id] : null;
        if (!asset) { missingLink(ctx, cp, f, img.asset_id, null, "asset id not listed in contract.assets"); return; }
        if (!isSafeRelativePath(asset.file)) { missingLink(ctx, cp, f, img.asset_id, String(asset.file), "unsafe asset path (must be relative, no '..')"); return; }
        file = new File(joinPath(ctx.opts.assetRoot, asset.file));
        if (!file.exists) { missingLink(ctx, cp, f, img.asset_id, file.fsName, "file not found"); return; }
        try { rect.place(file, false); } catch (e) { missingLink(ctx, cp, f, img.asset_id, file.fsName, "place() failed: " + errText(e)); return; }
        g = (rect.allGraphics.length > 0) ? rect.allGraphics[0] : null;
        if (!g) { missingLink(ctx, cp, f, img.asset_id, file.fsName, "no graphic after place()"); return; }
        try {
            if (!img.fitting || img.fitting === "fill_proportionally") {
                rect.fit(FitOptions.FILL_PROPORTIONALLY);
            } else if (img.fitting === "fit_proportionally") {
                rect.fit(FitOptions.PROPORTIONALLY);
            }
            s = num(img.scale, 1);
            if (s > 0 && Math.abs(s - 1) > 0.0001) {
                try {
                    g.absoluteHorizontalScale = g.absoluteHorizontalScale * s;
                    g.absoluteVerticalScale = g.absoluteVerticalScale * s;
                } catch (eS) {
                    g.resize(CoordinateSpaces.INNER_COORDINATES, AnchorPoint.CENTER_ANCHOR, ResizeMethods.MULTIPLYING_CURRENT_DIMENSIONS_BY, [s, s]);
                }
            }
            rect.fit(FitOptions.CENTER_CONTENT);
            // offset_x/offset_y in [-1, 1]: 0 = centred, -1 = left/top edges aligned, +1 = right/bottom edges aligned.
            ox = clamp(num(img.offset_x, 0), -1, 1);
            oy = clamp(num(img.offset_y, 0), -1, 1);
            if (ox !== 0 || oy !== 0) {
                fb = rect.geometricBounds;
                gb = g.geometricBounds;
                dx = ((fb[3] - fb[1]) - (gb[3] - gb[1])) * ox / 2;
                dy = ((fb[2] - fb[0]) - (gb[2] - gb[0])) * oy / 2;
                g.move(undefined, [dx, dy]);
            }
        } catch (eFit) {
            ctx.warn(where + ": image fitting failed: " + errText(eFit));
        }
        if (asset.credit) { try { rect.insertLabel("pressflow.credit", String(asset.credit)); } catch (eC) { /* ignore */ } }
    }

    function makeImageFrame(ctx, page, side, cp, f, where) {
        var rect = page.rectangles.add({ geometricBounds: bleedBounds(ctx, side, f.bounds_pt) }), hasOs = false;
        tagItem(ctx, rect, f, cp);
        if (f.object_style) { hasOs = applyObjectStyleTo(ctx, rect, f, where); }
        applyFillStroke(ctx, rect, f, where, !hasOs);
        if (f.image && f.image.asset_id) { placeImage(ctx, rect, cp, f, where); } else { ctx.warn(where + ": image frame without image.asset_id"); }
        return rect;
    }

    function makeRect(ctx, page, side, cp, f, where) {
        var rect = page.rectangles.add({ geometricBounds: bleedBounds(ctx, side, f.bounds_pt) }), hasOs = false;
        tagItem(ctx, rect, f, cp);
        if (f.object_style) { hasOs = applyObjectStyleTo(ctx, rect, f, where); }
        applyFillStroke(ctx, rect, f, where, !hasOs);
        return rect;
    }

    function makeLine(ctx, page, cp, f, where) {
        var b = f.bounds_pt, ln = page.graphicLines.add({ geometricBounds: b }), sw;
        tagItem(ctx, ln, f, cp);
        try { ln.paths.item(0).entirePath = [[b[1], b[0]], [b[3], b[2]]]; } catch (e) { /* geometricBounds already set */ }
        if (f.object_style) { applyObjectStyleTo(ctx, ln, f, where); }
        if (!f.stroke && !f.object_style) {
            sw = findSwatch(ctx, "Black");
            if (sw) { try { ln.strokeColor = sw; } catch (e2) { /* ignore */ } }
        }
        if (!has(f, "stroke_weight_pt") && !f.object_style) { try { ln.strokeWeight = 1; } catch (e3) { /* ignore */ } }
        applyFillStroke(ctx, ln, f, where, false);
        return ln;
    }

    function buildPages(ctx) {
        var i, j, cp, page, frames, f, where, side;
        for (i = 0; i < ctx.pages.length; i++) {
            cp = ctx.pages[i];
            page = ctx.doc.pages.item(i);
            applyMaster(ctx, page, cp);
            if (!ctx.templateMode) {
                setMarginPrefs(ctx, page.marginPreferences, cp.columns || ctx.contract.document.columns, "page " + cp.page_number);
            }
            side = pageSide(ctx, page, i, 0);
            frames = sortFrames(cp.frames || []);
            for (j = 0; j < frames.length; j++) {
                f = frames[j];
                where = "page " + cp.page_number + " frame " + f.id;
                try {
                    if (f.kind === "text") {
                        makeTextFrame(ctx, page, cp, f, where);
                    } else if (f.kind === "image") {
                        makeImageFrame(ctx, page, side, cp, f, where);
                    } else if (f.kind === "rect") {
                        makeRect(ctx, page, side, cp, f, where);
                    } else {
                        makeLine(ctx, page, cp, f, where);
                    }
                } catch (e) {
                    ctx.fail(where + ": " + errText(e));
                }
            }
            ctx.report.pages++;
        }
    }

    // ------------------------------------------------------------------ checks
    function collectOverset(ctx) {
        var i, t;
        try { ctx.doc.recompose(); } catch (e) { /* ignore */ }
        for (i = 0; i < ctx.textFrames.length; i++) {
            t = ctx.textFrames[i];
            try { if (t.tf.overflows) { ctx.report.overset.push({ page: t.page, frameId: t.frameId }); } } catch (e2) { /* ignore */ }
        }
    }

    function collectDocumentIssues(ctx) {
        var fonts, links, i, f, l, nm, st;
        try {
            if (ctx.doc.fonts.length > 0) {
                fonts = ctx.doc.fonts.everyItem().getElements();
                for (i = 0; i < fonts.length; i++) {
                    f = fonts[i];
                    try {
                        st = f.status;
                        if (st != FontStatus.INSTALLED) {
                            nm = String(f.name).replace(/\t/g, " ");
                            pushUnique(ctx.report.missingFonts, nm);
                        }
                    } catch (eF) { /* ignore */ }
                }
            }
        } catch (e) { ctx.warn("could not inspect document fonts: " + errText(e)); }
        try {
            if (ctx.doc.links.length > 0) {
                links = ctx.doc.links.everyItem().getElements();
                for (i = 0; i < links.length; i++) {
                    l = links[i];
                    try {
                        if (l.status == LinkStatus.LINK_MISSING || l.status == LinkStatus.LINK_INACCESSIBLE) {
                            ctx.report.missingLinks.push({ page: null, frameId: null, assetId: null, path: String(l.filePath), reason: "link missing in document" });
                        }
                    } catch (eL) { /* ignore */ }
                }
            }
        } catch (e2) { ctx.warn("could not inspect links: " + errText(e2)); }
    }

    function checkPageSides(ctx) {
        var i, pg, pn, side;
        if (!ctx.facing) { return; }
        for (i = 0; i < ctx.pages.length; i++) {
            pn = ctx.pages[i].page_number;
            try {
                pg = ctx.doc.pages.item(i);
                side = pageSide(ctx, pg, i, 0);
                if ((side === "left" && pn % 2 === 1) || (side === "right" && pn % 2 === 0)) {
                    ctx.warn("page " + pn + " ended up as a " + side + "-hand page; check imposition");
                }
            } catch (e) { /* ignore */ }
        }
    }

    // ------------------------------------------------------------------ outputs
    var PRESET_SKIP = { name: 1, parent: 1, index: 1, id: 1, isValid: 1, properties: 1, events: 1, eventListeners: 1, reflect: 1 };

    function presetNames() {
        var names = [];
        try { names = everyItemProp(app.pdfExportPresets, "name"); } catch (e) { names = []; }
        return names.join(", ");
    }

    function clonePreset(src, overrides) {
        var tmp = app.pdfExportPresets.add({ name: "PressFlow tmp " + now() + " " + Math.floor(Math.random() * 100000) }), props = src.properties, k, pass, keys = [];
        for (k in props) { if (!has(PRESET_SKIP, k)) { keys.push(k); } }
        // Two passes: some properties are only writable after others (e.g. standardsCompliance first).
        for (pass = 0; pass < 2; pass++) {
            if (has(props, "standardsCompliance")) { try { tmp.standardsCompliance = props.standardsCompliance; } catch (e0) { /* ignore */ } }
            for (k = 0; k < keys.length; k++) {
                try { tmp[keys[k]] = props[keys[k]]; } catch (e1) { /* read-only or not applicable */ }
            }
        }
        // Overrides must stick (they are why the preset is cloned): fail loudly if one does not.
        for (k in overrides) {
            if (has(overrides, k)) {
                try { tmp[k] = overrides[k]; } catch (e2) {
                    try { tmp.remove(); } catch (e3) { /* ignore */ }
                    throw new Error("cannot set " + k + " on a PDF preset: " + errText(e2));
                }
            }
        }
        return tmp;
    }

    // Note: viewPDF is an app.pdfExportPreferences property, not a PDFExportPreset property.
    function exportPdf(ctx, file, presetName, overrides, label) {
        var preset = app.pdfExportPresets.itemByName(presetName), use = preset, tmp = null, k, hasOverrides = false;
        if (!preset.isValid) { throw new Error("PDF preset '" + presetName + "' not found. Installed presets: " + presetNames()); }
        for (k in overrides) { if (has(overrides, k)) { hasOverrides = true; } }
        if (hasOverrides) {
            // A print PDF without the requested bleed/crop marks is wrong output: fail instead of degrading.
            tmp = clonePreset(preset, overrides);
            use = tmp;
        }
        try { app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES; } catch (e2) { /* ignore */ }
        try {
            ctx.doc.exportFile(ExportFormat.PDF_TYPE, file, false, use);
        } finally {
            if (tmp) { try { tmp.remove(); } catch (e3) { /* ignore */ } }
        }
        return file.fsName;
    }

    function baseNameFor(ctx) {
        return ctx.opts.baseName || slug(ctx.contract.project_id) || slug(ctx.contract.document.title) || "pressflow";
    }

    function produceOutputs(ctx) {
        var o = ctx.opts, outs = o.outputs, base = baseNameFor(ctx), outDir = new Folder(o.outDir), f, wantsPdf, blocked, k;
        ensureFolder(outDir);
        wantsPdf = indexOf(outs, "pdf_digital") >= 0 || indexOf(outs, "pdf_print") >= 0;
        blocked = wantsPdf && ctx.unapproved.length > 0 && !o.force;
        if (blocked) {
            if (indexOf(outs, "pdf_digital") >= 0) { ctx.report.blockedOutputs.push("pdf_digital"); }
            if (indexOf(outs, "pdf_print") >= 0) { ctx.report.blockedOutputs.push("pdf_print"); }
            ctx.fail("final PDF export refused: page(s) " + ctx.unapproved.join(", ") + " not approved (pass force=true to override)");
        } else if (wantsPdf && ctx.unapproved.length > 0) {
            ctx.warn("force=true: exporting final PDF with unapproved page(s) " + ctx.unapproved.join(", "));
        }
        if (indexOf(outs, "indd") >= 0) {
            try {
                f = new File(joinPath(o.outDir, base + ".indd"));
                ctx.doc = ctx.doc.save(f) || ctx.doc;
                ctx.report.outputs.indd = f.fsName;
                log("saved " + f.fsName);
            } catch (e1) { ctx.fail("saving INDD failed: " + errText(e1)); }
        }
        if (indexOf(outs, "idml") >= 0) {
            try {
                f = new File(joinPath(o.outDir, base + ".idml"));
                ctx.doc.exportFile(ExportFormat.INDESIGN_MARKUP, f, false);
                ctx.report.outputs.idml = f.fsName;
                log("exported " + f.fsName);
            } catch (e2) { ctx.fail("IDML export failed: " + errText(e2)); }
        }
        if (blocked) { return; }
        if (indexOf(outs, "pdf_digital") >= 0) {
            try {
                f = new File(joinPath(o.outDir, base + "-digital.pdf"));
                k = {};
                if (o.includeBleed) { k.useDocumentBleedWithPDF = true; }
                ctx.report.outputs.pdf_digital = exportPdf(ctx, f, o.pdfPresetDigital, k, "pdf_digital");
                log("exported " + f.fsName);
            } catch (e3) { ctx.fail("digital PDF export failed: " + errText(e3)); }
        }
        if (indexOf(outs, "pdf_print") >= 0) {
            try {
                f = new File(joinPath(o.outDir, base + "-print.pdf"));
                k = {
                    useDocumentBleedWithPDF: true,
                    cropMarks: true,
                    pageMarksOffset: Math.min(72, Math.max(6, ctx.bleed))
                };
                ctx.report.outputs.pdf_print = exportPdf(ctx, f, o.pdfPresetPrint, k, "pdf_print");
                log("exported " + f.fsName);
            } catch (e4) { ctx.fail("print PDF export failed: " + errText(e4)); }
        }
    }

    // ------------------------------------------------------------------ main
    function render(ctx) {
        openOrCreateDocument(ctx);
        setupDocument(ctx);
        buildSwatches(ctx);
        buildParagraphStyles(ctx);
        buildCharacterStyles(ctx);
        buildObjectStyles(ctx);
        buildMasters(ctx);
        setupPages(ctx);
        buildPages(ctx);
        checkPageSides(ctx);
        collectOverset(ctx);
        collectDocumentIssues(ctx);
        produceOutputs(ctx);
    }

    function main(top) {
        var report = newReport(), raw = null, opts = null, saved = null, ctx = null, reportPath = null, text, contract;
        try {
            raw = readArgs(top);
            log("arguments from " + raw.__source);
            if (raw.jobId) { report.jobId = String(raw.jobId); }
            if (raw.outDir) { reportPath = raw.reportPath ? String(raw.reportPath) : joinPath(String(raw.outDir), "report.json"); }
            opts = normalizeArgs(raw);
            reportPath = opts.reportPath;
            saved = applyScriptPrefs();
            contract = PFJSON.parse(readTextFile(opts.contractPath));
            validateContract(contract);
            ctx = newContext(opts, contract, report);
            render(ctx);
        } catch (e) {
            report.errors.push(errText(e));
            log("FATAL " + errText(e));
        }
        if (ctx && ctx.doc && opts && opts.closeDocument) {
            try { if (ctx.doc.isValid) { ctx.doc.close(SaveOptions.NO); } } catch (eClose) { report.warnings.push("could not close document: " + errText(eClose)); }
        }
        restoreScriptPrefs(saved);
        report.ok = report.errors.length === 0;
        report.error = report.ok ? null : report.errors.join("; ");
        report.durationMs = now() - T0;
        if (!reportPath) {
            try { reportPath = joinPath(Folder.temp.fsName, "pressflow-report.json"); } catch (eTmp) { reportPath = "pressflow-report.json"; }
        }
        text = PFJSON.stringify(report, "  ");
        try {
            writeTextFile(reportPath, text);
            writeTextFile(joinPath(new File(reportPath).parent.fsName, "render.log"), LOG.join("\n") + "\n");
        } catch (eW) {
            try { $.writeln("[pressflow] could not write report: " + errText(eW)); } catch (eW2) { /* ignore */ }
        }
        if (opts && opts.interactive) {
            try {
                alert("PressFlow render " + (report.ok ? "finished" : "FAILED") + "\n\n" +
                    (report.error ? report.error + "\n\n" : "") +
                    "Pages: " + report.pages + "\nOverset frames: " + report.overset.length +
                    "\nFont substitutions: " + report.substitutedFonts.length +
                    "\nMissing links: " + report.missingLinks.length + "\n\nReport: " + reportPath);
            } catch (eA) { /* ignore */ }
        }
        return text;
    }

    return main(topArgs);
}(__PF_TOP_ARGS));
