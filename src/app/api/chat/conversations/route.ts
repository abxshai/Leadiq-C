import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getAgent } from "@/lib/agents/registry";

// POST /api/chat/conversations
// Body: { agent_id: string, title?: string }
// Creates a new conversation owned by the current user.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const agentId = typeof body?.agent_id === "string" ? body.agent_id : null;
  const title = typeof body?.title === "string" ? body.title : null;

  if (!agentId || !getAgent(agentId)) {
    return NextResponse.json({ error: "Invalid agent_id" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("chat_conversations")
    .insert({
      agent_id: agentId,
      title,
      created_by: user.id,
    })
    .select("id, agent_id, title, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
