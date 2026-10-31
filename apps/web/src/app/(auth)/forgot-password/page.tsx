"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck, Mail } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/api/session";
import { ApiUnavailableError } from "@/lib/api/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiUnavailableError ? err.message : err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll send a reset link to the email address on your account."
      footer={
        <Link href="/sign-in" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
          <ArrowLeft className="size-3.5" /> Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="rounded-lg border border-line bg-surface p-5">
          <MailCheck className="size-5 text-success" />
          <p className="mt-3 text-sm font-medium">Request received</p>
          <p className="mt-1 text-sm text-ink-3">
            If an account exists for <span className="font-medium text-ink-2">{email}</span>, a reset link has been issued. Email delivery depends on your deployment&apos;s mail provider; in local development the link is written to the API log.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Work email" htmlFor="email" error={error ?? undefined}>
            <Input id="email" type="email" autoComplete="email" leading={<Mail />} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />
          </Field>
          <Button type="submit" variant="dark" size="lg" loading={loading} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
