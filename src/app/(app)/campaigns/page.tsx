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

// Counts come from the campaign_stats view (live aggregate over leads),
// not the stored counters on campaigns — the stored values lag for legacy
// data and miss categorical verdicts.
export const dynamic = "force-dynamic";

type CampaignRow = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  created_at: string;
  source_filename: string | null;
};

type Stats = {
  campaign_id: string;
  total_leads: number;
  processed_count: number;
  failed_count: number;
  qualified_count: number;
  hot_count: number;
  warm_count: number;
  cold_count: number;
};

const statusClasses: Record<CampaignRow["status"], string> = {
  pending: "border-muted-foreground/30 text-muted-foreground",
  running:
    "border-primary/40 bg-primary/10 text-primary animate-pulse",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  canceled: "border-muted-foreground/30 text-muted-foreground",
};

const ZERO_STATS: Omit<Stats, "campaign_id"> = {
  total_leads: 0,
  processed_count: 0,
  failed_count: 0,
  qualified_count: 0,
  hot_count: 0,
  warm_count: 0,
  cold_count: 0,
};

export default async function CampaignsPage() {
  const supabase = await createServerSupabase();

  const [{ data: campaigns }, { data: stats }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, status, created_at, source_filename")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("campaign_stats").select("*"),
  ]);

  const rows = (campaigns ?? []) as CampaignRow[];
  const statsByCampaign = new Map<string, Stats>();
  for (const s of (stats ?? []) as Stats[]) {
    statsByCampaign.set(s.campaign_id, s);
  }

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
          {rows.map((c) => {
            const s = statsByCampaign.get(c.id) ?? ZERO_STATS;
            return (
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
                    <Stat label="Total" value={s.total_leads} />
                    <Stat
                      label="Qualified"
                      value={s.qualified_count}
                      accent="text-primary"
                    />
                    <Stat
                      label="Failed"
                      value={s.failed_count}
                      accent={
                        s.failed_count > 0 ? "text-destructive" : undefined
                      }
                    />
                    <TempStat
                      hot={s.hot_count}
                      warm={s.warm_count}
                      cold={s.cold_count}
                    />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
                <DeleteCampaignButton id={c.id} name={c.name} />
              </div>
            );
          })}
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

// Per-campaign hot/warm/cold breakdown (from campaign_stats). Temperature is
// only set on qualified leads after cross-check, so a not-yet-cross-checked
// campaign reads 0/0/0 and renders a muted dash — it fills in post-run.
function TempStat({
  hot,
  warm,
  cold,
}: {
  hot: number;
  warm: number;
  cold: number;
}) {
  const total = hot + warm + cold;
  return (
    <div
      className="text-right"
      title={
        total > 0
          ? `${hot} hot · ${warm} warm · ${cold} cold`
          : "Not cross-checked yet"
      }
    >
      {total > 0 ? (
        <div className="flex items-center justify-end gap-1">
          <span className="text-red-400">{hot}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-amber-400">{warm}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground">{cold}</span>
        </div>
      ) : (
        <div className="text-muted-foreground">—</div>
      )}
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
        hot·warm·cold
      </div>
    </div>
  );
}
