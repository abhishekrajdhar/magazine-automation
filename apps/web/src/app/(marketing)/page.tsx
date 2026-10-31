"use client";

import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  BookOpenCheck,
  Captions,
  CircleCheck,
  Clapperboard,
  FileArchive,
  FileJson,
  FileText,
  Images,
  LibraryBig,
  NotebookPen,
  PanelsTopLeft,
  Printer,
  Quote,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Waypoints,
} from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { BeforeAfter } from "@/components/marketing/before-after";

const steps = [
  { n: "01", title: "Upload a reference issue", body: "Drop in a past magazine PDF. PressFlow measures its trim, margins, grid, type hierarchy, colour and page types, and rebuilds them as editable templates.", icon: LibraryBig },
  { n: "02", title: "Add the event recordings", body: "Paste YouTube or Google Drive links, or upload video and audio. Captions are used where you're entitled to them; otherwise the audio is transcribed.", icon: Clapperboard },
  { n: "03", title: "Review what was said", body: "Speakers, sessions, quotations and figures are extracted with timestamps. Editors approve facts before a single article is drafted.", icon: BookOpenCheck },
  { n: "04", title: "Approve, plan and export", body: "Drafts are checked against their sources, planned onto a flatplan, composed in your house style, preflighted and exported.", icon: PanelsTopLeft },
];

const pipeline = [
  { label: "Video source", icon: Clapperboard },
  { label: "Acquisition", icon: Waypoints },
  { label: "Audio extraction", icon: AudioLines },
  { label: "Transcription", icon: Captions },
  { label: "Speakers", icon: Users },
  { label: "Quotes & figures", icon: Quote, gate: true },
  { label: "Articles", icon: NotebookPen, gate: true },
  { label: "Flatplan", icon: PanelsTopLeft },
  { label: "Preflight", icon: ShieldCheck, gate: true },
  { label: "InDesign / PDF", icon: Printer },
];

const features = [
  { icon: ScanSearch, title: "Reference intelligence", body: "Page dimensions, margins, columns, gutters, baseline, type hierarchy, palette, folios and eleven page types — stored as a structured design profile you can correct and approve." },
  { icon: Clapperboard, title: "Event video intelligence", body: "Transcripts with speaker segments, sessions, topics, announcements and Q&A. Every quotation carries its recording and timestamp." },
  { icon: NotebookPen, title: "Editorial studio", body: "Event reports, keynotes, interviews and profiles drafted from approved facts. Side-by-side with the transcript, with claim verification built in." },
  { icon: PanelsTopLeft, title: "Flatplan and designer", body: "Drag pages into order, lock what's signed off, swap templates, edit frames, crop images and preview spreads — on real, editable page elements." },
  { icon: ShieldCheck, title: "Automated preflight", body: "Overset text, missing images, low resolution, font substitutions, margin violations, numbering and unapproved copy — each with a fix." },
  { icon: Printer, title: "InDesign automation", body: "A structured layout contract drives Adobe InDesign to build the native .indd from your approved templates. No InDesign? The rest keeps working, and we say so." },
];

const formats = [
  { icon: FileText, label: "PDF for digital publishing", note: "Preview renderer" },
  { icon: Printer, label: "Print-ready PDF", note: "Bleed & crop marks" },
  { icon: BookOpenCheck, label: "Native .indd", note: "Requires InDesign bridge" },
  { icon: Images, label: "Page previews", note: "Per page" },
  { icon: NotebookPen, label: "Article package", note: "Markdown + JSON" },
  { icon: FileArchive, label: "Asset archive", note: "With manifest" },
  { icon: FileJson, label: "Layout contract", note: "JSON hand-off" },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-8 px-6">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-ink-3 md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#product" className="hover:text-ink">Product</a>
            <a href="#formats" className="hover:text-ink">Formats</a>
            <a href="#principles" className="hover:text-ink">Principles</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" asChild className="hidden sm:inline-flex">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button variant="dark" asChild>
              <Link href="/sign-in">
                <span className="sm:hidden">Sign in</span>
                <span className="hidden sm:inline">Open workspace</span> <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="hairline-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
        <div className="relative mx-auto max-w-[1200px] px-6 pb-16 pt-16 md:pt-24">
          <div className="mx-auto max-w-[820px] text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-3 shadow-xs">
              <Sparkles className="size-3.5 text-accent" /> AI magazine production for event-driven publishers
            </span>
            <h1 className="mt-6 font-serif text-[44px] font-medium leading-[1.04] tracking-[-0.025em] text-ink md:text-[68px]">
              From Event Videos to Publication-Ready Magazines.
            </h1>
            <p className="mx-auto mt-6 max-w-[620px] text-[17px] leading-relaxed text-ink-3">
              Transform event recordings, interviews and speeches into professionally designed magazines using AI and your existing editorial templates.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" size="lg" asChild>
                <Link href="/sign-in">
                  Explore the demo workspace <ArrowRight />
                </Link>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-5 text-xs text-ink-4">Every page is live, editable text and frames — never a generated picture of a page.</p>
          </div>
          <div className="mt-14">
            <HeroDemo />
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-[1200px] grid-cols-2 divide-line px-6 md:grid-cols-5 md:divide-x">
          {[
            ["8", "session recordings"],
            ["24", "speakers identified"],
            ["40", "sourced facts & quotes"],
            ["18", "article drafts"],
            ["40", "composed pages"],
          ].map(([n, l]) => (
            <div key={l} className="px-4 py-6 text-center">
              <div className="tabular font-serif text-3xl font-medium text-ink">{n}</div>
              <div className="mt-1 text-xs text-ink-3">{l}</div>
            </div>
          ))}
        </div>
        <p className="pb-4 text-center text-[11px] text-ink-4">Figures from the demo workspace (fictional summit content).</p>
      </section>

      <section id="how" className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">How it works</p>
          <h2 className="mt-3 font-serif text-[38px] font-medium leading-tight tracking-[-0.02em]">Your last issue is the design brief.</h2>
          <p className="mt-4 text-ink-3">PressFlow doesn&apos;t invent a look. It studies the magazine you already publish and reproduces its design system, so new issues read like they came from the same desk.</p>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="bg-surface p-6">
              <div className="flex items-center justify-between">
                <span className="tabular font-mono text-xs text-ink-4">{s.n}</span>
                <s.icon className="size-4 text-accent" />
              </div>
              <h3 className="mt-8 text-md font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-3">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-subtle">
        <div className="mx-auto max-w-[1200px] px-6 py-20">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">The pipeline</p>
              <h2 className="mt-3 font-serif text-[34px] font-medium leading-tight tracking-[-0.02em]">Automated where it&apos;s safe. Human where it matters.</h2>
            </div>
            <p className="flex items-center gap-2 text-sm text-ink-3">
              <span className="inline-block size-2 rounded-full bg-warning-dot" /> Editorial approval gate
            </p>
          </div>
          <ol className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
            {pipeline.map((p, i) => (
              <li key={p.label} className="relative">
                <div className={`flex h-full flex-col items-start gap-3 rounded-lg border bg-surface p-3 ${p.gate ? "border-warning-dot/50" : "border-line"}`}>
                  <span className={`flex size-8 items-center justify-center rounded-md ${p.gate ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent"}`}>
                    <p.icon className="size-4" />
                  </span>
                  <span className="text-xs font-medium leading-tight text-ink">{p.label}</span>
                  <span className="tabular mt-auto font-mono text-[10px] text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1fr_440px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Reference-driven generation</p>
            <h2 className="mt-3 font-serif text-[38px] font-medium leading-tight tracking-[-0.02em]">Reference in. House style out.</h2>
            <p className="mt-4 max-w-lg text-ink-3">A reference PDF isn&apos;t treated as screenshots. Its frames, columns and type are reconstructed into templates that adapt to the grid — so a three-column reference produces three-column pages, with your margins, your folios and your pull-quote style.</p>
            <ul className="mt-8 space-y-3 text-sm">
              {["Trim size, margins and facing-page parity", "Column count, gutter and baseline from body text", "Type hierarchy with detected font names (never guaranteed)", "Palette, image placement, captions and folio style", "Page types: cover, contents, report, interview, gallery and more"].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-ink-2">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <BeforeAfter />
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
          <h2 className="max-w-xl font-serif text-[34px] font-medium leading-tight tracking-[-0.02em]">One studio, from recording to print.</h2>
          <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title}>
                <f.icon className="size-5 text-accent" />
                <h3 className="mt-4 text-md font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-3">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="formats" className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-6 py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-serif text-[30px] font-medium tracking-[-0.02em]">Supported outputs</h2>
            <p className="max-w-md text-sm text-ink-3">Native InDesign output is produced only by Adobe InDesign through the PressFlow bridge. When it isn&apos;t connected, we say so.</p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            {formats.map((f) => (
              <div key={f.label} className="rounded-lg border border-line bg-surface p-4">
                <f.icon className="size-4 text-ink-3" />
                <p className="mt-6 text-sm font-medium leading-tight">{f.label}</p>
                <p className="mt-1 text-xs text-ink-4">{f.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="principles" className="border-t border-line bg-subtle">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-6 py-20 md:grid-cols-4">
          <h2 className="font-serif text-[30px] font-medium leading-tight tracking-[-0.02em]">Editors stay in control.</h2>
          {[
            { icon: Quote, t: "Sourced, not invented", b: "Quotes are verified against transcripts. Speaker names and designations are marked as verified, unverified or AI-suggested." },
            { icon: UserRound, t: "Nothing ships unapproved", b: "Unapproved articles can be drafted and laid out, but they block final export until an editor signs off." },
            { icon: ShieldCheck, t: "Honest integrations", b: "No fake processing, no fake files. If a provider or InDesign isn't configured, the product tells you plainly." },
          ].map((p) => (
            <div key={p.t}>
              <p.icon className="size-5 text-accent" />
              <h3 className="mt-4 text-md font-semibold">{p.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-3">{p.b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-navy">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em] text-white">See a 40-page issue come together.</h2>
            <p className="mt-2 text-white/60">The demo workspace is fully explorable — no account, no API keys.</p>
          </div>
          <Button size="lg" className="bg-white text-navy hover:bg-white/90" asChild>
            <Link href="/sign-in">
              Open the demo workspace <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="text-xs text-ink-4">Built for Elets Technomedia</span>
          </div>
          <nav className="flex flex-wrap gap-5 text-sm text-ink-3">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#product" className="hover:text-ink">Product</a>
            <a href="#formats" className="hover:text-ink">Formats</a>
            <Link href="/sign-in" className="hover:text-ink">Sign in</Link>
          </nav>
          <p className="text-xs text-ink-4">© {new Date().getFullYear()} Elets Technomedia Pvt. Ltd.</p>
        </div>
      </footer>
    </div>
  );
}
