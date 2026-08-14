import Papa from "papaparse";

// Fetch the output of an Apify actor run and return a qualification-ready CSV,
// projected to the same 9 input columns the PB pipeline feeds the qualifier.
// Cookie-free alternative to Phantombuster: the user runs the actor in Apify
// (default: harvestapi/linkedin-profile-scraper), we read its dataset and narrow
// the rich nested records down to our flat input shape. No email column — email
// enrichment isn't part of this path.

const APIFY_API = "https://api.apify.com/v2";

// Emitted CSV headers (camelCase) — recognized by lead-parser's ALIAS_GROUPS,
// so the produced CSV flows through the normal upload/parse path unchanged.
const OUTPUT_COLS = [
  "defaultProfileUrl",
  "fullName",
  "firstName",
  "lastName",
  "companyName",
  "title",
  "summary",
  "titleDescription",
  "location",
] as const;

export type ApifyFetchResult = {
  source: string; // human label of what we read (last run / run id / dataset id)
  datasetItemCount: number; // raw items in the dataset
  rowCount: number; // rows after projection + dedupe
  csv: string;
};

async function apify<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${APIFY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const body = typeof data === "string" ? data : JSON.stringify(data);
    const scrubbed = body.split(token).join("<apify-token>");
    throw new Error(`Apify ${init.method || "GET"} ${path} → ${res.status}: ${scrubbed}`);
  }
  // Apify wraps most resource responses in { data: ... }; dataset items come
  // back as a bare array.
  if (Array.isArray(data)) return data as T;
  const wrapped = data as { data?: T };
  return (wrapped.data ?? data) as T;
}

/** Validate a token by reading the current user. Returns username on success. */
export async function apifyWhoami(token: string): Promise<string | null> {
  const me = await apify<{ username?: string }>("/users/me", token);
  return me.username ?? null;
}

// Default search actor: harvestapi LinkedIn Profile Search (No Cookies) — takes
// structured filters + a query and paginates, so it pulls ~1000 without the
// session-stalling that PB's search export hits.
export const DEFAULT_SEARCH_ACTOR = "harvestapi~linkedin-profile-search";

/** Start an actor run (async). Returns the run id + initial status. */
export async function startApifyRun(
  token: string,
  actorId: string,
  input: Record<string, unknown>
): Promise<{ runId: string; status: string }> {
  const run = await apify<{ id?: string; status?: string }>(
    `/acts/${encodeURIComponent(actorId)}/runs`,
    token,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!run.id) throw new Error("Apify did not return a run id.");
  return { runId: run.id, status: run.status ?? "RUNNING" };
}

/** Poll an actor run's status. */
export async function getApifyRunStatus(
  token: string,
  runId: string
): Promise<{ status: string; itemCount: number | null }> {
  const run = await apify<{
    status?: string;
    stats?: { itemCount?: number };
    defaultDatasetId?: string;
  }>(`/actor-runs/${runId}`, token);
  return {
    status: run.status ?? "UNKNOWN",
    itemCount: run.stats?.itemCount ?? null,
  };
}

// ---- output mapping -------------------------------------------------------

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

type Item = Record<string, unknown>;

function firstOf(arr: unknown): Item | null {
  return Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "object"
    ? (arr[0] as Item)
    : null;
}

function locationString(loc: unknown): string {
  if (typeof loc === "string") return loc.trim();
  if (loc && typeof loc === "object") {
    const o = loc as Item;
    return [o.city, o.state, o.country]
      .map(str)
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

// Map one harvestapi profile record → the flat 9-column row.
function mapItem(item: Item): Record<string, string> {
  const current = firstOf(item.currentPosition);
  const exp = firstOf(item.experience);

  const firstName = str(item.firstName);
  const lastName = str(item.lastName);
  const publicId = str(item.publicIdentifier);
  const url =
    str(item.linkedinUrl) ||
    str(item.url) ||
    (publicId ? `https://www.linkedin.com/in/${publicId}` : "");

  return {
    defaultProfileUrl: url,
    fullName: [firstName, lastName].filter(Boolean).join(" "),
    firstName,
    lastName,
    companyName: str(current?.companyName) || str(exp?.companyName),
    // The person's job title: prefer the structured current/experience position
    // over the free-text headline.
    title:
      str(current?.position) ||
      str(exp?.position) ||
      str(item.headline),
    summary: str(item.about) || str(item.summary),
    titleDescription: str(exp?.description),
    location: locationString(item.location),
  };
}

// ---- dataset resolution ---------------------------------------------------

async function datasetItems(
  token: string,
  datasetId: string
): Promise<Item[]> {
  const items = await apify<unknown>(
    `/datasets/${datasetId}/items?clean=true&format=json`,
    token
  );
  return Array.isArray(items) ? (items as Item[]) : [];
}

/**
 * Read an Apify run's output and project it to the qualification CSV.
 *
 * Resolution precedence: explicit datasetId → explicit runId's default dataset
 * → the actor's most recent SUCCEEDED run. Mirrors the PB "latest finished
 * container" default with an optional explicit override.
 */
export async function fetchApifyOutput(opts: {
  apifyToken: string;
  actorId?: string;
  runId?: string;
  datasetId?: string;
}): Promise<ApifyFetchResult> {
  const { apifyToken, actorId, runId, datasetId } = opts;

  let items: Item[];
  let source: string;

  if (datasetId) {
    items = await datasetItems(apifyToken, datasetId);
    source = `dataset ${datasetId}`;
  } else if (runId) {
    const run = await apify<{ defaultDatasetId?: string; status?: string }>(
      `/actor-runs/${runId}`,
      apifyToken
    );
    if (!run.defaultDatasetId) {
      throw new Error(`run ${runId} has no dataset yet (status=${run.status})`);
    }
    items = await datasetItems(apifyToken, run.defaultDatasetId);
    source = `run ${runId}`;
  } else if (actorId) {
    // Last successful run's items in one call.
    const raw = await apify<unknown>(
      `/acts/${actorId}/runs/last/dataset/items?status=SUCCEEDED&clean=true&format=json`,
      apifyToken
    );
    items = Array.isArray(raw) ? (raw as Item[]) : [];
    source = `${actorId} · last successful run`;
  } else {
    throw new Error("provide actorId, runId, or datasetId");
  }

  // Project → dedupe by profile URL (rows with neither URL nor name are
  // dropped; null-URL rows are kept distinct, matching lead-parser).
  const seen = new Set<string>();
  const rows: Record<string, string>[] = [];
  for (const item of items) {
    const row = mapItem(item);
    if (!row.defaultProfileUrl && !row.fullName) continue;
    if (row.defaultProfileUrl) {
      if (seen.has(row.defaultProfileUrl)) continue;
      seen.add(row.defaultProfileUrl);
    }
    rows.push(row);
  }

  const csv = Papa.unparse({
    fields: [...OUTPUT_COLS],
    data: rows.map((r) => OUTPUT_COLS.map((c) => r[c] ?? "")),
  });

  return {
    source,
    datasetItemCount: items.length,
    rowCount: rows.length,
    csv,
  };
}
