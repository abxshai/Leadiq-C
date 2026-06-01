"use client";

import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UserButton({ email }: { email: string }) {
  const initials = email.slice(0, 2).toUpperCase();

  async function signOut() {
    await fetch("/auth/signout", { method: "POST" });
    // Hard navigation (not router.replace) so we land on a fresh request with
    // the cleared cookies — avoids any RSC router cache briefly showing the
    // still-authed state and the proxy bouncing /login → /campaigns.
    window.location.assign("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-sidebar-accent/60 transition-colors">
        <Avatar className="h-7 w-7 ring-1 ring-primary/30">
          <AvatarFallback className="bg-primary/15 text-primary text-xs">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-sidebar-foreground/90">{email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
