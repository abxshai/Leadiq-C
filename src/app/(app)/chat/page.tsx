import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ChatPane, type DbMessage } from "@/components/chat/chat-pane";
import { ScrambleText } from "@/components/scramble-text";

// Server component. Auth + locate-or-create a conversation for the current
// user, then hand to the client ChatPane with the initial message list.
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { new: forceNew } = await searchParams;

  // /chat?new=1 ("Clear chat") archives all of this user's currently-open
  // conversations, then redirects to the clean /chat URL so a fresh one is
  // created on the re-render. Archiving (not deleting) keeps history in the
  // DB for the record. The redirect is important: it strips ?new=1 from the
  // URL so a subsequent refresh doesn't archive the conversation the user
  // just started.
  if (forceNew) {
    await supabase
      .from("chat_conversations")
      .update({ archived_at: new Date().toISOString() })
      .eq("created_by", user.id)
      .is("archived_at", null);
    redirect("/chat");
  }

  // Latest non-archived conversation belonging to this user, if any.
  const { data: existing } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("created_by", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId: string;
  let messages: DbMessage[] = [];

  if (existing) {
    conversationId = existing.id;
    const { data } = await supabase
      .from("chat_messages")
      .select("id, role, content, tool_calls, tool_results, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    messages = (data ?? []) as DbMessage[];
  } else {
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ agent_id: "leadquery", created_by: user.id })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(
        `Could not create a chat conversation: ${error?.message ?? "unknown"}`
      );
    }
    conversationId = data.id;
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div>
        <h1 className="font-display text-3xl lowercase tracking-wide leading-tight text-primary [-webkit-text-stroke:0.6px_currentColor]">
          <ScrambleText text="LeadQuery" />
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask in natural language. Read-only SQL over your campaigns and leads.
        </p>
      </div>
      <ChatPane conversationId={conversationId} initialMessages={messages} />
    </div>
  );
}
