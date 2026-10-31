"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Mail, UserRound } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signUpLive } from "@/lib/api/session";
import { ApiUnavailableError } from "@/lib/api/client";

export default function SignUpPage() {
  const router = useRouter();
  const [form, setForm] = React.useState({ name: "", email: "", organisation: "", password: "" });
  const [errors, setErrors] = React.useState<Partial<Record<keyof typeof form | "form", string>>>({});
  const [loading, setLoading] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (form.name.trim().length < 2) next.name = "Enter your full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = "Enter a valid email address.";
    if (form.organisation.trim().length < 2) next.organisation = "Enter your organisation's name.";
    if (form.password.length < 10) next.password = "Use at least 10 characters.";
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) next.password = "Use letters and at least one number.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    try {
      await signUpLive(form);
      router.push("/app");
    } catch (err) {
      setErrors({ form: err instanceof ApiUnavailableError ? err.message : err instanceof Error ? err.message : "Sign-up failed." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your organisation"
      subtitle="You become the owner. Invite editors and designers once you're in."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Full name" htmlFor="name" error={errors.name}>
          <Input id="name" autoComplete="name" leading={<UserRound />} value={form.name} onChange={set("name")} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Work email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" leading={<Mail />} value={form.email} onChange={set("email")} aria-invalid={!!errors.email} />
        </Field>
        <Field label="Organisation" htmlFor="org" error={errors.organisation} hint="e.g. Elets Technomedia">
          <Input id="org" autoComplete="organization" leading={<Building2 />} value={form.organisation} onChange={set("organisation")} aria-invalid={!!errors.organisation} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password} hint="At least 10 characters, with a number.">
          <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} aria-invalid={!!errors.password} />
        </Field>
        {errors.form && <p className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{errors.form}</p>}
        <Button type="submit" variant="dark" size="lg" loading={loading} className="mt-1 w-full">
          Create organisation
        </Button>
        <p className="text-center text-xs text-ink-4">
          Just looking?{" "}
          <Link href="/sign-in" className="text-accent hover:underline">
            Open the demo workspace instead
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
