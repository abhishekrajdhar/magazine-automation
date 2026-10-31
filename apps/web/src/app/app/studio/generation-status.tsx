"use client";

import * as React from "react";
import { CircleX, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/display";
import { Progress } from "@/components/ui/primitives";
import { live } from "@/lib/api/live";
import { loadWorkspace } from "@/lib/api/live-sync";
import type { Job } from "@/lib/domain/types";
import { formatRelative } from "@/lib/utils/format";

const DISMISSED_KEY = "pressflow.dismissedGenerationJobs";
const SHOW_FAILURES_FOR_MS = 24 * 60 * 60 * 1000;
const isActive = (j: Job) => j.status === "queued" || j.status === "running";

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * Recent article-generation jobs for a project. Polls while one is queued or
 * running, reloads the project's articles when one finishes, and tells the
 * editor how it went.
 */
export function useGenerationJobs(projectId: string | undefined, enabled: boolean) {
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const seen = React.useRef(new Map<string, Job["status"]>());
  React.useEffect(() => setDismissed(readDismissed()), []);

  const refresh = React.useCallback(async () => {
    if (!enabled || !projectId) return;
    let next: Job[];
    try {
      next = await live.generationJobs(projectId);
    } catch {
      return; // the API status banner already covers an unreachable API
    }
    let finished = false;
    for (const j of next) {
      const before = seen.current.get(j.id);
      if (before && (before === "queued" || before === "running") && !isActive(j)) {
        finished = true;
        if (j.status === "succeeded") toast.success("Drafts ready", { description: j.message ?? undefined });
        else if (j.status === "failed") toast.error("Article generation failed", { description: errorText(j) });
      }
      seen.current.set(j.id, j.status);
    }
    if (finished) await loadWorkspace(projectId).catch(() => undefined);
    setJobs(next);
  }, [enabled, projectId]);

  React.useEffect(() => {
    seen.current.clear();
    setJobs([]);
    void refresh();
  }, [refresh]);

  const active = jobs.some(isActive);
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [active, refresh]);

  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // dismissal just won't survive a reload
    }
  };

  // A failure stays up until dismissed, a day passes, or a later run succeeds.
  const lastSuccess = Math.max(0, ...jobs.filter((j) => j.status === "succeeded").map((j) => new Date(j.createdAt).getTime()));
  const visible = jobs.filter(
    (j) =>
      isActive(j) ||
      (j.status === "failed" &&
        !dismissed.includes(j.id) &&
        new Date(j.createdAt).getTime() > lastSuccess &&
        Date.now() - new Date(j.updatedAt).getTime() < SHOW_FAILURES_FOR_MS),
  );
  return { visible, active, refresh, dismiss };
}

function errorText(j: Job): string {
  const raw = (j.error ?? j.message ?? "Unknown error").split("\n")[0];
  return raw.length > 280 ? `${raw.slice(0, 277)}…` : raw;
}

export function GenerationStatus({ jobs, onDismiss }: { jobs: Job[]; onDismiss: (id: string) => void }) {
  if (!jobs.length) return null;
  return (
    <div className="mt-4 flex flex-col gap-2" aria-live="polite">
      {jobs.map((j) =>
        isActive(j) ? (
          <Panel key={j.id} className="flex items-start gap-3 px-4 py-3">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Generating drafts</p>
              <p className="text-xs text-ink-3">
                {j.status === "queued" ? "Waiting to start" : j.message ?? "Working"} · started {formatRelative(j.createdAt)}. Each article takes about 20–40 seconds; you can keep working.
              </p>
              <Progress value={j.status === "queued" ? 2 : j.progress} className="mt-2 max-w-md" />
            </div>
          </Panel>
        ) : (
          <Panel key={j.id} className="flex items-start gap-3 border-danger/30 px-4 py-3">
            <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Article generation failed {formatRelative(j.updatedAt)}</p>
              <p className="break-words text-xs text-ink-3">{errorText(j)}</p>
              <p className="mt-1 text-xs text-ink-4">Articles written before the failure are kept. Fix the cause, then generate again.</p>
            </div>
            <Button variant="ghost" size="xs" aria-label="Dismiss" onClick={() => onDismiss(j.id)}>
              <X />
            </Button>
          </Panel>
        ),
      )}
    </div>
  );
}
