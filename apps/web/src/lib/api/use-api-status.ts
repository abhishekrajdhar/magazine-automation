"use client";

import * as React from "react";
import { apiFetch, type IntegrationStatus } from "./client";

interface ApiStatus {
  checking: boolean;
  online: boolean;
  integrations: IntegrationStatus[];
  refresh: () => void;
}

let cache: { at: number; online: boolean; integrations: IntegrationStatus[] } | null = null;

/** Whether the PressFlow API answers, plus its integration report. Cached for 30 s. */
export function useApiStatus(): ApiStatus {
  const [state, setState] = React.useState(() => ({ checking: !cache, online: cache?.online ?? false, integrations: cache?.integrations ?? [] }));
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (cache && Date.now() - cache.at < 30_000 && nonce === 0) return;
    let cancelled = false;
    setState((s) => ({ ...s, checking: true }));
    (async () => {
      let online = false;
      let integrations: IntegrationStatus[] = [];
      try {
        await apiFetch("/health");
        online = true;
        const res = await apiFetch<IntegrationStatus[] | { integrations: IntegrationStatus[] }>("/integrations/status").catch(() => []);
        integrations = Array.isArray(res) ? res : res.integrations ?? [];
      } catch {
        online = false;
      }
      cache = { at: Date.now(), online, integrations };
      if (!cancelled) setState({ checking: false, online, integrations });
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { ...state, refresh: () => setNonce((n) => n + 1) };
}

export function integration(list: IntegrationStatus[], key: string): IntegrationStatus | undefined {
  return list.find((i) => i.key === key);
}
