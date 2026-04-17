import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load .env.local the crude way so we don't need a dotenv dep.
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^"|"$/g, "")];
    })
);

const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: campaigns } = await sb
  .from("campaigns")
  .select("id, name, status, total_leads, qualified_count, failed_count, delay_ms, model, created_at")
  .order("created_at", { ascending: false })
  .limit(3);

console.log("RECENT CAMPAIGNS:");
console.table(campaigns);

const lastId = campaigns?.[0]?.id;
if (!lastId) process.exit(0);

const { data: leads } = await sb
  .from("leads")
  .select("full_name, status, error")
  .eq("campaign_id", lastId)
  .order("processed_at", { ascending: true, nullsFirst: false });

console.log(`\nLEADS FOR CAMPAIGN ${lastId}:`);
for (const l of leads ?? []) {
  console.log(`  [${l.status}] ${l.full_name ?? "—"}`);
  if (l.error) console.log(`     error: ${l.error}`);
}
