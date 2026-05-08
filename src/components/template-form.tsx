"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createTemplate,
  updateTemplate,
  type TemplateInput,
} from "@/app/(app)/templates/actions";

type Initial = {
  id?: string;
  name?: string;
  description?: string | null;
  system_prompt?: string;
  is_default?: boolean;
};

// Server-action redirects throw an internal error with this digest prefix.
// We need to re-raise it so Next.js can handle the navigation.
function isRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export function TemplateForm({ initial }: { initial?: Initial }) {
  const editing = Boolean(initial?.id);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const input: TemplateInput = {
      name,
      description: description.trim() || null,
      system_prompt: systemPrompt,
      is_default: isDefault,
    };
    startTransition(async () => {
      try {
        if (editing && initial?.id) {
          await updateTemplate(initial.id, input);
        } else {
          await createTemplate(input);
        }
      } catch (err) {
        if (isRedirect(err)) throw err;
        setError(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Robotics / Manufacturing AI"
          required
          maxLength={80}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">
          Description{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short note about when to use this template."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="system_prompt">System prompt</Label>
        <Textarea
          id="system_prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="You are a senior B2B sales analyst …"
          required
          minLength={10}
          rows={18}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Editing this bumps the version. Past campaigns keep their snapshot
          — historical results never change.
        </p>
      </div>

      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-4 w-4 rounded border-border bg-background text-primary accent-primary"
        />
        <span>Set as default template</span>
        <span className="text-muted-foreground text-xs">
          (the wizard pre-selects the default; only one allowed)
        </span>
      </label>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {editing ? "Save changes" : "Create template"}
            </>
          )}
        </Button>
        <Link
          href="/templates"
          className={cn(
            buttonVariants({ variant: "ghost" }),
            "gap-2 text-muted-foreground"
          )}
        >
          <ArrowLeft className="h-4 w-4" />
          Cancel
        </Link>
      </div>
    </form>
  );
}
