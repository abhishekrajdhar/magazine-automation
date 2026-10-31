"use client";

import * as React from "react";
import { BadgeCheck, CircleHelp, Pencil, Search, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import type { EventSession, Speaker, SpeakerVerification } from "@/lib/domain/types";
import { useWorkspace } from "@/lib/store/workspace";
import { Avatar, Badge, EmptyState, Panel, Table, Td, Th, type Tone } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, Select } from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/primitives";
import { initials } from "@/lib/utils/format";

export const verificationInfo: Record<SpeakerVerification, { label: string; tone: Tone; icon: React.ReactNode; hint: string }> = {
  confirmed: { label: "Confirmed", tone: "success", icon: <BadgeCheck />, hint: "Name and designation confirmed against the event agenda or by an editor." },
  unverified: { label: "Unverified", tone: "warning", icon: <CircleHelp />, hint: "Taken from the recording but not yet confirmed. Don't publish the designation until checked." },
  ai_suggested: { label: "AI-suggested", tone: "accent", icon: <Sparkles />, hint: "Inferred from the transcript by the model. Must be confirmed by a person." },
};

export function SpeakersTable({ speakers, sessions }: { speakers: Speaker[]; sessions: EventSession[] }) {
  const updateSpeaker = useWorkspace((s) => s.updateSpeaker);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<Speaker | null>(null);
  const list = speakers.filter((s) => !query || `${s.name} ${s.organisation} ${s.designation}`.toLowerCase().includes(query.toLowerCase()));

  if (!speakers.length) return <Panel><EmptyState icon={<Users />} title="No speakers yet" description="Speakers are identified when recordings are transcribed and analysed." /></Panel>;

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Input className="w-full sm:w-72" inputSize="sm" leading={<Search />} placeholder="Search speakers…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search speakers" />
        <p className="ml-auto text-xs text-ink-3">Designations are never published until confirmed.</p>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Speaker</Th>
            <Th>Designation</Th>
            <Th>Sessions</Th>
            <Th>Verification</Th>
            <Th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} className="hover:bg-subtle">
              <Td>
                <div className="flex items-center gap-2.5">
                  <Avatar initials={initials(s.name)} seed={s.id} size={28} />
                  <span className="font-medium">{s.name}</span>
                </div>
              </Td>
              <Td className="max-w-[320px]">
                <span className="block truncate text-ink-2">{s.designation}</span>
                <span className="block truncate text-xs text-ink-3">{s.organisation}</span>
              </Td>
              <Td className="max-w-[260px] text-xs text-ink-3">
                <span className="line-clamp-2">{sessions.filter((x) => x.speakerIds.includes(s.id)).map((x) => x.title.split(":")[0]).join(", ")}</span>
              </Td>
              <Td>
                <Tooltip content={verificationInfo[s.verification].hint}>
                  <span>
                    <Select
                      size="sm"
                      className="w-40"
                      aria-label={`Verification for ${s.name}`}
                      value={s.verification}
                      onValueChange={(v) => {
                        updateSpeaker(s.id, { verification: v });
                        toast.success(`${s.name}: ${verificationInfo[v].label.toLowerCase()}`);
                      }}
                      options={(Object.keys(verificationInfo) as SpeakerVerification[]).map((k) => ({ value: k, label: verificationInfo[k].label }))}
                    />
                  </span>
                </Tooltip>
              </Td>
              <Td>
                <Button variant="ghost" size="icon-xs" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                  <Pencil />
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <SpeakerDialog speaker={editing} onClose={() => setEditing(null)} onSave={(patch) => editing && updateSpeaker(editing.id, patch)} />
    </Panel>
  );
}

export function VerificationBadge({ v }: { v: SpeakerVerification }) {
  const info = verificationInfo[v];
  return (
    <Tooltip content={info.hint}>
      <span>
        <Badge tone={info.tone} icon={info.icon}>
          {info.label}
        </Badge>
      </span>
    </Tooltip>
  );
}

function SpeakerDialog({ speaker, onClose, onSave }: { speaker: Speaker | null; onClose: () => void; onSave: (p: Partial<Speaker>) => void }) {
  const [form, setForm] = React.useState({ name: "", designation: "", organisation: "", bio: "" });
  React.useEffect(() => {
    if (speaker) setForm({ name: speaker.name, designation: speaker.designation ?? "", organisation: speaker.organisation ?? "", bio: speaker.bio ?? "" });
  }, [speaker]);
  return (
    <Dialog open={!!speaker} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Edit speaker"
        description="Editing a name or designation marks the speaker as confirmed by you."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={form.name.trim().length < 2}
              onClick={() => {
                onSave({ ...form, verification: "confirmed" });
                toast.success("Speaker updated and confirmed");
                onClose();
              }}
            >
              Save & confirm
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Name" htmlFor="sp-name">
            <Input id="sp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Designation" htmlFor="sp-des">
            <Input id="sp-des" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          </Field>
          <Field label="Organisation" htmlFor="sp-org">
            <Input id="sp-org" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
          </Field>
          <Field label="Short bio" htmlFor="sp-bio" optional>
            <Textarea id="sp-bio" rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
