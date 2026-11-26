"use client";

import Link from "next/link";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { signOut, useSession } from "next-auth/react";
import { User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/store/cart";

export function AccountMenu() {
  const { data: session, status } = useSession();
  if (status !== "authenticated") {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }
  const item = "block cursor-pointer rounded px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted";
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu">
          <User className="size-5" />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-md border border-border bg-card p-1 shadow-lg">
          <Dropdown.Label className="px-3 py-2 text-xs text-muted-foreground">{session.user.email}</Dropdown.Label>
          <Dropdown.Item asChild className={item}>
            <Link href="/orders">Orders</Link>
          </Dropdown.Item>
          <Dropdown.Item asChild className={item}>
            <Link href="/wishlist">Wishlist</Link>
          </Dropdown.Item>
          {session.user.role === "ADMIN" && (
            <Dropdown.Item asChild className={item}>
              <Link href="/admin">Admin dashboard</Link>
            </Dropdown.Item>
          )}
          <Dropdown.Separator className="my-1 h-px bg-border" />
          <Dropdown.Item
            className={item}
            onSelect={() => {
              useCartStore.getState().setView(null);
              void signOut({ callbackUrl: "/" });
            }}
          >
            Sign out
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
