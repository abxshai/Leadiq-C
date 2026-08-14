import "server-only";
import { z } from "zod";
import type OpenAI from "openai";
import { ALL_TOOLS, getTool, type ToolContext } from "./tools";
import type { AgentConfig } from "./registry";
import type { ChatStreamEvent } from "./sse";

// OpenAI chat-completion message shape (the minimal subset we use).
// We mirror the wire format so messages flow into the Groq API unchanged
// and out into the DB with role-specific columns.
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | {
      role: "tool";
      tool_call_id: string;
      name: string;
      content: string; // JSON-stringified tool result
    };

const MAX_TOOL_LOOPS = 5;

export type ChatLoopResult = {
  /** Messages produced by THIS request — does NOT include the input user message,
   *  which the caller persists before invoking the loop. */
  newMessages: ChatMessage[];
};

/**
 * Run the LLM tool-call loop. Emits events via `onEvent` for streaming UX,
 * and returns the new messages to persist when complete. The caller owns
 * persistence — this function is pure with respect to the database.
 */
export async function runChatLoop({
  agent,
  history,
  client,
  onEvent,
  toolContext,
  systemPrompt,
}: {
  agent: AgentConfig;
  /** Full history including the new user message at the tail. */
  history: ChatMessage[];
  client: OpenAI;
  onEvent: (event: ChatStreamEvent) => void;
  /** Per-request resources (Exa key, auth user id) passed to tool handlers. */
  toolContext?: ToolContext;
  /** Overrides the agent's base system prompt (base + user-supplied ICP context). */
  systemPrompt?: string;
}): Promise<ChatLoopResult> {
  const tools = agent.tools
    .map((name) => ALL_TOOLS[name])
    .filter(Boolean)
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: z.toJSONSchema(t.schema) as Record<string, unknown>,
      },
    }));

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt ?? agent.system_prompt },
    ...history,
  ];

  const newMessages: ChatMessage[] = [];

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const stream = await client.chat.completions.create({
      model: agent.model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      temperature: 0,
    });

    let assistantContent = "";
    const toolCalls: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> = [];
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

      if (delta?.content) {
        assistantContent += delta.content;
        onEvent({ type: "token", content: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index;
          if (toolCalls[idx] == null) {
            toolCalls[idx] = {
              id: tcDelta.id ?? "",
              type: "function",
              function: { name: "", arguments: "" },
            };
          }
          if (tcDelta.id) toolCalls[idx].id = tcDelta.id;
          if (tcDelta.function?.name)
            toolCalls[idx].function.name = tcDelta.function.name;
          if (tcDelta.function?.arguments)
            toolCalls[idx].function.arguments += tcDelta.function.arguments;
        }
      }
    }

    // No tool calls — the assistant gave its final answer.
    if (finishReason !== "tool_calls" || toolCalls.length === 0) {
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: assistantContent || null,
      };
      messages.push(assistantMsg);
      newMessages.push(assistantMsg);
      return { newMessages };
    }

    // Tool calls requested. Persist the assistant turn (with the tool_calls
    // metadata), then run each tool and persist the results.
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: assistantContent || null,
      tool_calls: toolCalls,
    };
    messages.push(assistantMsg);
    newMessages.push(assistantMsg);

    for (const tc of toolCalls) {
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(tc.function.arguments || "{}");
      } catch {
        parsedArgs = {};
      }
      onEvent({
        type: "tool_call_started",
        id: tc.id,
        name: tc.function.name,
        args: parsedArgs,
      });

      const tool = getTool(tc.function.name);
      let result: unknown;
      if (!tool) {
        result = { ok: false, error: `Unknown tool: ${tc.function.name}` };
      } else {
        try {
          const validated = tool.schema.parse(parsedArgs);
          result = await tool.handler(validated, toolContext ?? {});
        } catch (e) {
          result = {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      const toolMsg: ChatMessage = {
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: JSON.stringify(result),
      };
      messages.push(toolMsg);
      newMessages.push(toolMsg);

      const isOk =
        typeof result === "object" && result != null && "ok" in result
          ? (result as { ok: boolean }).ok === true
          : false;

      onEvent({
        type: "tool_call_result",
        id: tc.id,
        name: tc.function.name,
        result,
        ok: isOk,
      });
    }
    // Continue the outer for-loop: re-call Groq with the tool results
    // appended to `messages`.
  }

  // Loop limit hit. Surface to the user, but still return what we have so
  // the caller can persist the partial transcript.
  onEvent({
    type: "error",
    message: `Tool-call loop exceeded ${MAX_TOOL_LOOPS} rounds. Stopping.`,
  });
  return { newMessages };
}
