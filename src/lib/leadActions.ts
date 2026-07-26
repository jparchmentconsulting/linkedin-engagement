"use server";

import { revalidatePath } from "next/cache";
import { getAccount } from "./account";
import { db } from "./db";
import { erasePerson } from "./erasure";
import { errText, logError } from "./errors";

// Every lead action re-checks the person belongs to the one Account row —
// the id from the form is never trusted on its own.
async function scopedPerson(personId: string) {
  const account = await getAccount();
  if (!account) return null;
  const person = await db.person.findUnique({ where: { id: personId } });
  if (!person || person.accountId !== account.id) return null;
  return person;
}

// Queue controls: dismiss removes a lead from the default list (never
// deletes), snooze quiets them for two weeks, restore undoes either.
const SNOOZE_DAYS = 14;

export async function dismissLead(formData: FormData) {
  const person = await scopedPerson(String(formData.get("personId") ?? ""));
  if (person) {
    await db.person.update({
      where: { id: person.id },
      data: { dismissedAt: new Date() },
    });
  }
  revalidatePath("/");
}

export async function snoozeLead(formData: FormData) {
  const person = await scopedPerson(String(formData.get("personId") ?? ""));
  if (person) {
    await db.person.update({
      where: { id: person.id },
      data: {
        snoozedUntil: new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  }
  revalidatePath("/");
}

export async function restoreLead(formData: FormData) {
  const person = await scopedPerson(String(formData.get("personId") ?? ""));
  if (person) {
    await db.person.update({
      where: { id: person.id },
      data: { dismissedAt: null, snoozedUntil: null },
    });
  }
  revalidatePath("/");
}

// Manually set (or clear) a lead's Fit Tier, overriding the AI-derived tier.
// For correcting leads the scorer mis-sorted. Passing "AI" clears the override
// so the lead falls back to its relevance-based tier.
const MANUAL_FIT_VALUES = ["STRONG_FIT", "POSSIBLE", "NOT_A_FIT"] as const;

export async function setLeadFit(
  personId: string,
  tier: "STRONG_FIT" | "POSSIBLE" | "NOT_A_FIT" | "AI"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const person = await scopedPerson(personId);
  if (!person) return { ok: false, error: "Lead not found." };
  if (tier !== "AI" && !MANUAL_FIT_VALUES.includes(tier)) {
    return { ok: false, error: "Unknown fit tier." };
  }

  await db.person.update({
    where: { id: person.id },
    data: { manualFitTier: tier === "AI" ? null : tier },
  });

  revalidatePath("/");
  return { ok: true };
}

export type EraseResult = { ok: true } | { ok: false; error: string };

// Permanently delete a scraped person and everything derived from them.
// Unlike dismiss/snooze this is irreversible, so the UI confirms first.
export async function eraseLead(personId: string): Promise<EraseResult> {
  const person = await scopedPerson(personId);
  if (!person) return { ok: false, error: "Lead not found." };
  try {
    await erasePerson(person.id);
  } catch (error) {
    logError({
      source: "erasure",
      personId: person.id,
      message: `Erase failed for ${person.name}: ${errText(error)}`,
    });
    return { ok: false, error: "Could not erase this lead. Nothing was deleted." };
  }
  revalidatePath("/");
  return { ok: true };
}
