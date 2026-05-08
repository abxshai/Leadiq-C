"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { restoreVersion } from "@/app/(app)/templates/actions";

type Version = {
  version: number;
  name: string;
  saved_at: string;
  saved_by: string | null;
  preview: string;
};

export function TemplateVersions({
  templateId,
  versions,
  currentVersion,
}: {
  templateId: string;
  versions: Version[];
  currentVersion: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [restoring, setRestoring] = useState<number | null>(null);

  function onRestore(v: number) {
    startTransition(async () => {
      try {
        await restoreVersion(templateId, v);
        router.refresh();
      } catch (err) {
        console.error("[template-versions] restore failed:", err);
      } finally {
        setRestoring(null);
      }
    });
  }

  if (versions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No prior versions yet.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-3 text-sm font-medium">
        <History className="h-4 w-4 text-muted-foreground" />
        Version history
      </div>
      <ul className="space-y-2">
        {versions.map((v) => {
          const isCurrent = v.version === currentVersion;
          return (
            <li
              key={v.version}
              className="flex items-start gap-3 rounded-md border border-border/60 bg-card/30 px-3 py-2"
            >
              <div className="text-xs text-muted-foreground tabular-nums w-12 pt-0.5">
                v{v.version}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium truncate">{v.name}</span>
                  {isCurrent ? (
                    <span className="text-[10px] uppercase tracking-wide text-primary">
                      current
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(v.saved_at).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground/80 mt-1 line-clamp-2 font-mono">
                  {v.preview}
                </div>
              </div>
              {!isCurrent ? (
                <button
                  type="button"
                  onClick={() => setRestoring(v.version)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  {pending && restoring === v.version ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Restore
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={restoring !== null && !pending}
        onOpenChange={(o) => {
          if (!o) setRestoring(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version v{restoring}?</AlertDialogTitle>
            <AlertDialogDescription>
              The current prompt will be saved as a new version, and v{restoring}
              &apos;s contents become the new current version. Past campaigns
              keep their original snapshot — nothing changes retroactively.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (restoring != null) onRestore(restoring);
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
