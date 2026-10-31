/*
 * A deliberately small, fake InDesign scripting DOM for running the ExtendScript renderer
 * under Node. It exists to exercise the script's control flow (argument parsing, JSON
 * polyfill, validation, font fallback, approval gating, shrink-to-fit loop, report
 * writing) on a machine without InDesign.
 *
 * IT DOES NOT PROVE INDESIGN COMPATIBILITY. Property/method names here mirror the
 * documented InDesign DOM as understood by the author; real InDesign may differ.
 * "Output" files written by this mock are text placeholders, never real INDD/PDF.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const vm = require("vm");

const MOCK_MARKER = "PRESSFLOW-MOCK-OUTPUT (written by tests/js/mock_indesign.js, NOT by Adobe InDesign)";

// ---------------------------------------------------------------- enums
const ENUMS = {
  UserInteractionLevels: ["NEVER_INTERACT", "INTERACT_WITH_ALL", "INTERACT_WITH_ALERTS"],
  MeasurementUnits: ["POINTS", "MILLIMETERS", "INCHES", "PICAS"],
  RulerOrigin: ["PAGE_ORIGIN", "SPREAD_ORIGIN", "SPINE_ORIGIN"],
  OpenOptions: ["OPEN_COPY", "OPEN_ORIGINAL", "DEFAULT_VALUE"],
  BaselineGridRelativeOption: ["TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION", "TOP_OF_MARGIN_OF_BASELINE_GRID_RELATIVE_OPTION"],
  LocationOptions: ["AT_END", "AT_BEGINNING", "BEFORE", "AFTER", "UNKNOWN"],
  ColorModel: ["PROCESS", "SPOT", "REGISTRATION", "MIXEDINKMODEL"],
  ColorSpace: ["CMYK", "RGB", "LAB", "MIXEDINK"],
  Justification: ["LEFT_ALIGN", "CENTER_ALIGN", "RIGHT_ALIGN", "LEFT_JUSTIFIED", "CENTER_JUSTIFIED", "RIGHT_JUSTIFIED", "FULLY_JUSTIFIED"],
  Capitalization: ["NORMAL", "ALL_CAPS", "SMALL_CAPS", "CAP_TO_SMALL_CAP"],
  CornerOptions: ["NONE", "ROUNDED_CORNER", "INVERSE_ROUNDED_CORNER", "INSET_CORNER", "BEVEL_CORNER", "FANCY_CORNER"],
  TextWrapModes: ["NONE", "BOUNDING_BOX_TEXT_WRAP", "CONTOUR", "JUMP_OBJECT_TEXT_WRAP", "NEXT_COLUMN_TEXT_WRAP"],
  PageSideOptions: ["LEFT_HAND", "RIGHT_HAND", "SINGLE_SIDED"],
  SpecialCharacters: ["AUTO_PAGE_NUMBER", "NEXT_PAGE_NUMBER", "SECTION_MARKER", "EM_SPACE", "FORCED_LINE_BREAK"],
  VerticalJustification: ["TOP_ALIGN", "CENTER_ALIGN", "BOTTOM_ALIGN", "JUSTIFY_ALIGN"],
  NothingEnum: ["NOTHING"],
  FitOptions: ["FILL_PROPORTIONALLY", "PROPORTIONALLY", "CENTER_CONTENT", "CONTENT_TO_FRAME", "FRAME_TO_CONTENT"],
  CoordinateSpaces: ["INNER_COORDINATES", "PARENT_COORDINATES", "PASTEBOARD_COORDINATES", "SPREAD_COORDINATES"],
  AnchorPoint: ["CENTER_ANCHOR", "TOP_LEFT_ANCHOR", "TOP_CENTER_ANCHOR"],
  ResizeMethods: ["MULTIPLYING_CURRENT_DIMENSIONS_BY", "REPLACING_CURRENT_DIMENSIONS_WITH", "ADDING_CURRENT_DIMENSIONS_TO"],
  AutoSizingReferenceEnum: ["TOP_CENTER_POINT", "TOP_LEFT_POINT", "CENTER_POINT"],
  AutoSizingTypeEnum: ["OFF", "HEIGHT_ONLY", "WIDTH_ONLY", "HEIGHT_AND_WIDTH", "HEIGHT_AND_WIDTH_PROPORTIONALLY"],
  Leading: ["AUTO"],
  FontStatus: ["INSTALLED", "NOT_AVAILABLE", "FAUXED", "SUBSTITUTED", "UNKNOWN"],
  LinkStatus: ["NORMAL", "LINK_OUT_OF_DATE", "LINK_MISSING", "LINK_EMBEDDED", "LINK_INACCESSIBLE"],
  PageRange: ["ALL_PAGES", "SELECTED_ITEMS"],
  ExportFormat: ["PDF_TYPE", "INDESIGN_MARKUP", "JPG", "PNG_FORMAT"],
  SaveOptions: ["NO", "YES", "ASK"],
};

function makeEnums(unknownLog) {
  const out = {};
  for (const [name, members] of Object.entries(ENUMS)) {
    const target = {};
    for (const m of members) target[m] = `${name}.${m}`;
    out[name] = new Proxy(target, {
      get(t, prop) {
        if (typeof prop !== "string") return t[prop];
        if (prop in t) return t[prop];
        unknownLog.push(`${name}.${prop}`);
        throw new Error(`mock: unknown enum member ${name}.${prop}`);
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------- collections
class Coll extends Array {
  static get [Symbol.species]() { return Array; }
  item(i) {
    const idx = i < 0 ? this.length + i : i;
    if (idx < 0 || idx >= this.length) throw new Error(`mock: collection index ${i} out of range`);
    return this[idx];
  }
  itemByName(n) {
    return this.find((x) => x && x.name === n) || { isValid: false, name: n };
  }
  everyItem() {
    const self = this;
    return new Proxy({}, {
      get(_, prop) {
        if (prop === "getElements") return () => Array.from(self);
        if (prop === "remove") return () => { for (const x of Array.from(self)) if (x.remove) x.remove(); };
        return Array.from(self).map((x) => x[prop]);
      },
      set(_, prop, v) { for (const x of self) x[prop] = v; return true; },
    });
  }
}

function coll(items, addFn) {
  const c = Coll.from(items || []);
  if (addFn) Object.defineProperty(c, "add", { value: addFn.bind(null, c), enumerable: false });
  return c;
}

// ---------------------------------------------------------------- file system
function makeFileClasses(state) {
  class Folder {
    constructor(p) { this._p = path.resolve(String(p)); }
    get exists() { return fs.existsSync(this._p) && fs.statSync(this._p).isDirectory(); }
    get fsName() { return this._p; }
    get name() { return path.basename(this._p); }
    get parent() { const d = path.dirname(this._p); return d === this._p ? null : new Folder(d); }
    create() { fs.mkdirSync(this._p, { recursive: true }); return true; }
    static get temp() { return new Folder(state.tempDir); }
    static selectDialog() { return null; }
  }
  class File {
    constructor(p) { this._p = path.resolve(String(p)); this.encoding = "BINARY"; this.lineFeed = "Unix"; this.error = ""; }
    get exists() { return fs.existsSync(this._p) && fs.statSync(this._p).isFile(); }
    get fsName() { return this._p; }
    get name() { return path.basename(this._p); }
    get parent() { return new Folder(path.dirname(this._p)); }
    open(mode) {
      this._mode = mode;
      if (mode === "r") {
        if (!this.exists) { this.error = "not found"; return false; }
        this._buf = fs.readFileSync(this._p, "utf8");
      } else {
        if (!fs.existsSync(path.dirname(this._p))) { this.error = "no parent folder"; return false; }
        this._buf = "";
      }
      return true;
    }
    read() { return this._buf; }
    write(s) { this._buf += String(s); return true; }
    close() { if (this._mode === "w") fs.writeFileSync(this._p, this._buf, "utf8"); this._mode = null; return true; }
    remove() { fs.rmSync(this._p, { force: true }); return true; }
    static openDialog() { return null; }
    static saveDialog() { return null; }
  }
  File.fs = "Macintosh";
  return { File, Folder };
}

// ---------------------------------------------------------------- DOM objects
let idSeq = 1;

class Base {
  constructor(props) {
    this.id = idSeq++;
    this.isValid = true;
    this._labels = {};
    if (props) Object.assign(this, props);
  }
  insertLabel(k, v) { this._labels[k] = String(v); }
  extractLabel(k) { return this._labels[k] || ""; }
}

class PageItem extends Base {
  constructor(page, kind, props) {
    super();
    this.kind = kind;
    this.page = page;
    this.label = "";
    this.name = "";
    this.geometricBounds = [0, 0, 10, 10];
    this.transparencySettings = { blendingSettings: { opacity: 100 } };
    this.strokeWeight = 1;
    this.strokeColor = "Black";
    this.fillColor = "None";
    this.appliedObjectStyle = null;
    if (props) Object.assign(this, props);
  }
  applyObjectStyle(os) { if (!os || !os.isValid) throw new Error("mock: invalid object style"); this.appliedObjectStyle = os; }
  remove() {
    const list = this.page[this.collName];
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
    this.isValid = false;
  }
}

class Text extends Base {
  constructor(story) { super(); this.story = story; this.pointSize = undefined; this.leading = undefined; }
  applyParagraphStyle(ps) {
    if (!ps || !ps.isValid) throw new Error("mock: invalid paragraph style");
    this.story.appliedParagraphStyle = ps;
    this.pointSize = undefined;
    this.leading = undefined;
  }
}

class Story extends Base {
  constructor(frame) {
    super();
    this.frame = frame;
    this.text = "";
    this.appliedParagraphStyle = null;
    this._text = new Text(this);
    this.texts = coll([this._text]);
  }
  get paragraphs() {
    const self = this;
    return coll(this.text.split("\r").map(() => ({ set appliedParagraphStyle(ps) { self.appliedParagraphStyle = ps; } })));
  }
  recompose() { this.frame.state.calls.push({ op: "recompose", frame: this.frame.label }); }
}

class TextFrame extends PageItem {
  constructor(page, props, state) {
    super(page, "text", props);
    this.collName = "textFrames";
    this.state = state;
    this.textFramePreferences = { textColumnCount: 1, textColumnGutter: 12, autoSizingType: "AutoSizingTypeEnum.OFF" };
    this.parentStory = new Story(this);
    this.strokeColor = "None";
    this.strokeWeight = 0;
  }
  get contents() { return this.parentStory.text; }
  set contents(v) { this.parentStory.text = String(v); }
  get insertionPoints() {
    const story = this.parentStory;
    const ip = (where) => ({
      set contents(v) {
        const s = v === "SpecialCharacters.AUTO_PAGE_NUMBER" ? "<#>" : String(v);
        story.text = where === "start" ? s + story.text : story.text + s;
      },
    });
    const c = coll([ip("start"), ip("end")]);
    c.item = (i) => (i === 0 ? ip("start") : ip("end"));
    return c;
  }
  // Rough text-fit model: chars per line ~ columnWidth / (0.5 * pointSize).
  get overflows() {
    const t = this.parentStory._text;
    const ps = this.parentStory.appliedParagraphStyle;
    const size = t.pointSize !== undefined ? t.pointSize : (ps && typeof ps.pointSize === "number" ? ps.pointSize : 12);
    const lead = t.leading !== undefined ? t.leading : (ps && typeof ps.leading === "number" ? ps.leading : size * 1.2);
    const [top, left, bottom, right] = this.geometricBounds;
    if (this.textFramePreferences.autoSizingType === "AutoSizingTypeEnum.HEIGHT_ONLY") return false;
    const cols = this.textFramePreferences.textColumnCount || 1;
    const gutter = this.textFramePreferences.textColumnGutter || 0;
    const colW = (right - left - gutter * (cols - 1)) / cols;
    const perLine = Math.max(1, Math.floor(colW / (0.5 * size)));
    const needed = this.parentStory.text.split(/[\r\n]/).reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
    const available = Math.floor((bottom - top) / lead) * cols;
    return needed > available;
  }
}

class Image extends Base {
  constructor(rect, file) {
    super();
    this.rect = rect;
    this.filePath = file;
    this.naturalW = 600;
    this.naturalH = 400; // 3:2 like the example asset
    this.absoluteHorizontalScale = 100;
    this.absoluteVerticalScale = 100;
    const [t, l] = rect.geometricBounds;
    this.cx = l + this.naturalW / 2;
    this.cy = t + this.naturalH / 2;
  }
  get w() { return this.naturalW * this.absoluteHorizontalScale / 100; }
  get h() { return this.naturalH * this.absoluteVerticalScale / 100; }
  get geometricBounds() { return [this.cy - this.h / 2, this.cx - this.w / 2, this.cy + this.h / 2, this.cx + this.w / 2]; }
  move(to, by) { if (to !== undefined && to !== null) throw new Error("mock: move(to) unsupported"); this.cx += by[0]; this.cy += by[1]; }
  resize() { throw new Error("mock: resize unsupported"); }
}

class Rectangle extends PageItem {
  constructor(page, props, state) {
    super(page, "rect", props);
    this.collName = "rectangles";
    this.state = state;
    this.allGraphics = coll([]);
  }
  place(file) {
    if (!file || !file.exists) throw new Error("mock: place() file does not exist");
    const img = new Image(this, file.fsName);
    this.allGraphics.push(img);
    this.state.doc.links.push({ status: "LinkStatus.NORMAL", filePath: file.fsName });
    this.state.calls.push({ op: "place", frame: this.label, file: file.fsName });
    return [img];
  }
  fit(opt) {
    this.state.calls.push({ op: "fit", option: opt });
    const g = this.allGraphics[0];
    if (!g) return;
    const [t, l, b, r] = this.geometricBounds;
    const fw = r - l, fh = b - t;
    if (opt === "FitOptions.FILL_PROPORTIONALLY" || opt === "FitOptions.PROPORTIONALLY") {
      const sx = fw / g.naturalW, sy = fh / g.naturalH;
      const s = opt === "FitOptions.FILL_PROPORTIONALLY" ? Math.max(sx, sy) : Math.min(sx, sy);
      g.absoluteHorizontalScale = s * 100;
      g.absoluteVerticalScale = s * 100;
      // InDesign keeps the fitting reference point (top-left by default).
      g.cx = l + g.w / 2;
      g.cy = t + g.h / 2;
    } else if (opt === "FitOptions.CENTER_CONTENT") {
      g.cx = l + fw / 2;
      g.cy = t + fh / 2;
    }
  }
}

class GraphicLine extends PageItem {
  constructor(page, props) {
    super(page, "line", props);
    this.collName = "graphicLines";
    this.paths = coll([{ entirePath: [] }]);
  }
}

class Page extends Base {
  constructor(doc, state, isMaster) {
    super();
    this.doc = doc;
    this.state = state;
    this.isMaster = !!isMaster;
    this.appliedMaster = null;
    this.marginPreferences = {};
    this._sideOverride = null;
    this.textFrames = coll([], (c, props) => { const f = new TextFrame(this, props, state); c.push(f); state.calls.push({ op: "add", type: "textFrame", master: this.isMaster }); return f; });
    this.rectangles = coll([], (c, props) => { const f = new Rectangle(this, props, state); c.push(f); state.calls.push({ op: "add", type: "rectangle" }); return f; });
    this.graphicLines = coll([], (c, props) => { const f = new GraphicLine(this, props); c.push(f); state.calls.push({ op: "add", type: "graphicLine" }); return f; });
  }
  get side() {
    if (this._sideOverride) return this._sideOverride;
    if (!this.doc.documentPreferences.facingPages) return "PageSideOptions.SINGLE_SIDED";
    const idx = this.doc.pages.indexOf(this);
    const start = this.doc.documentPreferences.startPageNumber || 1;
    return (start + idx) % 2 === 0 ? "PageSideOptions.LEFT_HAND" : "PageSideOptions.RIGHT_HAND";
  }
  get pageItems() {
    const all = [...this.textFrames, ...this.rectangles, ...this.graphicLines];
    return coll(all);
  }
  remove() {
    const i = this.doc.pages.indexOf(this);
    if (i >= 0) this.doc.pages.splice(i, 1);
    this.isValid = false;
  }
}

class MasterSpread extends Base {
  constructor(doc, state, nPages, props) {
    super();
    this.doc = doc;
    this._prefix = "A";
    this.baseName = "Parent";
    if (props && props.namePrefix !== undefined) this.namePrefix = props.namePrefix;
    if (props && props.baseName !== undefined) this.baseName = props.baseName;
    this.pages = coll([]);
    for (let i = 0; i < nPages; i++) {
      const p = new Page(doc, state, true);
      if (nPages === 2) p._sideOverride = i === 0 ? "PageSideOptions.LEFT_HAND" : "PageSideOptions.RIGHT_HAND";
      else p._sideOverride = "PageSideOptions.SINGLE_SIDED";
      this.pages.push(p);
    }
  }
  get namePrefix() { return this._prefix; }
  set namePrefix(p) {
    // Assumption mirrored from the InDesign UI: master prefixes must be unique.
    if (this.doc.masterSpreads && this.doc.masterSpreads.some((m) => m !== this && m.namePrefix === p)) {
      throw new Error(`mock: master prefix '${p}' already in use`);
    }
    this._prefix = p;
  }
  get name() { return `${this.namePrefix}-${this.baseName}`; }
}

// Subset of PDFExportPreset properties (per the InDesign DOM reference). Note: no viewPDF.
const PRESET_PROPS = new Set(["name", "standardsCompliance", "cropMarks", "useDocumentBleedWithPDF", "pageMarksOffset", "bleedMarks", "effectivePDFDestinationProfile"]);

class Preset extends Base {
  constructor(coll_, props, readOnly) {
    super();
    this._coll = coll_;
    this._readOnly = new Set(readOnly || []);
    this.name = "";
    this.standardsCompliance = "None";
    this.cropMarks = false;
    this.bleedMarks = false;
    this.useDocumentBleedWithPDF = false;
    this.pageMarksOffset = 6;
    if (props) Object.assign(this, props);
    return new Proxy(this, {
      set(t, prop, v) {
        if (typeof prop === "string" && !prop.startsWith("_") && !["id", "isValid"].includes(prop)) {
          if (!PRESET_PROPS.has(prop)) throw new Error(`mock: PDFExportPreset has no property ${prop}`);
          if (t._readOnly.has(prop)) throw new Error(`mock: ${prop} is read-only`);
        }
        return Reflect.set(t, prop, v);
      },
    });
  }
  // A read-only property, like effectivePDFDestinationProfile in the real DOM.
  get effectivePDFDestinationProfile() { return "Document CMYK"; }
  set effectivePDFDestinationProfile(v) { throw new Error("mock: read-only property"); }
  get properties() {
    return {
      name: this.name,
      standardsCompliance: this.standardsCompliance,
      cropMarks: this.cropMarks,
      useDocumentBleedWithPDF: this.useDocumentBleedWithPDF,
      pageMarksOffset: this.pageMarksOffset,
      bleedMarks: this.bleedMarks,
      effectivePDFDestinationProfile: this.effectivePDFDestinationProfile,
    };
  }
  remove() { const i = this._coll.indexOf(this); if (i >= 0) this._coll.splice(i, 1); this.isValid = false; }
}

class Document extends Base {
  constructor(state, template) {
    super();
    const doc = this;
    this.state = state;
    this.name = "Untitled-1";
    this.zeroPoint = [0, 0];
    this.viewPreferences = {};
    this.marginPreferences = {};
    this.gridPreferences = {};
    this.links = coll([]);
    this.fonts = coll((template && template.missingFonts || []).map((n) => ({ name: n, status: "FontStatus.NOT_AVAILABLE" })));
    this.pages = coll([], (c, where) => { const p = new Page(doc, state); c.push(p); state.calls.push({ op: "addPage", where }); return p; });
    const pagesProxyTarget = { facingPages: true, pageWidth: 612, pageHeight: 792, startPageNumber: 1, documentBleedTopOffset: 0 };
    this.documentPreferences = new Proxy(pagesProxyTarget, {
      set(t, prop, v) {
        t[prop] = v;
        if (prop === "pagesPerDocument") {
          while (doc.pages.length < v) doc.pages.push(new Page(doc, state));
          while (doc.pages.length > v) doc.pages.pop();
        }
        return true;
      },
    });
    this.pages.push(new Page(doc, state));
    this.colors = coll(
      ["Black", "Registration", "Paper", "Cyan", "Magenta", "Yellow"].map((n) => new Base({ name: n })),
      (c, props) => { if (c.some((x) => x.name === props.name)) throw new Error("mock: duplicate colour"); const col = new Base(props); c.push(col); state.calls.push({ op: "add", type: "color", name: props.name }); return col; }
    );
    const styleAdd = (type) => (c, props) => {
      if (c.some((x) => x.name === props.name)) throw new Error(`mock: duplicate ${type}`);
      const s = new Base(Object.assign({ pointSize: 12, leading: "Leading.AUTO" }, props));
      c.push(s);
      state.calls.push({ op: "add", type, name: props.name });
      return s;
    };
    this.paragraphStyles = coll(["[No Paragraph Style]", "[Basic Paragraph]"].map((n) => new Base({ name: n, pointSize: 12, leading: "Leading.AUTO" })), styleAdd("paragraphStyle"));
    this.characterStyles = coll([new Base({ name: "[None]" })], styleAdd("characterStyle"));
    this.objectStyles = coll(["[None]", "[Basic Graphics Frame]", "[Basic Text Frame]"].map((n) => new Base({ name: n, textWrapPreferences: {} })), (c, props) => {
      const s = new Base(Object.assign({ textWrapPreferences: {} }, props));
      c.push(s);
      state.calls.push({ op: "add", type: "objectStyle", name: props.name });
      return s;
    });
    this.sections = coll([new Base({ name: "Section 1" })], (c, page, props) => {
      const s = new Base(Object.assign({ pageStart: page }, props));
      c.push(s);
      state.calls.push({ op: "add", type: "section", props });
      return s;
    });
    this.masterSpreads = coll([], (c, n, props) => { const ms = new MasterSpread(doc, state, n || 2, props); c.push(ms); state.calls.push({ op: "add", type: "masterSpread", props }); return ms; });
    if (template && template.masters && template.masters.length) {
      for (const m of template.masters) {
        const dash = m.indexOf("-");
        this.masterSpreads.push(new MasterSpread(doc, state, 2, { namePrefix: m.slice(0, dash), baseName: m.slice(dash + 1) }));
      }
    } else {
      this.masterSpreads.push(new MasterSpread(doc, state, 2));
    }
    // Styles inside style groups are not in doc.paragraphStyles, only in doc.allParagraphStyles.
    this._groupedParagraphStyles = [];
    if (template) {
      for (const n of template.paragraphStyles || []) this.paragraphStyles.push(new Base({ name: n, pointSize: 20, leading: 24 }));
      for (const n of template.groupedParagraphStyles || []) this._groupedParagraphStyles.push(new Base({ name: n, pointSize: 20, leading: 24 }));
      for (const n of template.colors || []) this.colors.push(new Base({ name: n }));
      Object.assign(pagesProxyTarget, { pageWidth: template.pageWidth || 595.28, pageHeight: template.pageHeight || 841.89, facingPages: template.facingPages !== false, documentBleedTopOffset: 9 });
    }
  }
  get swatches() { return coll([new Base({ name: "None" }), ...this.colors]); }
  get allParagraphStyles() { return [...this.paragraphStyles, ...this._groupedParagraphStyles]; }
  get allCharacterStyles() { return Array.from(this.characterStyles); }
  get allObjectStyles() { return Array.from(this.objectStyles); }
  recompose() {}
  save(file) {
    fs.writeFileSync(file.fsName, `${MOCK_MARKER}\nformat=indd\n`);
    this.state.calls.push({ op: "save", path: file.fsName });
    return this;
  }
  exportFile(format, file, showing, preset) {
    if (file.parent && !file.parent.exists) throw new Error("mock: export folder missing");
    fs.writeFileSync(file.fsName, `${MOCK_MARKER}\nformat=${format}\npreset=${preset ? preset.name : ""}\n`);
    this.state.calls.push({ op: "exportFile", format, path: file.fsName, preset: preset ? preset.properties : null });
  }
  close(opt) { this.state.calls.push({ op: "close", opt }); this.isValid = false; }
}

// ---------------------------------------------------------------- app
function makeApp(state, opts) {
  const fonts = coll((opts.fonts || []).map(([family, style, ps]) => ({
    name: `${family}\t${style}`, fontFamily: family, fontStyleName: style, postscriptName: ps || `${family.replace(/\s+/g, "")}-${style.replace(/\s+/g, "")}`, status: "FontStatus.INSTALLED",
  })));
  const scriptArgsStore = Object.assign({}, opts.scriptArgs || {});
  const presets = coll([], (c, props) => { const p = new Preset(c, props, opts.presetReadOnly); c.push(p); state.calls.push({ op: "add", type: "pdfPreset", name: props.name }); return p; });
  for (const n of ["[High Quality Print]", "[Press Quality]", "[PDF/X-1a:2001]", "[PDF/X-4:2008]", "[Smallest File Size]"]) {
    presets.push(new Preset(presets, { name: n, standardsCompliance: n.indexOf("PDF/X-4") >= 0 ? "PDFX4_2008" : "None" }));
  }
  const app = {
    version: "20.0.0.mock",
    name: opts.serverName ? "Adobe InDesign Server (mock)" : "Adobe InDesign (mock)",
    scriptPreferences: { userInteractionLevel: "UserInteractionLevels.INTERACT_WITH_ALL", measurementUnit: "AutoEnum.AUTO_VALUE", enableRedraw: true },
    pdfExportPreferences: { viewPDF: true },
    scriptArgs: {
      isDefined: (k) => Object.prototype.hasOwnProperty.call(scriptArgsStore, k),
      getValue: (k) => { if (!(k in scriptArgsStore)) throw new Error("mock: undefined script arg"); return scriptArgsStore[k]; },
      setValue: (k, v) => { scriptArgsStore[k] = String(v); },
      clear: () => { for (const k of Object.keys(scriptArgsStore)) delete scriptArgsStore[k]; state.calls.push({ op: "scriptArgs.clear" }); },
    },
    fonts,
    pdfExportPresets: presets,
    documents: coll([], (c) => { const d = new Document(state); state.doc = d; c.push(d); return d; }),
    open(file) {
      const tpl = JSON.parse(fs.readFileSync(file.fsName, "utf8"));
      const d = new Document(state, tpl);
      state.doc = d;
      state.calls.push({ op: "open", path: file.fsName });
      return d;
    },
  };
  return app;
}

/**
 * Run an ExtendScript file against the mock DOM.
 * opts: { jsxPath, arguments?: string[], scriptArgs?: object, fonts?: [family, style, ps?][], serverName?: bool,
 *         presetReadOnly?: string[] (properties that cannot be set on presets created by the script) }
 */
function runJsx(opts) {
  const state = { calls: [], unknownEnums: [], logs: [], alerts: [], tempDir: opts.tempDir || os.tmpdir(), doc: null };
  const { File, Folder } = makeFileClasses(state);
  const sandbox = Object.assign({
    app: makeApp(state, opts),
    File,
    Folder,
    $: { writeln: (s) => state.logs.push(String(s)), os: "Macintosh OS 15.0.0" },
    alert: (s) => state.alerts.push(String(s)),
  }, makeEnums(state.unknownEnums));
  if (opts.arguments) sandbox.arguments = opts.arguments;
  const code = fs.readFileSync(opts.jsxPath, "utf8");
  const result = vm.runInNewContext(code, sandbox, { filename: opts.jsxPath, timeout: 30000 });
  return { result, calls: state.calls, unknownEnums: state.unknownEnums, logs: state.logs, alerts: state.alerts };
}

module.exports = { runJsx, MOCK_MARKER };

if (require.main === module) {
  // CLI: node mock_indesign.js <scenario.json>  -> prints {result, calls, unknownEnums, logs}
  const scenario = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const out = runJsx(scenario);
  process.stdout.write(JSON.stringify(out));
}
