"use client";

import type { Member, Organisation, Role, User } from "@/lib/domain/types";
import { useWorkspace } from "@/lib/store/workspace";
import { initials } from "@/lib/utils/format";
import { apiFetch } from "./client";

const MODE_COOKIE = "pf_mode";

function setModeCookie(mode: "demo" | "live" | null) {
  if (typeof document === "undefined") return;
  document.cookie = mode
    ? `${MODE_COOKIE}=${mode}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
    : `${MODE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function enterDemoSession() {
  useWorkspace.getState().enterDemo();
  setModeCookie("demo");
}

interface MeResponse {
  user: { id: string; name: string; email: string; title?: string | null };
  organisation: Organisation;
  role: Role;
}

function toUser(u: MeResponse["user"]): User {
  return { id: u.id, name: u.name, email: u.email, title: u.title ?? undefined, initials: initials(u.name) };
}

async function establishLive(): Promise<MeResponse> {
  const me = await apiFetch<MeResponse>("/auth/me");
  const members = await apiFetch<Member[]>("/orgs/current/members").catch(() => [] as Member[]);
  useWorkspace.getState().enterLive({ user: toUser(me.user), organisation: me.organisation, members });
  setModeCookie("live");
  return me;
}

export async function signInLive(email: string, password: string) {
  await apiFetch("/auth/login", { method: "POST", json: { email, password } });
  return establishLive();
}

export async function signUpLive(input: { name: string; email: string; password: string; organisation: string }) {
  await apiFetch("/auth/signup", { method: "POST", json: { name: input.name, email: input.email, password: input.password, organisationName: input.organisation } });
  return establishLive();
}

export async function requestPasswordReset(email: string) {
  await apiFetch("/auth/forgot-password", { method: "POST", json: { email } });
}

export async function signOutEverywhere() {
  const mode = useWorkspace.getState().mode;
  if (mode === "live") await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
  useWorkspace.getState().signOut();
  setModeCookie(null);
}
