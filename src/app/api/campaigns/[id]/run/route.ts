import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { startCampaignRun } from "@/lib/worker";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  // BYOK header wins; falls back to a server-held key (env).
  const apiKey = request.headers.get("x-groq-key")?.trim() || process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing X-Groq-Key header." },
      { status: 400 }
    );
  }
  if (!apiKey.startsWith("gsk_")) {
    return NextResponse.json(
      { error: "That doesn't look like a Groq key (expected gsk_…)." },
      { status: 400 }
    );
  }

  // AuthN: only signed-in users can trigger runs.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Confirm the campaign exists and is in a runnable state.
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("id, status, total_leads")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (!["pending", "failed", "canceled"].includes(campaign.status)) {
    return NextResponse.json(
      { error: `Campaign is ${campaign.status}.` },
      { status: 409 }
    );
  }
  if (campaign.total_leads === 0) {
    return NextResponse.json(
      { error: "Campaign has no leads to process." },
      { status: 400 }
    );
  }

  // Fire-and-forget. The worker holds the key in-process only; this route
  // returns immediately and the client polls /campaigns/[id] for progress.
  const result = await startCampaignRun({ campaignId: id, apiKey });

  return NextResponse.json(result, {
    status: result.started ? 202 : 409,
  });
}
