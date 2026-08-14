import "server-only";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { GROQ_BASE_URL } from "@/lib/groq-config";
import { getAgent } from "@/lib/agents/registry";
import { runChatLoop, type ChatMessage } from "@/lib/agents/chat-loop";
import { sseChunk, type ChatStreamEvent } from "@/lib/agents/sse";

type DbMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  tool_calls: unknown;
  tool_results: unknown;
};

function dbToChatMessage(row: DbMessage): ChatMessage | null {
  switch (row.role) {
    case "system":
      return { role: "system", content: row.content ?? "" };
    case "user":
      return { role: "user", content: row.content ?? "" };
    case "assistant":
      return {
        role: "assistant",
        content: row.content,
        tool_calls:
          (row.tool_calls as ChatMessage extends { tool_calls?: infer T }
            ? T
            : never) ?? undefined,
      } as ChatMessage;
    case "tool": {
      const meta = row.tool_results as
        | { tool_call_id?: string; name?: string }
        | null;
      if (!meta?.tool_call_id || !meta?.name) return null;
      return {
        role: "tool",
        tool_call_id: meta.tool_call_id,
        name: meta.name,
        content: row.content ?? "",
      };
    }
  }
}

function chatMessageToDbInsert(msg: ChatMessage, conversationId: string) {
  switch (msg.role) {
    case "user":
      return {
        conversation_id: conversationId,
        role: "user" as const,
        content: msg.content,
        tool_calls: null,
        tool_results: null,
      };
    case "assistant":
      return {
        conversation_id: conversationId,
        role: "assistant" as const,
        content: msg.content,
        tool_calls: msg.tool_calls ?? null,
        tool_results: null,
      };
    case "tool":
      return {
        conversation_id: conversationId,
        role: "tool" as const,
        content: msg.content,
        tool_calls: null,
        tool_results: { tool_call_id: msg.tool_call_id, name: msg.name },
      };
    case "system":
      return null; // system messages are agent-config, never persisted
  }
}

// POST /api/chat/conversations/[id]/messages
// Body: { content: string }
// Header: X-Groq-Key (BYOK)
// Streams SSE events as the LLM responds + uses tools.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await ctx.params;

  // BYOK Groq key
  const apiKey = request.headers.get("x-groq-key")?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing X-Groq-Key header." },
      { status: 400 }
    );
  }
  if (!apiKey.startsWith("gsk_")) {
    return NextResponse.json(
      { error: "That doesn't look like a Groq key (expected gsk_…)." },
      { status: 400 }
    );
  }

  // BYOK Exa key (optional — only the exa_search sourcing tool needs it).
  const exaApiKey = request.headers.get("x-exa-key")?.trim() || undefined;

  // Auth
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  const body = await request.json().catch(() => null);
  const userMessage =
    typeof body?.content === "string" ? body.content.trim() : "";
  if (!userMessage) {
    return NextResponse.json(
      { error: "Missing message content" },
      { status: 400 }
    );
  }
  if (userMessage.length > 10_000) {
    return NextResponse.json(
      { error: "Message too long (max 10000 chars)" },
      { status: 400 }
    );
  }

  // Optional user-supplied system prompt (ICP / signal context), prepended to
  // the agent's base prompt for this request.
  const systemPromptExtra =
    typeof body?.systemPrompt === "string"
      ? body.systemPrompt.trim().slice(0, 8000)
      : "";

  // Load conversation + look up the agent it's bound to
  const { data: conv, error: cErr } = await supabase
    .from("chat_conversations")
    .select("id, agent_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  const agent = getAgent(conv.agent_id);
  if (!agent) {
    return NextResponse.json(
      { error: `Unknown agent: ${conv.agent_id}` },
      { status: 500 }
    );
  }

  const effectiveSystemPrompt = systemPromptExtra
    ? `${agent.system_prompt}\n\n# User-provided ICP / signal context\n\nThe user supplied the context below. Treat it as authoritative for ICP definitions, target segments, and signal criteria when sourcing, qualifying, and segmenting:\n\n${systemPromptExtra}`
    : agent.system_prompt;

  // Load prior persisted history
  const { data: histRows, error: hErr } = await supabase
    .from("chat_messages")
    .select("id, role, content, tool_calls, tool_results")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (hErr) {
    return NextResponse.json({ error: hErr.message }, { status: 500 });
  }

  const history: ChatMessage[] = (histRows ?? [])
    .map((r) => dbToChatMessage(r as DbMessage))
    .filter((m): m is ChatMessage => m != null);

  // Persist the user message immediately (so a mid-stream crash still
  // records what was asked).
  const service = createServiceSupabase();
  const userInsert = chatMessageToDbInsert(
    { role: "user", content: userMessage },
    conversationId
  );
  if (userInsert) {
    const { error: userInsertErr } = await service
      .from("chat_messages")
      .insert(userInsert);
    if (userInsertErr) {
      return NextResponse.json(
        { error: userInsertErr.message },
        { status: 500 }
      );
    }
  }

  const userMsg: ChatMessage = { role: "user", content: userMessage };
  const historyWithUser: ChatMessage[] = [...history, userMsg];

  const groq = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(sseChunk(event));
        } catch {
          // Stream closed (client disconnected) — silently drop.
        }
      };

      try {
        const result = await runChatLoop({
          agent,
          history: historyWithUser,
          client: groq,
          onEvent: enqueue,
          toolContext: { userId: user.id, exaApiKey },
          systemPrompt: effectiveSystemPrompt,
        });

        // Persist the new assistant + tool messages in one batch.
        const rows = result.newMessages
          .map((m) => chatMessageToDbInsert(m, conversationId))
          .filter((r): r is NonNullable<typeof r> => r != null);

        if (rows.length > 0) {
          const { error: insertErr } = await service
            .from("chat_messages")
            .insert(rows);
          if (insertErr) {
            enqueue({
              type: "error",
              message: `Persist failed: ${insertErr.message}`,
            });
          }
        }

        enqueue({ type: "done" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        enqueue({ type: "error", message: msg });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
