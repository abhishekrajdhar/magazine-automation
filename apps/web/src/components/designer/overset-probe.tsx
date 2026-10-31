"use client";

import * as React from "react";
import type { useProjectData } from "@/lib/store/hooks";
import { PageView } from "@/components/magazine/page-view";

type Data = ReturnType<typeof useProjectData>;

/**
 * Renders every page off-screen at 100% and reports which text frames overflow.
 * This is the same renderer the editor uses, so the result matches what you see.
 */
export function useOversetProbe(data: Data) {
  const [map, setMap] = React.useState<Record<string, boolean>>({});
  const [ready, setReady] = React.useState(false);
  const pending = React.useRef<Record<string, boolean>>({});
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const report = React.useCallback((pageId: string, elementId: string, over: boolean) => {
    pending.current[`${pageId}:${elementId}`] = over;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setMap((m) => {
        const next = { ...m, ...pending.current };
        return Object.keys(next).every((k) => next[k] === m[k]) && Object.keys(m).length === Object.keys(next).length ? m : next;
      });
      setReady(true);
    }, 120);
  }, []);

  const probe =
    data.profile && data.pages.length ? (
      <div aria-hidden style={{ position: "fixed", left: -20000, top: 0, visibility: "hidden", pointerEvents: "none" }}>
        {data.pages.map((p, i) => (
          <PageView key={p.id} page={p} profile={data.profile!} assets={data.assetsById} ctx={data.ctxFor(i)} scale={1} localUrls={data.localUrls} onOverset={(id, over) => report(p.id, id, over)} />
        ))}
      </div>
    ) : null;

  return { overset: map, ready, probe };
}
