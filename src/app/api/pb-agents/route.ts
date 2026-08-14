import { listPbAgents } from "@/lib/pb-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const pbApiKey = request.headers.get("x-pb-key")?.trim() || process.env.PHANTOMBUSTER_API_KEY;
  if (!pbApiKey) {
    return Response.json(
      { error: "missing x-pb-key header — connect Phantombuster first" },
      { status: 401 }
    );
  }
  try {
    const agents = await listPbAgents(pbApiKey);
    return Response.json({ agents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const scrubbed = message.split(pbApiKey).join("<pb-key>");
    return Response.json({ error: scrubbed }, { status: 502 });
  }
}
