//@target indesign
//@targetengine "pressflow"
/*
 * PressFlow AI - list installed fonts (ExtendScript, ES3).
 *
 * Writes {ok, indesignVersion, indesignApp, count, fonts:[{family, style, postscriptName, status}]}
 * as JSON to `outPath` and returns the same JSON string. Used by the bridge heartbeat.
 *
 * Arguments: arguments[0] = path to a JSON args file ({"outPath": "..."}), a JSON string,
 * or "outPath=..."; otherwise app.scriptArgs "outPath" / "argsFile"; otherwise a save dialog.
 *
 * STATUS: not yet executed inside InDesign (see docs/indesign.md, "Testing status").
 */

var __PF_TOP_ARGS = (typeof arguments !== "undefined") ? arguments : null;

(function (topArgs) {
    function isArray(v) { return Object.prototype.toString.call(v) === "[object Array]"; }
    function has(o, k) { return o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k); }

    function quote(str) {
        var map = { "\\": "\\\\", "\"": "\\\"", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
        return "\"" + String(str).replace(/[\\"\x00-\x1f]/g, function (c) {
            if (has(map, c)) { return map[c]; }
            var h = c.charCodeAt(0).toString(16);
            while (h.length < 4) { h = "0" + h; }
            return "\\u" + h;
        }) + "\"";
    }
    function stringify(v) {
        var parts = [], i, k;
        if (v === null || v === undefined) { return "null"; }
        if (typeof v === "number") { return isFinite(v) ? String(v) : "null"; }
        if (typeof v === "boolean") { return v ? "true" : "false"; }
        if (typeof v === "string") { return quote(v); }
        if (isArray(v)) {
            for (i = 0; i < v.length; i++) { parts.push(stringify(v[i])); }
            return "[" + parts.join(",") + "]";
        }
        for (k in v) { if (has(v, k) && typeof v[k] !== "function") { parts.push(quote(k) + ":" + stringify(v[k])); } }
        return "{" + parts.join(",") + "}";
    }
    function readText(path) {
        var f = new File(path), s;
        f.encoding = "UTF-8";
        if (!f.open("r")) { throw new Error("Cannot open " + path); }
        s = f.read();
        f.close();
        return s;
    }
    function writeText(path, text) {
        var f = new File(path);
        if (f.parent && !f.parent.exists) { f.parent.create(); }
        f.encoding = "UTF-8";
        f.lineFeed = "Unix";
        if (!f.open("w")) { throw new Error("Cannot write " + path); }
        f.write(text);
        f.close();
    }
    // Minimal extraction of "outPath" from a small JSON args file (no full parser needed here).
    function outPathFromJson(text) {
        var m = /"outPath"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(text));
        if (!m) { return null; }
        return m[1].replace(/\\(["\\\/])/g, "$1");
    }
    function everyItemProp(coll, prop) {
        var v = null, out = [], i, len = 0;
        try { v = coll.everyItem()[prop]; } catch (e) { v = null; }
        if (v !== null && v !== undefined) { return isArray(v) ? v : [v]; }
        try { len = coll.length; } catch (e2) { len = 0; }
        for (i = 0; i < len; i++) {
            try { out.push(coll.item(i)[prop]); } catch (e3) { out.push(null); }
        }
        return out;
    }
    function statusName(st) {
        try {
            if (st == FontStatus.INSTALLED) { return "installed"; }
            if (st == FontStatus.NOT_AVAILABLE) { return "not_available"; }
            if (st == FontStatus.FAUXED) { return "fauxed"; }
            if (st == FontStatus.SUBSTITUTED) { return "substituted"; }
        } catch (e) { /* ignore */ }
        return "unknown";
    }

    var outPath = null, first, result, fam, sty, ps, st, i, fonts = [], text;
    if (topArgs && topArgs.length > 0 && topArgs[0]) {
        first = String(topArgs[0]);
        if (first.charAt(0) === "{") {
            outPath = outPathFromJson(first);
        } else if (/\.json$/i.test(first) && new File(first).exists && first.indexOf("=") < 0) {
            outPath = outPathFromJson(readText(first));
        } else if (first.indexOf("outPath=") === 0) {
            outPath = first.substring("outPath=".length);
        }
    }
    if (!outPath) {
        try {
            if (app.scriptArgs.isDefined("outPath")) { outPath = app.scriptArgs.getValue("outPath"); } else if (app.scriptArgs.isDefined("argsFile")) { outPath = outPathFromJson(readText(app.scriptArgs.getValue("argsFile"))); }
        } catch (eArgs) { /* ignore */ }
    }

    result = { ok: false, indesignVersion: null, indesignApp: null, count: 0, fonts: [] };
    try {
        result.indesignVersion = String(app.version);
        result.indesignApp = String(app.name);
        fam = everyItemProp(app.fonts, "fontFamily");
        sty = everyItemProp(app.fonts, "fontStyleName");
        ps = everyItemProp(app.fonts, "postscriptName");
        st = everyItemProp(app.fonts, "status");
        for (i = 0; i < fam.length; i++) {
            if (!fam[i]) { continue; }
            fonts.push({
                family: String(fam[i]),
                style: sty[i] ? String(sty[i]) : "",
                postscriptName: ps[i] ? String(ps[i]) : null,
                status: statusName(st[i])
            });
        }
        result.fonts = fonts;
        result.count = fonts.length;
        result.ok = true;
    } catch (e) {
        result.error = (e && e.message) ? e.message : String(e);
    }
    text = stringify(result);
    if (!outPath) {
        try {
            if (String(app.name).indexOf("Server") < 0) {
                var picked = File.saveDialog("Save installed font list as JSON", "JSON:*.json");
                if (picked) { outPath = picked.fsName; }
            }
        } catch (eDlg) { /* ignore */ }
    }
    if (outPath) {
        try { writeText(outPath, text); } catch (eW) { try { $.writeln("[pressflow] " + eW.message); } catch (eW2) { /* ignore */ } }
    }
    return text;
}(__PF_TOP_ARGS));
