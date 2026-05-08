import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { TemplateForm } from "@/components/template-form";
import { TemplateVersions } from "@/components/template-versions";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [{ data: tpl }, { data: versions }] = await Promise.all([
    supabase
      .from("prompt_templates")
      .select(
        "id, name, slug, description, system_prompt, is_default, version, archived_at"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("prompt_template_versions")
      .select("version, name, system_prompt, saved_by, saved_at")
      .eq("template_id", id)
      .order("version", { ascending: false }),
  ]);

  if (!tpl) notFound();

  const versionRows = (versions ?? []).map((v) => ({
    version: v.version,
    name: v.name,
    saved_at: v.saved_at,
    saved_by: v.saved_by,
    preview: (v.system_prompt ?? "").slice(0, 240).replace(/\s+/g, " "),
  }));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <PageHeader
          title={tpl.name}
          description={`v${tpl.version} · ${tpl.slug}${tpl.archived_at ? " · archived" : ""}`}
        />
        <TemplateForm
          initial={{
            id: tpl.id,
            name: tpl.name,
            description: tpl.description,
            system_prompt: tpl.system_prompt,
            is_default: tpl.is_default,
          }}
        />
      </div>

      <Card className="bg-card/40 h-fit">
        <CardContent className="p-4">
          <TemplateVersions
            templateId={tpl.id}
            versions={versionRows}
            currentVersion={tpl.version}
          />
        </CardContent>
      </Card>
    </div>
  );
}
