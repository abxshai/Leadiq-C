"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Loader2,
  CheckCircle2,
  Copy,
  Archive,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  archiveTemplate,
  duplicateTemplate,
  setDefaultTemplate,
  unarchiveTemplate,
} from "@/app/(app)/templates/actions";

export function TemplateActionsMenu({
  id,
  name,
  isDefault,
  isArchived,
}: {
  id: string;
  name: string;
  isDefault: boolean;
  isArchived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmArchive, setConfirmArchive] = useState(false);

  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        console.error("[template-actions]", err);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label={`Actions for ${name}`}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isArchived && !isDefault ? (
            <DropdownMenuItem onClick={() => run(() => setDefaultTemplate(id))}>
              <CheckCircle2 className="h-4 w-4" />
              Make default
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => run(() => duplicateTemplate(id))}>
            <Copy className="h-4 w-4" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isArchived ? (
            <DropdownMenuItem onClick={() => run(() => unarchiveTemplate(id))}>
              <RotateCcw className="h-4 w-4" />
              Unarchive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmArchive(true)}
            >
              <Archive className="h-4 w-4" />
              Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this template?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{name}&rdquo; will be hidden from the campaign wizard.
              Existing campaigns keep their snapshot — nothing breaks
              retroactively. You can unarchive later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                run(() => archiveTemplate(id));
                setConfirmArchive(false);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
