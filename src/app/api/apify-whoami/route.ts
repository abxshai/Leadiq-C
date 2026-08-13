import { NextResponse } from "next/server";
import { apifyWhoami } from "@/lib/apify-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Validates an Apify token (used by the Connect dialog before storing it).
// Proxied server-side to avoid browser CORS and keep the token off any
// third-party origin. Reads X-Apify-Token; token scrubbed from any error.
export async function GET(request: Request) {
  const token = request.headers.get("x-apify-token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  try {
    const username = await apifyWhoami(token);
    return NextResponse.json({ ok: true, username });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const scrubbed = msg.split(token).join("<apify-token>");
    const status = /→ 401/.test(scrubbed) ? 401 : 502;
    return NextResponse.json(
      { error: status === 401 ? "Token rejected by Apify." : scrubbed },
      { status }
    );
  }
}
