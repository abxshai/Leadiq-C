import Papa from "papaparse";
import { rowToLead, INPUT_COLUMNS, type ParsedLead } from "./lead-parser";

// Canonical input field → the camelCase header we emit in the trimmed CSV, so
// the output keeps the historical Sales-Nav header names no matter which PB
// export schema the raw rows came from. Parallel to INPUT_COLUMNS.
const OUTPUT_HEADER: Record<keyof ParsedLead, string> = {
  default_profile_url: "defaultProfileUrl",
  full_name: "fullName",
  first_name: "firstName",
  last_name: "lastName",
  company_name: "companyName",
  title: "title",
  summary: "summary",
  title_description: "titleDescription",
  location: "location",
};
const OUTPUT_COLS = INPUT_COLUMNS.map((k) => OUTPUT_HEADER[k]);

const PB_API = "https://api.phantombuster.com/api/v2";

type PbContainer = {
  id: string;
  status?: string;
  exitCode?: number | null;
  launchedAt?: number;
  endedAt?: number;
  finishedAt?: number;
};

type PbRow = Record<string, string | undefined>;

export type PbAgent = {
  id: string;
  name: string;
  script: string;
};

/** List all agents on the connected PB account. */
export async function listPbAgents(pbApiKey: string): Promise<PbAgent[]> {
  const raw = await pb<unknown>(`/agents/fetch-all`, pbApiKey);
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => {
    const r = a as { id?: string | number; name?: string; script?: string };
    return {
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      script: String(r.script ?? ""),
    };
  }).filter((a) => a.id);
}

export type FetchResult = {
  containerId: string;
  launchedAtMs: number;
  finishedAtMs: number;
  agentName: string | null;
  exitCode: number | null;
  rowCount: number;
  csv: string;
  rawCsvUrl: string;
  note?: string;
};

async function pb<T>(path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PB_API}${path}`, {
    ...init,
    headers: {
      "X-Phantombuster-Key-1": apiKey,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
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
    const scrubbed = body.split(apiKey).join("<pb-key>");
    throw new Error(`PB ${init.method || "GET"} ${path} → ${res.status}: ${scrubbed}`);
  }
  return data as T;
}

function extractCsvUrlFromLog(log: string): string | null {
  const m = log.match(/CSV saved at\s+(https?:\/\/\S+\.csv)/i);
  return m ? m[1] : null;
}

function trim(rawCsv: string, launchedAtMs: number): { csv: string; rowCount: number } {
  const cutoff = new Date(launchedAtMs).toISOString();
  const { data, meta } = Papa.parse<PbRow>(rawCsv, {
    header: true,
    skipEmptyLines: true,
  });
  // Run-isolation filter: drop rows older than this container's launch so
  // accumulated rows on a shared agent's S3 file don't leak in. PB's Sales Nav
  // export stamps each row with `timestamp`; the LinkedIn Profile Scraper uses
  // `refreshedAt`. Only filter when such a column actually exists — otherwise
  // keep every row rather than silently dropping the whole scrape.
  const fields = meta.fields ?? [];
  const tsKey = fields.includes("timestamp")
    ? "timestamp"
    : fields.includes("refreshedAt")
      ? "refreshedAt"
      : null;
  const filtered = tsKey
    ? data.filter((r) => {
        const v = r[tsKey];
        return v != null && v >= cutoff;
      })
    : data;
  // Map each raw row to the canonical 9 input fields via the shared parser
  // mapper (handles both PB export schemas, synthesizes full_name, etc.), drop
  // rows with neither URL nor name, then emit under the camelCase headers.
  const projected = filtered
    .map((r) => rowToLead(r))
    .filter((l) => l.default_profile_url || l.full_name)
    .map((l) => {
      const out: Record<string, string> = {};
      for (const k of INPUT_COLUMNS) out[OUTPUT_HEADER[k]] = l[k] ?? "";
      return out;
    });
  const csv = Papa.unparse(projected, { columns: OUTPUT_COLS });
  return { csv, rowCount: projected.length };
}

/** Find the most recent finished container for an agent. */
async function latestFinishedContainer(
  apiKey: string,
  agentId: string
): Promise<PbContainer | null> {
  const resp = await pb<{ containers?: PbContainer[] }>(
    `/containers/fetch-all?agentId=${agentId}`,
    apiKey
  );
  const containers = resp.containers ?? [];
  const finished = containers.filter((c) => c.status === "finished");
  if (!finished.length) return null;
  // Assume ordered newest-first (matches observed PB behaviour); fall back to
  // explicit sort by any available timestamp field.
  return finished[0];
}

async function resolveCsvUrl(
  apiKey: string,
  agentId: string,
  container: PbContainer
): Promise<string | null> {
  // 1) scan phantom log — most reliable
  const logResp = await pb<{ output?: string | null }>(
    `/containers/fetch-output?id=${container.id}`,
    apiKey
  );
  const log = typeof logResp.output === "string" ? logResp.output : "";
  const fromLog = extractCsvUrlFromLog(log);
  if (fromLog) return fromLog;

  // 2) result-object
  const result = await pb<{ resultObject?: string | null }>(
    `/containers/fetch-result-object?id=${container.id}`,
    apiKey
  );
  if (result.resultObject) {
    try {
      const parsed =
        typeof result.resultObject === "string"
          ? JSON.parse(result.resultObject)
          : result.resultObject;
      const url =
        (parsed as { csvURL?: string }).csvURL ||
        (parsed as { csvUrl?: string }).csvUrl ||
        null;
      if (url) return url;
    } catch {
      /* ignore */
    }
  }

  // 3) agent S3 folder fallback
  const agent = await pb<{ orgS3Folder?: string; s3Folder?: string }>(
    `/agents/fetch?id=${agentId}`,
    apiKey
  );
  if (agent.orgS3Folder && agent.s3Folder) {
    return `https://phantombuster.s3.amazonaws.com/${agent.orgS3Folder}/${agent.s3Folder}/result.csv`;
  }
  return null;
}

// Download the resolved result URL. On failure, surface the exact URL (query
// stripped, so a presigned signature never leaks) plus the HTTP status OR the
// underlying network error — so a failure is diagnosable instead of a bare
// "fetch failed" / "HTTP 403". A browser UA avoids the occasional bare-fetch 403.
async function downloadCsv(url: string): Promise<string> {
  let safe = url;
  try {
    const u = new URL(url);
    safe = `${u.origin}${u.pathname}`;
  } catch {
    /* keep url as-is */
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Lead-IQ/1.0)" },
    });
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.cause instanceof Error
          ? err.cause.message
          : err.message
        : String(err);
    throw new Error(`CSV download failed (network) for ${safe}: ${reason}`);
  }

  if (!res.ok) {
    throw new Error(
      `CSV download failed: HTTP ${res.status} for ${safe}. The Phantombuster result file may be private, missing, or renamed — re-run the phantom or check its result-storage settings.`
    );
  }
  return res.text();
}

/**
 * Fetch the result of a Phantombuster run and return a qualification-ready
 * CSV (9 cols, timestamp-filtered to this container's run).
 *
 * Either `containerId` (a specific run) or `agentId` (latest finished run
 * on that agent) must be provided.
 */
export async function fetchPbOutput(opts: {
  pbApiKey: string;
  agentId?: string;
  containerId?: string;
}): Promise<FetchResult> {
  const { pbApiKey, agentId, containerId } = opts;
  if (!containerId && !agentId) {
    throw new Error("provide agentId or containerId");
  }

  let container: PbContainer;
  let resolvedAgentId = agentId ?? null;

  if (containerId) {
    container = await pb<PbContainer>(`/containers/fetch?id=${containerId}`, pbApiKey);
    if (container.status !== "finished") {
      throw new Error(
        `container ${containerId} status=${container.status} — not finished yet`
      );
    }
  } else {
    const latest = await latestFinishedContainer(pbApiKey, agentId!);
    if (!latest) {
      throw new Error(`agent ${agentId} has no finished runs yet`);
    }
    container = latest;
  }

  // If we started from a container, still need the agentId for S3 fallback.
  if (!resolvedAgentId) {
    // Some PB responses include agentId on the container; otherwise we skip
    // the fallback which requires it.
    const withAgent = container as PbContainer & { agentId?: string };
    resolvedAgentId = withAgent.agentId ?? null;
  }

  const csvUrl = await resolveCsvUrl(
    pbApiKey,
    resolvedAgentId ?? "",
    container
  );
  if (!csvUrl) {
    throw new Error(`couldn't resolve result CSV URL for container ${container.id}`);
  }

  const rawCsv = await downloadCsv(csvUrl);

  const launchedAtMs = container.launchedAt ?? 0;
  const finishedAtMs =
    container.endedAt ?? container.finishedAt ?? Date.now();

  // Optional agent-name lookup for nicer UI
  let agentName: string | null = null;
  if (resolvedAgentId) {
    try {
      const a = await pb<{ name?: string }>(`/agents/fetch?id=${resolvedAgentId}`, pbApiKey);
      agentName = a.name ?? null;
    } catch {
      /* non-fatal */
    }
  }

  const trimmed = launchedAtMs > 0 ? trim(rawCsv, launchedAtMs) : trim(rawCsv, 0);

  return {
    containerId: container.id,
    launchedAtMs,
    finishedAtMs,
    agentName,
    exitCode: container.exitCode ?? null,
    rowCount: trimmed.rowCount,
    csv: trimmed.csv,
    rawCsvUrl: csvUrl,
    note:
      container.exitCode != null && container.exitCode !== 0
        ? `Phantom exited ${container.exitCode} — CSV may be partial.`
        : undefined,
  };
}
