import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { GroqConnectPill } from "@/components/groq-connect-pill";
import { PbConnectPill } from "@/components/pb-connect-pill";
import { ApifyConnectPill } from "@/components/apify-connect-pill";
import { ThemeToggle } from "@/components/theme-toggle";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  // getClaims() verifies the JWT locally (no Auth-server round-trip) — see
  // proxy.ts. The middleware already gated this route, so this is just to read
  // the email for the sidebar without a second network call that would block
  // the layout (and defeat loading.tsx streaming).
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-dvh">
      <AppSidebar email={typeof claims.email === "string" ? claims.email : ""} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border/60 bg-background/40 px-6 backdrop-blur-xl">
          <div className="text-sm text-muted-foreground">
            Lead Qualification Dashboard
          </div>
          <div className="flex items-center gap-2">
            <PbConnectPill />
            <ApifyConnectPill />
            <GroqConnectPill />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
