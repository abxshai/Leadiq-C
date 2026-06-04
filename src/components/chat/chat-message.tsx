"use client";

import { ChatToolCall } from "./chat-tool-call";
import { MarkdownMessage } from "./markdown-message";
import type { DbMessage } from "./chat-pane";

function safeParseJson(s: string | null | undefined): unknown {
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function ChatMessage({ message }: { message: DbMessage }) {
  if (message.role === "system") return null;

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-primary/15 border border-primary/30 px-4 py-2.5 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "tool") {
    const meta = (message.tool_results ?? {}) as {
      tool_call_id?: string;
      name?: string;
      ok?: boolean;
    };
    const name = meta.name ?? "tool";
    const ok = meta.ok;
    const result = safeParseJson(message.content);
    // args is only present in-memory during streaming; not persisted.
    const args = message.args;
    return <ChatToolCall name={name} args={args} result={result} ok={ok} />;
  }

  if (message.role === "assistant") {
    // Suppress empty assistant turns (intermediate turns that only emitted
    // tool calls have null content — the tool messages render those).
    if (!message.content) return null;
    return (
      <div className="flex justify-start">
        <div className="min-w-0 max-w-[85%]">
          <MarkdownMessage content={message.content} />
        </div>
      </div>
    );
  }

  return null;
}
