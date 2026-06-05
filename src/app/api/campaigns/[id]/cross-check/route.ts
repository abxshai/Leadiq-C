import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";

// POST /api/campaigns/:id/cross-check
//
// Re-runs the Smartlead/HubSpot temperature cross-check (M-CX1) for every
// qualified lead in the campaign. Idempotent — the classifier reclassifies
// from scratch, so this is safe to call repeatedly (historical campaigns, a
// CRM resync, or after the temperature rules are tuned).
//
// No BYOK key: the cross-check is a pure local JOIN against the `crm` schema
// inside this same Supabase project, so there's nothing to forward.
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  // AuthN: only signed-in users can trigger a cross-check.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Run the classifier with the service role so it can read `crm` + write
  // `leads` regardless of RLS.
  const service = createServiceSupabase();
  const { data, error } = await service.rpc("classify_campaign_temperature", {
    p_campaign_id: id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ classified: data ?? 0 });
}
