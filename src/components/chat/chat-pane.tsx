"use client";

import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Send } from "lucide-react";
import { useGroqStore } from "@/lib/groq-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from "./chat-message";

export type DbMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  tool_calls: unknown;
  tool_results: unknown;
  created_at?: string;
  /** Streaming-only: tool call arguments held in memory (not persisted in
   *  this column on the server side; they live in the prior assistant
   *  message's tool_calls jsonb). Used to render tool cards live. */
  args?: unknown;
};

type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call_started"; id: string; name: string; args: unknown }
  | {
      type: "tool_call_result";
      id: string;
      name: string;
      result: unknown;
      ok: boolean;
    }
  | { type: "done" }
  | { type: "error"; message: string };

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function ChatPane({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: DbMessage[];
}) {
  const [messages, setMessages] = useState<DbMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiKey = useGroqStore((s) => s.apiKey);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function handleSend() {
    if (!input.trim() || streaming) return;
    if (!apiKey) {
      setError("Connect your Groq key from the pill in the top-right.");
      return;
    }
    setError(null);

    const userText = input.trim();
    setInput("");

    const userMsg: DbMessage = {
      id: uniqueId("user"),
      role: "user",
      content: userText,
      tool_calls: null,
      tool_results: null,
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);

    // currentAssistantId tracks which assistant message tokens are flowing into.
    // Tool call events reset it to null so the NEXT token batch creates a
    // fresh assistant bubble (multi-turn tool-call loops produce separate
    // assistant messages).
    let currentAssistantId: string | null = null;

    try {
      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Groq-Key": apiKey,
          },
          body: JSON.stringify({ content: userText }),
        }
      );

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          if (!block.startsWith("data: ")) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(block.slice(6)) as StreamEvent;
          } catch {
            continue;
          }

          switch (event.type) {
            case "token": {
              if (currentAssistantId == null) {
                const id = uniqueId("asst");
                currentAssistantId = id;
                setMessages((prev) => [
                  ...prev,
                  {
                    id,
                    role: "assistant",
                    content: event.content,
                    tool_calls: null,
                    tool_results: null,
                  },
                ]);
              } else {
                const id = currentAssistantId;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === id
                      ? { ...m, content: (m.content ?? "") + event.content }
                      : m
                  )
                );
              }
              break;
            }

            case "tool_call_started": {
              currentAssistantId = null;
              setMessages((prev) => [
                ...prev,
                {
                  id: `tool-${event.id}`,
                  role: "tool",
                  content: null,
                  tool_calls: null,
                  tool_results: { tool_call_id: event.id, name: event.name },
                  args: event.args,
                },
              ]);
              break;
            }

            case "tool_call_result": {
              const matchId = `tool-${event.id}`;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === matchId
                    ? {
                        ...m,
                        content: JSON.stringify(event.result),
                        tool_results: {
                          tool_call_id: event.id,
                          name: event.name,
                          ok: event.ok,
                        },
                      }
                    : m
                )
              );
              break;
            }

            case "error":
              setError(event.message);
              break;

            case "done":
              break;
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stream failed");
    } finally {
      setStreaming(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSend();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 min-h-0">
      <div className="flex-1 overflow-y-auto pr-2 space-y-3 min-h-0">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-muted-foreground text-sm py-16 space-y-2">
            <p>Ask LeadQuery a question about your qualified leads.</p>
            <p className="font-mono text-xs opacity-75">
              e.g. &quot;How many leads qualified as Decision Maker in May?&quot;
            </p>
          </div>
        )}
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
        {streaming && (
          <div className="text-xs text-muted-foreground animate-pulse pl-1">
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            apiKey
              ? "Ask LeadQuery anything about your leads…"
              : "Connect your Groq key from the top-right to start."
          }
          rows={2}
          className="flex-1 resize-none"
          disabled={streaming || !apiKey}
        />
        <Button
          type="submit"
          size="icon"
          disabled={streaming || !input.trim() || !apiKey}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>

      {error && (
        <div className="text-sm text-destructive border border-destructive/40 bg-destructive/10 rounded-md p-3">
          {error}
        </div>
      )}
    </div>
  );
}
