import "server-only";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { Tool } from "./types";

// The LeadQuery agent's ONLY write. On explicit user command ("save these"),
// it persists a set of agent-sourced/qualified leads as a NEW pending campaign
// (snapshotting the default prompt template) so the user can run the normal
// qualification worker on them. This is a constrained, purpose-built write —
// not arbitrary SQL — so the read-only execute_sql boundary is preserved.

const MAX_LEADS = 1000;

const leadSchema = z.object({
  full_name: z.string().optional().nullable(),
  default_profile_url: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
});

const schema = z.object({
  name: z.string().min(1).max(200).describe("Name for the new campaign."),
  leads: z
    .array(leadSchema)
    .min(1)
    .max(MAX_LEADS)
    .describe(
      "The leads to save. Each needs at least a full_name or default_profile_url (LinkedIn URL)."
    ),
});

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

export const createCampaignTool: Tool<typeof schema> = {
  name: "create_campaign_from_leads",
  description: [
    "Save a set of leads as a NEW pending campaign so the user can qualify them",
    "with the normal worker. Use ONLY when the user explicitly asks to save/",
    "create a campaign from the current results. Creates the campaign in",
    "'pending' status snapshotting the default prompt template; the user then",
    "clicks Run. Returns the new campaign id.",
  ].join(" "),
  schema,
  async handler({ name, leads }, ctx) {
    if (!ctx.userId) {
      return { ok: false, error: "No authenticated user in context." };
    }

    // Keep leads with a URL or a name; dedupe by URL.
    const seen = new Set<string>();
    const rows = leads
      .map((l) => ({
        default_profile_url: str(l.default_profile_url),
        full_name: str(l.full_name),
        company_name: str(l.company_name),
        title: str(l.title),
        location: str(l.location),
        summary: str(l.summary),
        status: "pending" as const,
      }))
      .filter((l) => l.default_profile_url || l.full_name)
      .filter((l) => {
        if (!l.default_profile_url) return true;
        if (seen.has(l.default_profile_url)) return false;
        seen.add(l.default_profile_url);
        return true;
      });

    if (rows.length === 0) {
      return { ok: false, error: "No valid leads (each needs a name or LinkedIn URL)." };
    }

    const supabase = createServiceSupabase();

    // Snapshot the default prompt template so the campaign is runnable.
    const { data: tpl } = await supabase
      .from("prompt_templates")
      .select("id, system_prompt, version")
      .eq("is_default", true)
      .is("archived_at", null)
      .maybeSingle();
    if (!tpl?.system_prompt) {
      return {
        ok: false,
        error:
          "No default prompt template found — set one under Templates before saving a campaign.",
      };
    }

    const { data: campaign, error: cErr } = await supabase
      .from("campaigns")
      .insert({
        name,
        source_filename: "LeadQuery (Exa)",
        prompt_template_id: tpl.id,
        prompt_template_version: tpl.version,
        system_prompt_snapshot: tpl.system_prompt,
        total_leads: rows.length,
        status: "pending",
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (cErr || !campaign) {
      return { ok: false, error: cErr?.message ?? "Failed to create campaign." };
    }

    const withCampaign = rows.map((r) => ({ ...r, campaign_id: campaign.id }));
    const { error: lErr } = await supabase
      .from("leads")
      .upsert(withCampaign, {
        onConflict: "campaign_id,default_profile_url",
        ignoreDuplicates: true,
      });
    if (lErr) {
      // Roll back the orphan campaign so it isn't left claiming leads it lacks.
      await supabase.from("campaigns").delete().eq("id", campaign.id);
      return { ok: false, error: `Failed to insert leads: ${lErr.message}` };
    }

    return {
      ok: true,
      data: {
        campaign_id: campaign.id,
        lead_count: rows.length,
        url: `/campaigns/${campaign.id}`,
        note: "Created as pending. Open it and click Run to qualify.",
      },
    };
  },
};
