"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, FlaskConical, Mail } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/primitives";
import { enterDemoSession, signInLive } from "@/lib/api/session";
import { ApiUnavailableError } from "@/lib/api/client";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/app";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Passwords are at least 8 characters.");
    setLoading(true);
    try {
      await signInLive(email, password);
      router.push(next.startsWith("/app") ? next : "/app");
    } catch (err) {
      setError(err instanceof ApiUnavailableError ? err.message : err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  };

  const demo = () => {
    enterDemoSession();
    toast.success("Demo workspace ready", { description: "Seeded with fictional data for the National eGovernance Summit 2026." });
    router.push("/app");
  };

  return (
    <>
      <button
        onClick={demo}
        className="group flex w-full items-center gap-3 rounded-lg border border-accent-line bg-accent-soft px-4 py-3 text-left transition-colors hover:border-accent"
      >
        <span className="flex size-9 items-center justify-center rounded-md bg-accent text-white">
          <FlaskConical className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-accent-ink">Explore the demo workspace</span>
          <span className="block text-xs text-ink-3">No account or API needed. Simulated data, clearly labelled.</span>
        </span>
        <ArrowRight className="size-4 text-accent transition-transform group-hover:translate-x-0.5" />
      </button>

      <div className="my-6 flex items-center gap-3 text-xs text-ink-4">
        <Separator className="flex-1" /> or sign in to your organisation <Separator className="flex-1" />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Work email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" leading={<Mail />} placeholder="name@elets.in" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error && !email} />
        </Field>
        <Field
          label="Password"
          aside={
            <Link href="/forgot-password" className="text-xs text-accent hover:underline">
              Forgot password?
            </Link>
          }
          htmlFor="password"
        >
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="dark" size="lg" loading={loading} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </>
  );
}

export default function SignInPage() {
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your PressFlow workspace."
      footer={
        <p>
          New to PressFlow?{" "}
          <Link href="/sign-up" className="font-medium text-accent hover:underline">
            Create an organisation
          </Link>
        </p>
      }
    >
      <React.Suspense>
        <SignInForm />
      </React.Suspense>
    </AuthLayout>
  );
}
