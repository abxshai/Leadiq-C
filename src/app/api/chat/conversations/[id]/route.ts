import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// GET /api/chat/conversations/[id]
// Returns the conversation row + all of its messages in chronological order.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: conv, error: cErr } = await supabase
    .from("chat_conversations")
    .select("id, agent_id, title, created_by, created_at, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: messages, error: mErr } = await supabase
    .from("chat_messages")
    .select("id, role, content, tool_calls, tool_results, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  return NextResponse.json({ conversation: conv, messages });
}
