/**
 * Writes the demo workspace to packages/demo-data/workspace.json so the API's
 * seed script loads exactly the data the browser demo shows.
 *
 *   npm run export:demo
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoSeed } from "../src/lib/demo/workspace";
import { templateSpecs } from "../src/lib/templates/specs";
import { resolveSlots } from "../src/lib/templates/compose";
import type { Template } from "../src/lib/domain/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, "packages/demo-data/workspace.json");
const seed = buildDemoSeed();
const profile = seed.designProfiles[0];

// Built-in templates normalised against the demo profile (recto page), so the
// API knows every template id the flatplan references.
const builtins: Template[] = templateSpecs.map((spec) => ({
  id: spec.id,
  name: spec.name,
  pageType: spec.pageType,
  source: "builtin",
  description: spec.description,
  columns: Math.max(1, ...resolveSlots({ kind: "spec", spec }, profile, 1).map((s) => s.columns)),
  slots: resolveSlots({ kind: "spec", spec }, profile, 1).map((s) => ({
    id: s.id,
    role: s.role,
    x: +(s.x / profile.page.widthPt).toFixed(4),
    y: +(s.y / profile.page.heightPt).toFixed(4),
    w: +(s.w / profile.page.widthPt).toFixed(4),
    h: +(s.h / profile.page.heightPt).toFixed(4),
    columns: s.columns > 1 ? s.columns : undefined,
  })),
}));

const { workspace, ...rest } = seed;
const payload = {
  generatedAt: new Date().toISOString(),
  note: "Demo workspace for Elets PressFlow AI. All people, quotations, statistics, recordings and photographs are fictional.",
  organisation: rest.organisation,
  users: [rest.user],
  members: rest.members,
  references: rest.references,
  referencePages: rest.referencePages,
  designProfiles: rest.designProfiles,
  templates: [...builtins, ...rest.templates],
  activity: rest.activity,
  workspaces: [
    {
      project: rest.projects[0],
      ...workspace,
    },
  ],
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(`Wrote ${out} (${workspace.pages.length} pages, ${workspace.articles.length} articles, ${builtins.length + rest.templates.length} templates)`);
