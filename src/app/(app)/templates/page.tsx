import Link from "next/link";
import { Plus, FileText, Pencil } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { TemplateActionsMenu } from "@/components/template-actions-menu";
import { createServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type TemplateRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  version: number;
  archived_at: string | null;
  updated_at: string;
};

export default async function TemplatesPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("prompt_templates")
    .select("id, name, slug, description, is_default, version, archived_at, updated_at")
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("is_default", { ascending: false })
    .order("name");

  const rows = (data ?? []) as TemplateRow[];
  const active = rows.filter((r) => r.archived_at == null);
  const archived = rows.filter((r) => r.archived_at != null);

  return (
    <div>
      <PageHeader
        title="Prompt templates"
        description="Saved system prompts you can pick when launching a campaign. Editing bumps the version; campaigns snapshot the version at run time so historical results are never rewritten."
        actions={
          <Link
            href="/templates/new"
            className={buttonVariants({ className: "gap-2" })}
          >
            <Plus className="h-4 w-4" />
            New template
          </Link>
        }
      />

      {error ? (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Failed to load templates: {error.message}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card className="border-dashed bg-card/40">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              No templates yet
            </CardTitle>
            <CardDescription>
              Create one to use it from the campaign wizard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/templates/new"
              className={buttonVariants({
                variant: "outline",
                className: "gap-2",
              })}
            >
              <Plus className="h-4 w-4" />
              Create your first template
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <TemplateGrid rows={active} />
          {archived.length > 0 ? (
            <div className="mt-10">
              <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
                Archived
              </div>
              <TemplateGrid rows={archived} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function TemplateGrid({ rows }: { rows: TemplateRow[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map((t) => (
        <Card
          key={t.id}
          className={cn(
            "bg-card/40 transition-colors",
            t.archived_at ? "opacity-70" : "hover:bg-card/60"
          )}
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/25 shrink-0">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">
                    {t.name}
                  </CardTitle>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    v{t.version} · {t.slug}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {t.is_default ? (
                  <Badge
                    variant="outline"
                    className="border-primary/40 bg-primary/10 text-primary"
                  >
                    Default
                  </Badge>
                ) : null}
                {t.archived_at ? (
                  <Badge
                    variant="outline"
                    className="border-muted-foreground/30 text-muted-foreground"
                  >
                    Archived
                  </Badge>
                ) : null}
                <TemplateActionsMenu
                  id={t.id}
                  name={t.name}
                  isDefault={t.is_default}
                  isArchived={t.archived_at != null}
                />
              </div>
            </div>
            {t.description ? (
              <CardDescription className="pt-2 line-clamp-3">
                {t.description}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex gap-2">
            <Link
              href={`/templates/${t.id}`}
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "gap-2",
              })}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
