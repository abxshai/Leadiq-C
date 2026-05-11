/**
 * Runs once when the Next.js server process boots. Used to clean up zombie
 * campaigns left behind by an interrupted previous instance: the worker
 * runs in-process (DOCS §8 known limitation), so a Railway redeploy or
 * crash mid-run leaves `campaigns.status = 'running'` and any in-flight
 * `leads.status = 'running'` without a worker behind them.
 *
 * Resetting state on boot lets the user click Resume in the UI without
 * needing SQL access to recover.
 *
 * Campaigns flip to `canceled` (a resumable state per the run-route guard)
 * rather than `failed`, since the run didn't fail — it was interrupted
 * before it could finish or fail honestly.
 */
export async function register() {
  // Edge-runtime invocations would not have access to the service-role
  // client anyway; gate strictly on Node runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Build-time invocation has no database to talk to.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // If the service-role key isn't wired (local dev without .env.local), skip
  // silently rather than crashing the boot.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const { createServiceSupabase } = await import("./lib/supabase/service");
    const supabase = createServiceSupabase();

    const { data: resetLeads, error: lErr } = await supabase
      .from("leads")
      .update({ status: "pending" })
      .eq("status", "running")
      .select("id");

    if (lErr) {
      console.error("[instrumentation] zombie-lead reset failed:", lErr.message);
    } else if (resetLeads && resetLeads.length > 0) {
      console.log(
        `[instrumentation] reset ${resetLeads.length} zombie lead(s) from running → pending`
      );
    }

    const { data: resetCampaigns, error: cErr } = await supabase
      .from("campaigns")
      .update({ status: "canceled" })
      .eq("status", "running")
      .select("id");

    if (cErr) {
      console.error(
        "[instrumentation] zombie-campaign reset failed:",
        cErr.message
      );
    } else if (resetCampaigns && resetCampaigns.length > 0) {
      console.log(
        `[instrumentation] reset ${resetCampaigns.length} zombie campaign(s) from running → canceled`
      );
    }
  } catch (err) {
    // Never let instrumentation crash the boot — log and move on.
    console.error("[instrumentation] register() threw:", err);
  }
}
