import { NextResponse } from "next/server";
import {
  startApifyRun,
  getApifyRunStatus,
  DEFAULT_SEARCH_ACTOR,
} from "@/lib/apify-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/apify-search  { searchQuery?, currentJobTitles?[], locations?[],
//   currentCompanies?[], maxItems?, mode? }  → starts a harvestapi profile-search
//   run and returns { runId }.
// GET  /api/apify-search?runId=…  → { status, done, failed, itemCount }.
// Header: X-Apify-Token (BYOK; falls back to APIFY_API_TOKEN env on the clone).

function token(request: Request): string | undefined {
  return (
    request.headers.get("x-apify-token")?.trim() || process.env.APIFY_API_TOKEN
  );
}

const arr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean).slice(0, 50)
    : [];

export async function POST(request: Request) {
  const t = token(request);
  if (!t) return NextResponse.json({ error: "Missing Apify token." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as {
    searchQuery?: string;
    currentJobTitles?: unknown;
    locations?: unknown;
    currentCompanies?: unknown;
    maxItems?: number;
    mode?: string;
    actorId?: string;
  } | null;

  const searchQuery = body?.searchQuery?.trim() || "";
  const currentJobTitles = arr(body?.currentJobTitles);
  const locations = arr(body?.locations);
  const currentCompanies = arr(body?.currentCompanies);
  if (!searchQuery && !currentJobTitles.length && !currentCompanies.length) {
    return NextResponse.json(
      { error: "Provide a search query and/or job-title / company filters." },
      { status: 400 }
    );
  }

  const maxItems = Math.max(1, Math.min(Number(body?.maxItems) || 1000, 1000));
  const mode = body?.mode === "Short" ? "Short" : "Full";

  const input: Record<string, unknown> = {
    profileScraperMode: mode,
    maxItems,
    ...(searchQuery ? { searchQuery } : {}),
    ...(currentJobTitles.length ? { currentJobTitles } : {}),
    ...(locations.length ? { locations } : {}),
    ...(currentCompanies.length ? { currentCompanies } : {}),
  };

  try {
    const { runId, status } = await startApifyRun(
      t,
      body?.actorId?.trim() || DEFAULT_SEARCH_ACTOR,
      input
    );
    return NextResponse.json({ runId, status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: msg.split(t).join("<apify-token>") },
      { status: 502 }
    );
  }
}

const DONE = new Set(["SUCCEEDED"]);
const FAILED = new Set(["FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT"]);

export async function GET(request: Request) {
  const t = token(request);
  if (!t) return NextResponse.json({ error: "Missing Apify token." }, { status: 400 });
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "Missing runId." }, { status: 400 });

  try {
    const { status, itemCount } = await getApifyRunStatus(t, runId);
    return NextResponse.json({
      status,
      itemCount,
      done: DONE.has(status),
      failed: FAILED.has(status),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: msg.split(t).join("<apify-token>") },
      { status: 502 }
    );
  }
}
