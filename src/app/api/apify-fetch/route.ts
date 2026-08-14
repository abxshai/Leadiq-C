import { NextResponse } from "next/server";
import { fetchApifyOutput } from "@/lib/apify-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/apify-fetch
// Header: X-Apify-Token (BYOK)
// Body: { actorId?, runId?, datasetId? } — one is required. Reads an Apify run's
// dataset and returns a qualification-ready CSV (9 input columns).
export async function POST(request: Request) {
  const token = request.headers.get("x-apify-token")?.trim() || process.env.APIFY_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Missing X-Apify-Token header." },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    actorId?: string;
    runId?: string;
    datasetId?: string;
  } | null;

  const actorId = body?.actorId?.trim() || undefined;
  const runId = body?.runId?.trim() || undefined;
  const datasetId = body?.datasetId?.trim() || undefined;
  if (!actorId && !runId && !datasetId) {
    return NextResponse.json(
      { error: "Provide an actor ID, run ID, or dataset ID." },
      { status: 400 }
    );
  }

  try {
    const result = await fetchApifyOutput({
      apifyToken: token,
      actorId,
      runId,
      datasetId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: msg.split(token).join("<apify-token>") },
      { status: 502 }
    );
  }
}
