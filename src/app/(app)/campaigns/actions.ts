"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ParsedLead } from "@/lib/lead-parser";

export type CreateCampaignInput = {
  name: string;
  source_filename: string | null;
  prompt_template_id: string | null;
  system_prompt_override: string | null;
  concurrency: number;
  delay_ms: number;
  google_sheet_id: string | null;
  leads: ParsedLead[];
};

export async function createCampaign(input: CreateCampaignInput) {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Resolve system prompt snapshot: ad-hoc override wins; else fetch template.
  let systemPromptSnapshot = input.system_prompt_override?.trim() ?? "";
  let templateVersion: number | null = null;

  if (!systemPromptSnapshot && input.prompt_template_id) {
    const { data: tpl, error } = await supabase
      .from("prompt_templates")
      .select("system_prompt, version")
      .eq("id", input.prompt_template_id)
      .single();
    if (error || !tpl) throw new Error("Could not load prompt template.");
    systemPromptSnapshot = tpl.system_prompt;
    templateVersion = tpl.version;
  }

  if (!systemPromptSnapshot) {
    throw new Error("Pick a template or write an ad-hoc prompt.");
  }

  if (input.leads.length === 0) {
    throw new Error("No leads found in the uploaded file.");
  }

  const { data: campaign, error: campaignErr } = await supabase
    .from("campaigns")
    .insert({
      name: input.name,
      source_filename: input.source_filename,
      prompt_template_id: input.prompt_template_id,
      prompt_template_version: templateVersion,
      system_prompt_snapshot: systemPromptSnapshot,
      concurrency: input.concurrency,
      delay_ms: Math.max(0, Math.min(60000, input.delay_ms)),
      google_sheet_id: input.google_sheet_id,
      total_leads: input.leads.length,
      status: "pending",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (campaignErr || !campaign) {
    throw new Error(campaignErr?.message ?? "Failed to create campaign.");
  }

  // Bulk insert leads in chunks to stay under payload size limits.
  // Use upsert + ignoreDuplicates as defense-in-depth: lead-parser already
  // dedupes by default_profile_url, but if a duplicate ever sneaks past
  // (e.g. via a future ingest path), the unique constraint
  // `(campaign_id, default_profile_url)` would atomically roll back the
  // entire chunk and abort the import partway through. ignoreDuplicates
  // makes that a silent skip instead of a hard fail.
  //
  // If any chunk fails mid-import the campaign row already exists but its
  // total_leads claim doesn't match reality — an orphaned shell. Roll back
  // by deleting the campaign before re-throwing so the user retries
  // cleanly instead of being left with a corrupted row that the worker
  // would later auto-mark as "completed" against zero leads (FK cascade
  // on the leads table sweeps any partial inserts).
  const chunkSize = 500;
  try {
    for (let i = 0; i < input.leads.length; i += chunkSize) {
      const chunk = input.leads.slice(i, i + chunkSize).map((l) => ({
        ...l,
        campaign_id: campaign.id,
        status: "pending" as const,
      }));
      const { error } = await supabase
        .from("leads")
        .upsert(chunk, {
          onConflict: "campaign_id,default_profile_url",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(`Failed to insert leads: ${error.message}`);
    }
  } catch (err) {
    await supabase.from("campaigns").delete().eq("id", campaign.id);
    throw err;
  }

  redirect(`/campaigns/${campaign.id}`);
}

export async function deleteCampaign(
  id: string,
  opts?: { redirectTo?: string }
) {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Leads cascade-delete via the campaign_id FK.
  const { error } = await supabase.from("campaigns").delete().eq("id", id);
  if (error) throw new Error(error.message);

  // The deleted campaign's leads must drop out of the /leads deduped snapshot
  // (public.distinct_leads materialized view, migration 0017) — otherwise they
  // linger until the next refresh. Awaited (not soft) so /leads is correct on
  // the redirect; the FK cascade already removed the underlying rows.
  const { error: refreshErr } = await supabase.rpc("refresh_distinct_leads");
  if (refreshErr) {
    console.error("[deleteCampaign] refresh_distinct_leads failed:", refreshErr.message);
  }

  revalidatePath("/campaigns");
  revalidatePath("/leads");
  if (opts?.redirectTo) redirect(opts.redirectTo);
}
