import Link from "next/link";
import { Plus, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DeleteCampaignButton } from "@/components/delete-campaign-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { createServerSupabase } from "@/lib/supabase/server";

type CampaignRow = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  total_leads: number;
  qualified_count: number;
  failed_count: number;
  created_at: string;
  source_filename: string | null;
};

const statusClasses: Record<CampaignRow["status"], string> = {
  pending: "border-muted-foreground/30 text-muted-foreground",
  running:
    "border-primary/40 bg-primary/10 text-primary animate-pulse",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  canceled: "border-muted-foreground/30 text-muted-foreground",
};

export default async function CampaignsPage() {
  const supabase = await createServerSupabase();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select(
      "id, name, status, total_leads, qualified_count, failed_count, created_at, source_filename"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (campaigns ?? []) as CampaignRow[];

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Each campaign is one run of the qualification pipeline — upload a LinkedIn list, pick a prompt template, and export to CSV or Google Sheets."
        actions={
          <Link
            href="/campaigns/new"
            className={buttonVariants({ className: "gap-2" })}
          >
            <Plus className="h-4 w-4" />
            New campaign
          </Link>
        }
      />

      {rows.length === 0 ? (
        <Card className="border-dashed bg-card/40">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              No campaigns yet
            </CardTitle>
            <CardDescription>
              Campaigns you create will appear here with status, qualified
              count, and quick actions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/campaigns/new"
              className={buttonVariants({
                variant: "outline",
                className: "gap-2",
              })}
            >
              <Plus className="h-4 w-4" />
              Create your first campaign
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((c) => (
            <div
              key={c.id}
              className="group flex items-center gap-4 rounded-lg border border-border/70 bg-card/40 px-5 py-4 hover:bg-card/70 transition-colors"
            >
              <Link
                href={`/campaigns/${c.id}`}
                className="flex flex-1 items-center gap-4 min-w-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{c.name}</span>
                    <Badge
                      variant="outline"
                      className={statusClasses[c.status]}
                    >
                      {c.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {c.source_filename ?? "—"} ·{" "}
                    {new Date(c.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-6 text-sm tabular-nums">
                  <Stat label="Total" value={c.total_leads} />
                  <Stat
                    label="Qualified"
                    value={c.qualified_count}
                    accent="text-primary"
                  />
                  <Stat
                    label="Failed"
                    value={c.failed_count}
                    accent={
                      c.failed_count > 0 ? "text-destructive" : undefined
                    }
                  />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
              <DeleteCampaignButton id={c.id} name={c.name} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="text-right">
      <div className={accent ?? "text-foreground"}>{value}</div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
    </div>
  );
}
