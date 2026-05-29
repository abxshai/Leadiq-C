// SSE event envelope for the chat streaming protocol.
//
// Each event is sent as a single `data: <json>\n\n` SSE frame. The client
// JSON-parses the data and dispatches on `type`. Keeping the shape closed
// (discriminated union) means the client can be exhaustive at the type
// level.

const encoder = new TextEncoder();

export type ChatStreamEvent =
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

export function sseChunk(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}
