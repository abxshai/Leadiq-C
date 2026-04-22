import Papa from "papaparse";

// Qualification input columns, matching src/lib/lead-parser.ts aliases.
const QUAL_COLS = [
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
  const { data } = Papa.parse<PbRow>(rawCsv, { header: true, skipEmptyLines: true });
  const filtered = data.filter((r) => r.timestamp && r.timestamp >= cutoff);
  const projected = filtered.map((r) => {
    const out: Record<string, string> = {};
    for (const c of QUAL_COLS) out[c] = r[c] ?? "";
    return out;
  });
  const csv = Papa.unparse(projected, { columns: [...QUAL_COLS] });
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

  const csvRes = await fetch(csvUrl);
  if (!csvRes.ok) {
    throw new Error(`CSV download failed: HTTP ${csvRes.status}`);
  }
  const rawCsv = await csvRes.text();

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
