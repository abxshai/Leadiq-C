import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { GroqConnectPill } from "@/components/groq-connect-pill";
import { PbConnectPill } from "@/components/pb-connect-pill";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-dvh">
      <AppSidebar email={user.email ?? ""} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border/60 bg-background/40 px-6 backdrop-blur-xl">
          <div className="text-sm text-muted-foreground">
            Lead Qualification Dashboard
          </div>
          <div className="flex items-center gap-2">
            <PbConnectPill />
            <GroqConnectPill />
          </div>
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
