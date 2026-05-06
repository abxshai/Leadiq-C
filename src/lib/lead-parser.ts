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

const INPUT_COLUMNS: (keyof ParsedLead)[] = [
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

// Case-insensitive alias → canonical column map.
// Matches both the CSV export format ("defaultProfileUrl") and snake_case.
const ALIASES: Record<string, keyof ParsedLead> = {
  defaultprofileurl: "default_profile_url",
  default_profile_url: "default_profile_url",
  profile_url: "default_profile_url",
  fullname: "full_name",
  full_name: "full_name",
  firstname: "first_name",
  first_name: "first_name",
  lastname: "last_name",
  last_name: "last_name",
  companyname: "company_name",
  company_name: "company_name",
  company: "company_name",
  title: "title",
  summary: "summary",
  titledescription: "title_description",
  title_description: "title_description",
  description: "title_description",
  location: "location",
};

function canonical(header: string): keyof ParsedLead | null {
  const key = header.trim().toLowerCase().replace(/\s+/g, "");
  return ALIASES[key] ?? null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function rowToLead(row: Record<string, unknown>): ParsedLead {
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
  const missing = INPUT_COLUMNS.filter((c) => !canonicalHeaders.has(c));

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
