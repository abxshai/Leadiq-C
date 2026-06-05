"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoginHero } from "@/components/login-hero";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// Every teammate signs in as the same Supabase user. The "email" here
// is just a lookup key — no emails are ever sent. Create this user once
// in Supabase dashboard → Authentication → Users → Add User (auto-confirm).
const SHARED_EMAIL = "team@lead-iq.local";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setErr(null);

    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email: SHARED_EMAIL,
      password,
    });

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    // Only allow same-origin paths — reject full URLs and
    // protocol-relative targets like "//evil.com".
    const rawNext =
      new URLSearchParams(window.location.search).get("next") ?? "/campaigns";
    const next =
      rawNext.startsWith("/") && !rawNext.startsWith("//")
        ? rawNext
        : "/campaigns";
    window.location.replace(next);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-6xl">
        {/* Hero row: title left, ASCII right */}
        <div className="grid gap-10 sm:gap-32 sm:grid-cols-[1fr_1.5fr] items-center mb-10">
          <div className="space-y-3">
            <h1 className="relative inline-block font-display text-4xl sm:text-5xl lowercase tracking-wide leading-none [-webkit-text-stroke:0.7px_currentColor]">
              lead-
              <span className="text-primary">IQ</span>
              {/* Deccan logo at the top-right corner of the wordmark. */}
              <Image
                src="/logowhite.png"
                alt="Lead-IQ"
                width={220}
                height={68}
                priority
                className="pointer-events-none absolute left-full top-0 ml-2 -translate-y-1/3 h-5 w-auto object-contain"
              />
            </h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              Qualify LinkedIn leads against your ICP with Groq&apos;s
              gpt-oss-120b. Bring your own key.
            </p>
          </div>
          <div className="flex justify-end overflow-hidden">
            <LoginHero />
          </div>
        </div>

        {/* Password-only sign-in */}
        <div className="max-w-md">
          <div className="rounded-xl border border-border bg-card/60 p-8 backdrop-blur-xl">
            <h2 className="text-xl font-semibold">Enter password</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Shared access — ask a teammate for the password.
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              {err ? (
                <div className="text-sm text-destructive">{err}</div>
              ) : null}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
