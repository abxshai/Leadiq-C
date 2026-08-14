import { fetchPbOutput } from "@/lib/pb-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { agentId?: string; containerId?: string };

export async function POST(request: Request) {
  const pbApiKey = request.headers.get("x-pb-key")?.trim() || process.env.PHANTOMBUSTER_API_KEY;
  if (!pbApiKey) {
    return Response.json(
      { error: "missing x-pb-key header — connect Phantombuster first" },
      { status: 401 }
    );
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const agentId = body.agentId?.trim();
  const containerId = body.containerId?.trim();
  if (!agentId && !containerId) {
    return Response.json(
      { error: "provide agentId or containerId" },
      { status: 400 }
    );
  }

  try {
    const result = await fetchPbOutput({ pbApiKey, agentId, containerId });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Scrub any accidental key leak; trust fetchPbOutput to have done so, but belt + braces.
    const scrubbed = message.split(pbApiKey).join("<pb-key>");
    return Response.json({ error: scrubbed }, { status: 502 });
  }
}
