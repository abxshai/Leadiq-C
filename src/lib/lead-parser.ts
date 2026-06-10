import Papa from "papaparse";

export type ParsedLead = {
  default_profile_url: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  title: string | null;
  summary: string | null;
  title_description: string | null;
  location: string | null;
};

export type ParseResult = {
  leads: ParsedLead[];
  detectedColumns: string[];
  missingColumns: (keyof ParsedLead)[];
  duplicatesSkipped: number;
};

export const INPUT_COLUMNS: (keyof ParsedLead)[] = [
  "default_profile_url",
  "full_name",
  "first_name",
  "last_name",
  "company_name",
  "title",
  "summary",
  "title_description",
  "location",
];

// Canonical column → every header that maps to it, across BOTH Phantombuster
// export schemas we ingest. This table is the single source of truth for the
// old↔new column correspondence:
//
//   OLD = Sales Nav Search Export   (the historical 9-column input set)
//   NEW = LinkedIn Profile Scraper  (the result.csv shape, 53 columns)
//
// | Canonical           | OLD header        | NEW header(s)                      |
// |---------------------|-------------------|------------------------------------|
// | default_profile_url | defaultProfileUrl | profileUrl, linkedinProfileUrl     |
// | full_name           | fullName          | — (synthesized from first + last)  |
// | first_name          | firstName         | firstName                          |
// | last_name           | lastName          | lastName                           |
// | company_name        | companyName       | companyName                        |
// | title               | title             | linkedinJobTitle                   |
// | summary             | summary           | linkedinHeadline (closest proxy*)  |
// | title_description   | titleDescription  | linkedinJobDescription             |
// | location            | location          | location                           |
//
// * The profile-scraper export has no person "About" field; linkedinHeadline
//   is the only person-level free text, so we feed it into `summary` rather
//   than lose the qualifier's richest signal. (`linkedinDescription` is the
//   *company* blurb, not the person — deliberately NOT mapped.)
//
// Extra forms (snake_case, "company", "description") are tolerance aliases for
// hand-edited / re-exported files. Headers are canonicalized (lowercased,
// whitespace stripped) before lookup, so casing and spacing don't matter.
//
// NOTE: do NOT map "scraperFullName" — in the NEW export that's the phantom
// operator, not the lead.
const ALIAS_GROUPS: Record<keyof ParsedLead, string[]> = {
  default_profile_url: [
    "defaultProfileUrl", // OLD
    "profileUrl", // NEW (input URL)
    "linkedinProfileUrl", // NEW (resolved URL, fallback)
    "profile_url",
  ],
  full_name: ["fullName"], // OLD; NEW synthesizes from first + last (rowToLead)
  first_name: ["firstName"],
  last_name: ["lastName"],
  company_name: ["companyName", "company"],
  title: ["title" /* OLD */, "linkedinJobTitle" /* NEW */],
  summary: ["summary" /* OLD */, "linkedinHeadline" /* NEW */],
  title_description: [
    "titleDescription", // OLD
    "linkedinJobDescription", // NEW
    "description",
  ],
  location: ["location"],
};

// Flatten the groups into a fast canonicalized-header → canonical-column map.
// snake_case is auto-derived from the camelCase form, so e.g. both
// "defaultProfileUrl" and "default_profile_url" resolve without listing both.
const ALIASES: Record<string, keyof ParsedLead> = {};
for (const [canon, headers] of Object.entries(ALIAS_GROUPS) as [
  keyof ParsedLead,
  string[],
][]) {
  for (const h of headers) {
    ALIASES[h.toLowerCase().replace(/\s+/g, "")] = canon; // camelCase form
    ALIASES[h.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()] = canon; // snake_case form
  }
}

function canonical(header: string): keyof ParsedLead | null {
  const key = header.trim().toLowerCase().replace(/\s+/g, "");
  return ALIASES[key] ?? null;
}

// Strip NUL bytes (U+0000) before trimming — Postgres' JSON parser rejects
// the  escape when PostgREST serializes our INSERT, which atomically
// fails the whole chunk and (pre-rollback fix) used to leave a half-imported
// campaign behind. Phantombuster summary fields occasionally carry NUL chars
// from upstream scraping artifacts.
const NUL_RE = new RegExp(String.fromCharCode(0), "g");

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(NUL_RE, "").trim();
  return s.length > 0 ? s : null;
}

export function rowToLead(row: Record<string, unknown>): ParsedLead {
  const lead: ParsedLead = {
    default_profile_url: null,
    full_name: null,
    first_name: null,
    last_name: null,
    company_name: null,
    title: null,
    summary: null,
    title_description: null,
    location: null,
  };
  for (const [k, v] of Object.entries(row)) {
    const col = canonical(k);
    if (!col) continue;
    if (lead[col] === null) lead[col] = str(v);
  }
  // The profile-scraper export has no fullName column — synthesize it from
  // first + last so the row survives the URL-or-name filter and the preview
  // shows a name. The Sales Nav export already provides full_name, so this
  // fallback only fires when it's genuinely absent.
  if (lead.full_name === null) {
    const composed = [lead.first_name, lead.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (composed.length > 0) lead.full_name = composed;
  }
  return lead;
}

export function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data ?? [];
  const detected = parsed.meta.fields ?? [];
  return build(rows, detected);
}

export function parseJson(text: string): ParseResult {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error("JSON must be an array of profile objects.");
  }
  const rows = data as Record<string, unknown>[];
  const detected = rows[0] ? Object.keys(rows[0]) : [];
  return build(rows, detected);
}

function build(rows: Record<string, unknown>[], detected: string[]): ParseResult {
  const canonicalHeaders = new Set(
    detected.map((h) => canonical(h)).filter((x): x is keyof ParsedLead => !!x)
  );
  const missing = INPUT_COLUMNS.filter((c) => {
    if (canonicalHeaders.has(c)) return false;
    // full_name is synthesized from first + last (see rowToLead), so it's not
    // "missing" when both of those columns are present.
    if (
      c === "full_name" &&
      canonicalHeaders.has("first_name") &&
      canonicalHeaders.has("last_name")
    ) {
      return false;
    }
    return true;
  });

  // Drop rows with neither URL nor name (nothing to qualify), then dedupe
  // by default_profile_url. The leads table has `unique (campaign_id,
  // default_profile_url)`, so keeping a duplicate URL would atomically
  // roll back its INSERT chunk and abort the import partway through.
  // Rows with a null URL are kept as-is — Postgres treats nulls as
  // distinct in unique constraints, so they can't collide.
  const filtered = rows
    .map(rowToLead)
    .filter((l) => l.default_profile_url || l.full_name);

  const seen = new Set<string>();
  const leads: ParsedLead[] = [];
  let duplicatesSkipped = 0;
  for (const lead of filtered) {
    const url = lead.default_profile_url;
    if (url === null) {
      leads.push(lead);
      continue;
    }
    if (seen.has(url)) {
      duplicatesSkipped += 1;
      continue;
    }
    seen.add(url);
    leads.push(lead);
  }

  return {
    leads,
    detectedColumns: detected,
    missingColumns: missing,
    duplicatesSkipped,
  };
}

export async function parseFile(file: File): Promise<ParseResult> {
  const text = await file.text();
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return parseJson(text);
  return parseCsv(text);
}
