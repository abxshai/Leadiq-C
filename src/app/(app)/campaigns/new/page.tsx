import { PageHeader } from "@/components/page-header";
import { RunWizard } from "@/components/run-wizard";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function NewCampaignPage() {
  const supabase = await createServerSupabase();
  const { data: templates } = await supabase
    .from("prompt_templates")
    .select("id, name, slug, is_default")
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("name");

  return (
    <div>
      <PageHeader
        title="New campaign"
        description="Upload a lead list, pick a prompt template, and stage a run. You'll start the actual Groq execution on the next screen once your key is connected."
      />
      <RunWizard templates={templates ?? []} />
    </div>
  );
}
