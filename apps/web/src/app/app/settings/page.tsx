"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpenCheck, Building2, CircleCheck, CircleDashed, CircleX, Database, FlaskConical, KeyRound, Plug, RefreshCw, Server, UserPlus, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Avatar, Badge, PageHeader, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/display";
import { Dialog, DialogContent, Select, useConfirm } from "@/components/ui/overlays";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { useApiStatus } from "@/lib/api/use-api-status";
import type { IntegrationStatus } from "@/lib/api/client";
import { apiFetch } from "@/lib/api/client";
import type { Role } from "@/lib/domain/types";
import { formatRelative, initials } from "@/lib/utils/format";

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including billing and deleting the organisation" },
  { value: "admin", label: "Admin", description: "Members, integrations and all content" },
  { value: "editor", label: "Editor", description: "Recordings, facts and articles; approves copy" },
  { value: "designer", label: "Designer", description: "References, templates, pages and exports" },
  { value: "viewer", label: "Viewer", description: "Read-only" },
];

/** What each integration needs, shown when it isn't configured. */
const EXPECTED: { key: string; label: string; env: string; purpose: string }[] = [
  { key: "database", label: "Database", env: "DATABASE_URL", purpose: "PostgreSQL (Neon / Supabase) in production; SQLite locally." },
  { key: "storage", label: "Object storage", env: "STORAGE_BACKEND, S3_*", purpose: "Videos, audio, PDFs, extracted images and exports." },
  { key: "llm", label: "LLM provider", env: "LLM_PROVIDER, ANTHROPIC_API_KEY", purpose: "Transcript analysis, article drafting and editing assistance." },
  { key: "transcription", label: "Transcription", env: "TRANSCRIPTION_PROVIDER, OPENAI_API_KEY", purpose: "Whisper-compatible speech-to-text for uploads and Drive files." },
  { key: "youtube_metadata", label: "YouTube metadata", env: "—", purpose: "Titles and thumbnails via oEmbed (no key needed)." },
  { key: "youtube_captions", label: "YouTube captions", env: "YOUTUBE_API_KEY + Google OAuth", purpose: "Caption download for videos your account owns." },
  { key: "google_drive", label: "Google Drive", env: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET", purpose: "Read-only access to shared recordings." },
  { key: "ffmpeg", label: "FFmpeg", env: "on PATH", purpose: "Audio extraction and probing." },
  { key: "yt_dlp", label: "yt-dlp", env: "YOUTUBE_ALLOW_DOWNLOAD", purpose: "Optional; only for videos your organisation owns or has rights to." },
  { key: "indesign_bridge", label: "InDesign bridge", env: "INDESIGN_BRIDGE_TOKEN", purpose: "Native .indd and PDF/X-4 output from Adobe InDesign." },
];

function SettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = React.useState(params.get("tab") ?? "profile");
  React.useEffect(() => setTab(params.get("tab") ?? "profile"), [params]);
  const onTab = (t: string) => {
    setTab(t);
    router.replace(`/app/settings?tab=${t}`);
  };
  return (
    <div className="mx-auto max-w-[1080px] px-6 py-7">
      <PageHeader title="Settings" description="Your profile, organisation, team and integrations." />
      <Tabs value={tab} onValueChange={onTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="profile"><UserRound /> Profile</TabsTrigger>
          <TabsTrigger value="organisation"><Building2 /> Organisation</TabsTrigger>
          <TabsTrigger value="members"><Users /> Members & roles</TabsTrigger>
          <TabsTrigger value="integrations"><Plug /> Integrations</TabsTrigger>
          <TabsTrigger value="workspace"><Database /> Workspace data</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="pt-5"><ProfileTab /></TabsContent>
        <TabsContent value="organisation" className="pt-5"><OrganisationTab /></TabsContent>
        <TabsContent value="members" className="pt-5"><MembersTab /></TabsContent>
        <TabsContent value="integrations" className="pt-5"><IntegrationsTab /></TabsContent>
        <TabsContent value="workspace" className="pt-5"><WorkspaceTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileTab() {
  const user = useWorkspace((s) => s.user);
  const mode = useWorkspace((s) => s.mode);
  const [name, setName] = React.useState(user?.name ?? "");
  const [title, setTitle] = React.useState(user?.title ?? "");
  return (
    <Panel>
      <PanelHeader title="Your profile" />
      <div className="flex flex-col gap-5 p-5 sm:flex-row">
        <Avatar initials={initials(name || "?")} seed={user?.id} size={64} />
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="me-name"><Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Title" htmlFor="me-title"><Input id="me-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Email" htmlFor="me-email" hint={mode === "demo" ? "Demo account — not a real mailbox." : undefined}><Input id="me-email" value={user?.email ?? ""} disabled /></Field>
        </div>
      </div>
      <div className="flex justify-end border-t border-line px-5 py-3">
        <Button
          variant="primary"
          disabled={name.trim().length < 2}
          onClick={() => {
            useWorkspace.setState((s) => ({ user: s.user ? { ...s.user, name: name.trim(), title, initials: initials(name) } : s.user, members: s.members.map((m) => (m.userId === s.user?.id ? { ...m, name: name.trim(), title, initials: initials(name) } : m)) }));
            toast.success("Profile saved");
          }}
        >
          Save profile
        </Button>
      </div>
    </Panel>
  );
}

function OrganisationTab() {
  const org = useWorkspace((s) => s.organisation);
  const [name, setName] = React.useState(org?.name ?? "");
  return (
    <Panel>
      <PanelHeader title="Organisation" description={org?.plan === "demo" ? "Demo workspace" : undefined} />
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        <Field label="Organisation name" htmlFor="org-name"><Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Workspace URL" htmlFor="org-slug" hint="Used in links shared with your team."><Input id="org-slug" value={org?.slug ?? ""} disabled /></Field>
      </div>
      <div className="flex justify-end border-t border-line px-5 py-3">
        <Button variant="primary" disabled={name.trim().length < 2} onClick={() => { useWorkspace.setState((s) => ({ organisation: s.organisation ? { ...s.organisation, name: name.trim() } : s.organisation })); toast.success("Organisation updated"); }}>
          Save
        </Button>
      </div>
    </Panel>
  );
}

function MembersTab() {
  const members = useWorkspace((s) => s.members);
  const me = useWorkspace((s) => s.user);
  const mode = useWorkspace((s) => s.mode);
  const confirm = useConfirm();
  const [inviting, setInviting] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("editor");
  const myRole = members.find((m) => m.userId === me?.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  return (
    <div className="flex flex-col gap-5">
      <Panel className="overflow-hidden">
        <PanelHeader title={`${members.length} members`} actions={<Button variant="primary" size="sm" disabled={!canManage} onClick={() => setInviting(true)}><UserPlus /> Invite</Button>} />
        <Table>
          <thead>
            <tr><Th>Member</Th><Th>Role</Th><Th>Last active</Th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={m.initials} seed={m.userId} size={28} />
                    <div>
                      <p className="font-medium">{m.name}{m.userId === me?.id && <span className="ml-1.5 text-xs text-ink-4">(you)</span>}</p>
                      <p className="text-xs text-ink-3">{m.email}</p>
                    </div>
                  </div>
                </Td>
                <Td className="w-52">
                  <Select
                    size="sm"
                    value={m.role}
                    disabled={!canManage || m.role === "owner" || m.userId === me?.id}
                    onValueChange={async (r) => {
                      if (!(await confirm({ title: `Make ${m.name} ${r === "admin" ? "an" : "a"} ${r}?`, description: ROLES.find((x) => x.value === r)?.description, confirmLabel: "Change role" }))) return;
                      if (mode === "live") await apiFetch(`/orgs/current/members/${m.userId}`, { method: "PATCH", json: { role: r } }).catch((e) => toast.error((e as Error).message));
                      useWorkspace.setState((s) => ({ members: s.members.map((x) => (x.userId === m.userId ? { ...x, role: r } : x)) }));
                      toast.success("Role updated");
                    }}
                    options={ROLES.map((r) => ({ value: r.value, label: r.label, disabled: r.value === "owner" }))}
                  />
                </Td>
                <Td className="text-xs text-ink-3">{formatRelative(m.lastActiveAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel>
        <PanelHeader title="Roles" description="Enforced by the API on every request." />
        <ul className="divide-y divide-line">
          {ROLES.map((r) => (
            <li key={r.value} className="flex items-center gap-4 px-4 py-2.5 text-sm">
              <span className="w-24 font-medium">{r.label}</span>
              <span className="text-ink-3">{r.description}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent
          title="Invite a member"
          description={mode === "demo" ? "In the demo workspace the invitation is recorded locally; no email is sent." : "Invitation emails are sent by your deployment's mail provider."}
          footer={
            <>
              <Button variant="secondary" onClick={() => setInviting(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                onClick={async () => {
                  if (mode === "live") {
                    try {
                      await apiFetch("/orgs/current/members", { method: "POST", json: { email, role } });
                    } catch (e) {
                      return toast.error((e as Error).message);
                    }
                  }
                  useWorkspace.setState((s) => ({ members: [...s.members, { userId: `inv_${email}`, name: email.split("@")[0], email, role, initials: email.slice(0, 2).toUpperCase() }] }));
                  setInviting(false);
                  setEmail("");
                  toast.success("Invitation recorded", { description: mode === "demo" ? "Demo only — no email was sent." : undefined });
                }}
              >
                Invite
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Field label="Email" htmlFor="inv-email"><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Role"><Select value={role} onValueChange={setRole} options={ROLES.filter((r) => r.value !== "owner").map((r) => ({ value: r.value, label: r.label, description: r.description }))} /></Field>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntegrationsTab() {
  const api = useApiStatus();
  const mode = useWorkspace((s) => s.mode);
  const byKey = (k: string): IntegrationStatus | undefined => api.integrations.find((i) => i.key === k);
  const bridge = byKey("indesign_bridge");
  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-wrap items-center gap-3 p-4">
        <Server className={api.online ? "size-5 text-success" : "size-5 text-ink-4"} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">PressFlow API {api.checking ? "— checking…" : api.online ? "— connected" : "— not reachable"}</p>
          <p className="text-xs text-ink-3">
            {api.online ? "Statuses below come from live checks on the server." : "Start the API (services/api) to process recordings, analyse references and render exports. The demo workspace works without it."}
            {mode === "demo" && api.online && " You're in the demo workspace; sign in to a live organisation to use the API."}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={api.refresh} loading={api.checking}><RefreshCw /> Re-check</Button>
      </Panel>
      <Panel className="overflow-hidden">
        <PanelHeader title="Integrations" description="Credentials live only in the API's environment. They are never sent to the browser." icon={<KeyRound />} />
        <ul className="divide-y divide-line">
          {EXPECTED.map((e) => {
            const s = byKey(e.key);
            const state = !api.online ? "unknown" : s?.available ? "ok" : s?.configured ? "error" : "off";
            return (
              <li key={e.key} className="flex items-start gap-3 px-4 py-3">
                {state === "ok" ? <CircleCheck className="mt-0.5 size-4 text-success" /> : state === "error" ? <CircleX className="mt-0.5 size-4 text-danger" /> : <CircleDashed className="mt-0.5 size-4 text-ink-4" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s?.label ?? e.label}</p>
                  <p className="text-xs text-ink-3">{s?.detail ?? e.purpose}</p>
                  {state !== "ok" && <p className="mt-1 font-mono text-[11px] text-ink-4">{s?.docsHint ?? e.env}</p>}
                </div>
                <Badge tone={state === "ok" ? "success" : state === "error" ? "danger" : "neutral"}>{state === "ok" ? "Available" : state === "error" ? "Configured · failing" : state === "off" ? "Not configured" : "Unknown"}</Badge>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel>
        <PanelHeader title="Adobe InDesign bridge" icon={<BookOpenCheck />} description={bridge?.available ? bridge.detail : "Not connected — native .indd export is unavailable."} />
        <div className="grid grid-cols-1 gap-4 p-4 text-sm md:grid-cols-3">
          {[
            ["1", "Install", "On a Mac or Windows machine with InDesign (desktop or Server), install the bridge from services/indesign/bridge."],
            ["2", "Configure", "Set PRESSFLOW_API_URL and INDESIGN_BRIDGE_TOKEN (same token as the API). Install the licensed fonts used by your templates."],
            ["3", "Run", "python -m pressflow_bridge --check, then start it. It sends a heartbeat every 30 s and renders queued INDD / print PDF jobs."],
          ].map(([n, t, b]) => (
            <div key={n} className="rounded-md border border-line p-3">
              <p className="tabular text-xs text-ink-4">Step {n}</p>
              <p className="mt-1 font-medium">{t}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">{b}</p>
            </div>
          ))}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-ink-3">The UXP panel in services/indesign/uxp can render a queued job from inside InDesign instead. See docs/indesign.md.</p>
      </Panel>
    </div>
  );
}

function WorkspaceTab() {
  const mode = useWorkspace((s) => s.mode);
  const resetDemo = useWorkspace((s) => s.resetDemo);
  const confirm = useConfirm();
  const router = useRouter();
  return (
    <Panel>
      <PanelHeader title="Workspace data" icon={<FlaskConical />} />
      <div className="flex flex-col gap-4 p-4 text-sm">
        {mode === "demo" ? (
          <>
            <p className="text-ink-2">The demo workspace is stored in this browser. People, quotations, statistics, recordings and photographs are fictional, and processing steps are simulated.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const blob = new Blob([localStorage.getItem("pressflow-workspace") ?? "{}"], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "pressflow-demo-workspace.json";
                  a.click();
                }}
              >
                Download workspace JSON
              </Button>
              <Button
                variant="danger-ghost"
                onClick={async () => {
                  if (await confirm({ title: "Reset demo workspace?", description: "Discards every change made in this browser and restores the seeded demo.", confirmLabel: "Reset", tone: "danger" })) {
                    resetDemo();
                    toast.success("Demo workspace reset");
                    router.push("/app");
                  }
                }}
              >
                Reset demo data
              </Button>
            </div>
          </>
        ) : (
          <p className="text-ink-2">Live workspace data is stored by the PressFlow API in your organisation&apos;s database and object storage.</p>
        )}
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  return (
    <React.Suspense>
      <SettingsInner />
    </React.Suspense>
  );
}
