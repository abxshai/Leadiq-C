import { executeSqlTool } from "./execute-sql";
import { listTablesTool } from "./list-tables";
import { getTableSchemaTool } from "./get-table-schema";
import type { Tool } from "./types";

export type { Tool, ToolContext, ToolResult } from "./types";
export { executeSqlTool, listTablesTool, getTableSchemaTool };

export const ALL_TOOLS: Record<string, Tool> = {
  [executeSqlTool.name]: executeSqlTool,
  [listTablesTool.name]: listTablesTool,
  [getTableSchemaTool.name]: getTableSchemaTool,
};

export function getTool(name: string): Tool | null {
  return ALL_TOOLS[name] ?? null;
}
