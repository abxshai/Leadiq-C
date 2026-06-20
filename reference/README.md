# Reference — origin artifacts

Preserved source material that predates / informed Lead-IQ. Not used at runtime;
kept so the lineage doesn't depend on chat-transcript retention.

## `lead-qualification-n8n-workflow.json`

The **original n8n workflow** that did lead qualification before Lead-IQ existed —
the precursor this app productized. Exported from n8n as `My workflow 2`. Its
Google Sheets node still points at a sheet named **`Agentic - 17/3`** (17 March),
so the pipeline was live in mid-March, ahead of Lead-IQ's first recorded
milestones. The workflow JSON was never committed to this repo or pasted into the
build chats that are still on disk (earliest retained transcript is 2026-05-07);
it most likely came in during a kickoff session that's since been pruned. Its
system prompt did carry into the product — see the `Main Enterprise Prompt`
template in `prompt_templates`.

> Note: n8n exports contain credential **references** only (IDs + display names
> like `Groq account 5`), never secret values. The Google Sheet ID, Phantombuster
> `agentId`, and n8n `instanceId` are identifiers, not secrets.

### The flow (7 nodes)
`Manual trigger → Phantombuster (getOutput) → HTTP Request (fetch result JSON)
→ Lead Qualification1 (Groq chainLlm) → Append/update Google Sheet → Convert to File`,
with a **Groq Chat Model** (`openai/gpt-oss-120b`, temperature 0) feeding the
qualification chain.

### How it maps to the current Lead-IQ pipeline
| n8n workflow | Lead-IQ today |
|---|---|
| Phantombuster `getOutput` + HTTP Request | Scrape page / PB fetch ingestion (`pb-fetch.ts`, `lead-parser.ts`) |
| `Lead Qualification1` Groq `chainLlm` (gpt-oss-120b, temp 0) | The worker's per-lead Groq qualification call (`worker.ts`), same model + temp 0 |
| The giant system prompt in the `text` field | The **`Main Enterprise Prompt`** template in `prompt_templates` (+ `GCC` / `Nvidia` variants); snapshotted per campaign |
| 12-field JSON output (Function Qualification, Function Reasoning, ICP Qualification, Seniority Scoring, Domain Classification, Subdomain, Subdomain Justification, Domain Reasoning, Priority Level, Product Area / Team, Lead Summary, Full Name) | The `leads` agent-output columns + Zod schema — same shape, 1:1 |
| Batching (`batchSize: 3`, 20s delay) + retry (5 tries, 3s wait) | `p-limit` concurrency + per-campaign `delay_ms` rate gate + the 1-retry Zod/400 path |
| Append/update Google Sheet | CSV export (Google Sheets push is roadmap M4, parked) |

In short: Lead-IQ is the browser-native productization of this workflow — the
ingestion, the Groq model + temperature, the prompt, and the output schema all
trace directly back to it.
