"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteCampaign } from "@/app/(app)/campaigns/actions";
import { cn } from "@/lib/utils";

export function DeleteCampaignButton({
  id,
  name,
  redirectTo,
  variant = "icon",
}: {
  id: string;
  name: string;
  redirectTo?: string;
  variant?: "icon" | "full";
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      await deleteCampaign(id, redirectTo ? { redirectTo } : undefined);
      setOpen(false);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        onClick={(e) => {
          // Stop navigation when nested inside a row that's a link.
          e.stopPropagation();
          e.preventDefault();
        }}
        className={cn(
          "inline-flex items-center justify-center text-muted-foreground transition-colors",
          variant === "icon"
            ? "h-8 w-8 rounded-md hover:bg-destructive/10 hover:text-destructive"
            : "h-8 gap-2 rounded-lg border border-border bg-background px-3 text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
        )}
        aria-label={`Delete ${name}`}
      >
        <Trash2 className="h-4 w-4" />
        {variant === "full" ? "Delete" : null}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{name}&rdquo; and all of its {`lead rows`} will be
            permanently removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="gap-2"
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={pending}
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
