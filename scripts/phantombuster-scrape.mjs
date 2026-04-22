// Phase 0 proof-of-chain for Phantombuster Sales Nav Search Export.
// Usage:
//   node --env-file=.env.local scripts/phantombuster-scrape.mjs "<sales-nav-url>"
//
// Reads PHANTOMBUSTER_API_KEY, PHANTOMBUSTER_AGENT_ID, LI_AT_COOKIE,
// optional LI_USER_AGENT from env. Prints status, downloads CSV to /tmp.
// Never logs the cookie or API key.

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const Papa = createRequire(import.meta.url)("papaparse");

const PB_KEY = process.env.PHANTOMBUSTER_API_KEY;
const AGENT_ID = process.env.PHANTOMBUSTER_AGENT_ID;
const COOKIE = process.env.LI_AT_COOKIE;
const USER_AGENT =
  process.env.LI_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Support two modes:
//   node scripts/phantombuster-scrape.mjs "<sales-nav-url>"   -> launch a new scrape
//   node scripts/phantombuster-scrape.mjs --attach <id>       -> poll + download an existing container
const ATTACH_IDX = process.argv.indexOf("--attach");
const ATTACH_CONTAINER = ATTACH_IDX >= 0 ? process.argv[ATTACH_IDX + 1] : null;
const SEARCH_URL = !ATTACH_CONTAINER ? process.argv[2] : null;

if (!PB_KEY || !AGENT_ID || !COOKIE || (!SEARCH_URL && !ATTACH_CONTAINER)) {
  console.error(
    "usage:\n" +
      "  node --env-file=.env.local scripts/phantombuster-scrape.mjs \"<sales-nav-url>\"\n" +
      "  node --env-file=.env.local scripts/phantombuster-scrape.mjs --attach <containerId>\n" +
      "requires env: PHANTOMBUSTER_API_KEY, PHANTOMBUSTER_AGENT_ID, LI_AT_COOKIE"
  );
  process.exit(1);
}

const API = "https://api.phantombuster.com/api/v2";
const baseHeaders = {
  "X-Phantombuster-Key-1": PB_KEY,
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Scrub known secrets from any string we log (defence in depth).
const scrub = (s) => {
  if (!s) return s;
  let out = String(s);
  if (COOKIE) out = out.split(COOKIE).join("<cookie>");
  if (PB_KEY) out = out.split(PB_KEY).join("<pb-key>");
  return out;
};

async function pb(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...baseHeaders, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const body = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${init.method || "GET"} ${path} → ${res.status}: ${scrub(body)}`);
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let containerId;
if (ATTACH_CONTAINER) {
  containerId = ATTACH_CONTAINER;
  console.log(`[attach] polling existing container=${containerId}`);
} else {
  // 1. fetch current agent to preserve identityId + config we don't want to clobber
  console.log(`[fetch] reading agent ${AGENT_ID}…`);
  const agentNow = await pb(`/agents/fetch?id=${AGENT_ID}`);
  const currentArg = agentNow.argument ? JSON.parse(agentNow.argument) : {};
  const existingIdentity = (currentArg.identities && currentArg.identities[0]) || {};

  // 2. overwrite search URL + identity's cookie/UA, keep everything else
  console.log(`[save] configuring agent ${AGENT_ID}…`);
  const nextArg = {
    ...currentArg,
    inputType: "salesNavigatorSearchUrl",
    salesNavigatorSearchUrl: SEARCH_URL,
    numberOfLinesPerLaunch: currentArg.numberOfLinesPerLaunch ?? 10,
    numberOfResultsPerSearch: currentArg.numberOfResultsPerSearch ?? 100,
    numberOfProfiles: currentArg.numberOfProfiles ?? 100,
    removeDuplicateProfiles: currentArg.removeDuplicateProfiles ?? false,
    identities: [
      {
        ...existingIdentity,
        sessionCookie: COOKIE,
        userAgent: USER_AGENT,
      },
    ],
  };
  await pb("/agents/save", {
    method: "POST",
    body: JSON.stringify({ id: AGENT_ID, argument: JSON.stringify(nextArg) }),
  });

  // 3. launch
  console.log("[launch] starting scrape…");
  const launch = await pb("/agents/launch", {
    method: "POST",
    body: JSON.stringify({ id: AGENT_ID }),
  });
  containerId = launch.containerId;
  if (!containerId) throw new Error(`no containerId in launch response: ${JSON.stringify(launch)}`);
  console.log(`[launch] container=${containerId}`);
}

// 4. poll container status via /containers/fetch; scan output log for cookie-expired
const MAX_MS = 20 * 60 * 1000;
const startedAt = Date.now();
let lastKey = "";
let terminalContainer = null;
while (Date.now() - startedAt < MAX_MS) {
  const container = await pb(`/containers/fetch?id=${containerId}`);
  const status = container.status ?? "unknown";
  const exitCode = container.exitCode ?? null;
  const key = `${status}:${exitCode}`;
  if (key !== lastKey) {
    console.log(`[poll] status=${status}${exitCode != null ? ` exit=${exitCode}` : ""}`);
    lastKey = key;
  }
  if (status !== "running") {
    terminalContainer = container;
    break;
  }
  // Cookie expiry: peek at log tail
  const logResp = await pb(`/containers/fetch-output?id=${containerId}`);
  const logTail = typeof logResp.output === "string" ? logResp.output : "";
  if (/session cookie.*(invalid|expired)/i.test(logTail)) {
    console.error("[expired] LinkedIn cookie invalid — refresh it and retry.");
    process.exit(2);
  }
  await sleep(5000);
}
if (!terminalContainer) {
  console.error("[timeout] scrape exceeded 20min, giving up (container may still be running on PB)");
  process.exit(3);
}

const terminalStatus = terminalContainer.status ?? "unknown";
const terminalExit = terminalContainer.exitCode ?? null;
console.log(`[done] terminal status=${terminalStatus} exit=${terminalExit}`);

// 4. pull the result object (gives us the csvURL without assembling S3 paths manually)
const result = await pb(`/containers/fetch-result-object?id=${containerId}`);
let csvUrl = null;
const raw = result.resultObject ?? result.output ?? null;
if (raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    csvUrl = parsed.csvURL || parsed.csvUrl || parsed.resultUrl || null;
  } catch {
    /* raw wasn't JSON */
  }
}

// Fallback: build S3 URL from agent metadata
if (!csvUrl) {
  console.log("[fallback] result-object had no csvURL, trying /agents/fetch…");
  const agent = await pb(`/agents/fetch?id=${AGENT_ID}`);
  if (agent.orgS3Folder && agent.s3Folder) {
    csvUrl = `https://phantombuster.s3.amazonaws.com/${agent.orgS3Folder}/${agent.s3Folder}/result.csv`;
  }
}

if (!csvUrl) {
  console.error("[fail] could not locate result CSV URL. Full result-object response:");
  console.error(JSON.stringify(result, null, 2));
  process.exit(4);
}

console.log(`[download] ${csvUrl}`);
const csvRes = await fetch(csvUrl);
if (!csvRes.ok) throw new Error(`CSV download failed: ${csvRes.status}`);
const csv = await csvRes.text();
const rawPath = `/tmp/phantombuster-${containerId}.csv`;
await writeFile(rawPath, csv);

// 5. trim: keep only qualification-input columns, filter to rows from this container's run
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
];
const launchedAtIso = terminalContainer.launchedAt
  ? new Date(terminalContainer.launchedAt).toISOString()
  : null;

const { data: rows } = Papa.parse(csv, { header: true, skipEmptyLines: true });
const filtered = launchedAtIso
  ? rows.filter((r) => r.timestamp && r.timestamp >= launchedAtIso)
  : rows;
const trimmed = filtered.map((r) => {
  const out = {};
  for (const c of QUAL_COLS) out[c] = r[c] ?? "";
  return out;
});
const trimmedCsv = Papa.unparse(trimmed, { columns: QUAL_COLS });
const trimmedPath = `/tmp/phantombuster-${containerId}.trimmed.csv`;
await writeFile(trimmedPath, trimmedCsv);

console.log(
  `[done] raw=${rows.length} rows → ${rawPath}\n       trimmed=${trimmed.length} rows (${QUAL_COLS.length} cols) → ${trimmedPath}`
);
