"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoginHero } from "@/components/login-hero";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrMsg(null);
    const supabase = createBrowserSupabase();
    const next =
      new URLSearchParams(window.location.search).get("next") ?? "/campaigns";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setStatus("error");
      setErrMsg(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-5xl">
        {/* Hero row: title left, ASCII right */}
        <div className="grid gap-10 sm:grid-cols-2 items-center mb-10">
          <div className="space-y-3">
            <h1 className="text-6xl sm:text-7xl font-bold tracking-tight leading-none">
              lead-
              <span className="text-primary">IQ</span>
            </h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              Qualify LinkedIn leads against your ICP with Groq&apos;s
              gpt-oss-120b. Bring your own key.
            </p>
          </div>
          <div className="flex justify-end">
            <div className="rounded-lg border border-primary/20 bg-card/30 backdrop-blur-xl px-4 py-3">
              <LoginHero />
            </div>
          </div>
        </div>

        {/* Form card below */}
        <div className="max-w-md">
          <div className="rounded-xl border border-border bg-card/60 p-8 backdrop-blur-xl">
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;ll email you a magic link — no passwords.
            </p>

            {status === "sent" ? (
              <div className="mt-6 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
                Check <span className="font-medium">{email}</span> for a
                sign-in link.
              </div>
            ) : (
              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@deccan.ai"
                    autoComplete="email"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={status === "sending"}
                >
                  {status === "sending" ? "Sending…" : "Send magic link"}
                </Button>
                {errMsg ? (
                  <div className="text-sm text-destructive">{errMsg}</div>
                ) : null}
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
