"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CircleCheck, KeyRound } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/api/session";

/** Where a reset link or an invitation link lands: the person chooses a password, then signs in. */
function ResetPassword() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const invited = params.get("invite") === "1";
  const [password, setPassword] = React.useState("");
  const [again, setAgain] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== again) return setError("The two passwords don't match.");
    setError(null);
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password could not be saved.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={invited ? "Choose your password" : "Choose a new password"}
      subtitle={invited ? "You've been invited to a PressFlow workspace. Set a password to join it." : "The link works once. After saving, sign in with the new password."}
      footer={
        <Link href="/sign-in" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
          <ArrowLeft className="size-3.5" /> Back to sign in
        </Link>
      }
    >
      {!token ? (
        <div className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-3">
          This page needs the link from your invitation or password-reset message. <Link href="/forgot-password" className="font-medium text-accent hover:underline">Request a new link</Link>.
        </div>
      ) : done ? (
        <div className="rounded-lg border border-line bg-surface p-5">
          <CircleCheck className="size-5 text-success" />
          <p className="mt-3 text-sm font-medium">Password saved</p>
          <p className="mt-1 text-sm text-ink-3">Other sessions on this account have been signed out.</p>
          <Button variant="dark" size="lg" className="mt-4 w-full" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="New password" htmlFor="password" hint="At least 8 characters.">
            <Input id="password" type="password" autoComplete="new-password" leading={<KeyRound />} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Repeat it" htmlFor="again" error={error ?? undefined}>
            <Input id="again" type="password" autoComplete="new-password" leading={<KeyRound />} value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={!!error} />
          </Field>
          <Button type="submit" variant="dark" size="lg" loading={loading} className="w-full">
            Save password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense>
      <ResetPassword />
    </React.Suspense>
  );
}
