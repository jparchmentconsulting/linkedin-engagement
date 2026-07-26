import "server-only";
import type { Account } from "@prisma/client";
import { db } from "./db";

// Single-user app: exactly one Account row, created by the first-run setup
// screen (/setup). Every page and action resolves the account through here,
// so "which account" can never come from client input.
export async function getAccount(): Promise<Account | null> {
  return db.account.findFirst({ orderBy: { createdAt: "asc" } });
}
