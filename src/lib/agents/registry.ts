import { LEADQUERY_SYSTEM_PROMPT } from "./leadquery-prompt";

export type AgentConfig = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];           // tool names from tools/index.ts ALL_TOOLS
  model: string;             // groq model id (OpenAI-compatible)
  byok_required: ("groq")[]; // future: 'lookup' for the touchpoint agent (M-CX1)
};

export const AGENTS: AgentConfig[] = [
  {
    id: "leadquery",
    name: "LeadQuery",
    description:
      "Query qualified leads across all campaigns plus the CRM data (HubSpot contacts/companies/deals + Smartlead email engagement) with natural language. Structured SQL filtering (semantic similarity comes later in M-AG2).",
    system_prompt: LEADQUERY_SYSTEM_PROMPT,
    tools: ["execute_sql", "list_tables", "get_table_schema"],
    model: "openai/gpt-oss-120b",
    byok_required: ["groq"],
  },
];

export function getAgent(id: string): AgentConfig | null {
  return AGENTS.find((a) => a.id === id) ?? null;
}
