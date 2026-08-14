import { executeSqlTool } from "./execute-sql";
import { listTablesTool } from "./list-tables";
import { getTableSchemaTool } from "./get-table-schema";
import { exaSearchTool } from "./exa-search";
import { createCampaignTool } from "./create-campaign";
import type { Tool } from "./types";

export type { Tool, ToolContext, ToolResult } from "./types";
export {
  executeSqlTool,
  listTablesTool,
  getTableSchemaTool,
  exaSearchTool,
  createCampaignTool,
};

export const ALL_TOOLS: Record<string, Tool> = {
  [executeSqlTool.name]: executeSqlTool,
  [listTablesTool.name]: listTablesTool,
  [getTableSchemaTool.name]: getTableSchemaTool,
  [exaSearchTool.name]: exaSearchTool,
  [createCampaignTool.name]: createCampaignTool,
};

export function getTool(name: string): Tool | null {
  return ALL_TOOLS[name] ?? null;
}
