// Turns the rows returned by the get_lead_reply_threads SQL function into a
// compact plain-text transcript suitable for an LLM prompt. Smartlead stores
// email_body as HTML with quoted history + signatures, which is noisy and
// token-heavy — we strip tags, decode the few entities that actually show up,
// trim the quoted-reply chain, and clamp each message before joining.
//
// Pure + dependency-free so it's trivially unit-testable and safe to import
// from a route handler.

export type ThreadRow = {
  message_type: string | null; // "SENT" | "REPLY" (Smartlead casing)
  message_time: string | null;
  subject: string | null;
  email_body: string | null;
  campaign_name: string | null;
  campaign_id: number | null;
  seq: string | null;
};

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

// Markers that begin a quoted prior message / signature. We cut at the first
// one so the model sees only the message someone actually wrote this turn.
const QUOTE_MARKERS: RegExp[] = [
  /\nOn .+ wrote:/i, // Gmail / Apple Mail quote header
  /\n-{2,}\s*Original Message\s*-{2,}/i, // Outlook
  /\nFrom:\s.+\nSent:/i, // Outlook header block
  /\n_{5,}/, // Outlook divider line
  /\n>{1,}\s/, // plain-text quote prefix
];

export function stripHtml(html: string): string {
  let s = html;
  // <br>, </p>, </div>, </li> -> newline so structure survives tag removal.
  s = s.replace(/<\s*br\s*\/?>/gi, "\n");
  s = s.replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n");
  // Drop style/script blocks wholesale, then all remaining tags.
  s = s.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  for (const [ent, ch] of Object.entries(ENTITIES)) {
    s = s.split(ent).join(ch);
  }
  // Numeric entities (&#1234; / &#x1F;) -> best-effort.
  s = s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return s;
}

export function cleanBody(html: string | null, maxLen = 1500): string {
  if (!html) return "";
  let text = stripHtml(html);
  // Cut at the earliest quoted-history / signature marker.
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = text.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }
  text = text.slice(0, cut);
  // Collapse runs of blank lines + trailing whitespace.
  text = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (text.length > maxLen) text = text.slice(0, maxLen).trimEnd() + "…";
  return text;
}

function fmtDay(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "?" : d.toISOString().slice(0, 10);
}

// Builds the transcript the summarize route hands to the model. Rows arrive
// most-recent-last (the SQL orders by message_time asc).
export function formatThreadForPrompt(rows: ThreadRow[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    const who = (r.message_type ?? "").toUpperCase() === "REPLY" ? "LEAD" : "US";
    const body = cleanBody(r.email_body);
    if (!body) continue;
    const subj = r.subject ? ` — subject: "${r.subject}"` : "";
    const camp = r.campaign_name ? ` [${r.campaign_name}]` : "";
    lines.push(`[${fmtDay(r.message_time)}] ${who}${camp}${subj}\n${body}`);
  }
  return lines.join("\n\n---\n\n");
}
