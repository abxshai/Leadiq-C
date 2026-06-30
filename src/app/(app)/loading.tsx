import { Skeleton } from "@/components/ui/skeleton";

// Instant loading shell for every (app) route. Because the layout now verifies
// auth locally (getClaims, no network), it renders immediately and this
// skeleton streams in while the page's server data (force-dynamic DB queries)
// loads — so navigation paints at once instead of blocking on a blank screen.
// Generic on purpose: a page title + toolbar + content rows that read sensibly
// for the table/card pages (campaigns, leads, opportunities, templates).
export default function Loading() {
  return (
    <div>
      {/* PageHeader echo */}
      <div className="mb-8 space-y-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      {/* filter / toolbar echo */}
      <Skeleton className="mb-4 h-12 w-full rounded-lg" />

      {/* content rows echo */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
