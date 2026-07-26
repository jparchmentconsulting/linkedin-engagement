"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccount } from "./account";
import { db } from "./db";

// First-run setup (and later edits): one form, one Account row. Validation
// failures bounce back to /setup with the message in the query string so the
// page needs no client-side state; success lands on the dashboard.

function fieldStr(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

function fieldInt(
  formData: FormData,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = Number(fieldStr(formData, name));
  if (!Number.isInteger(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

const PROFILE_URL_PATTERN =
  /^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#]+\/?$/i;

export async function saveSetup(formData: FormData): Promise<void> {
  const name = fieldStr(formData, "name");
  const linkedinProfileUrl = fieldStr(formData, "linkedinProfileUrl").replace(
    /\?.*$/,
    ""
  );
  const icpDescription = fieldStr(formData, "icpDescription");
  const coreTopic = fieldStr(formData, "coreTopic");
  const scoringTweaks = fieldStr(formData, "scoringTweaks");
  const maxPostsPerRun = fieldInt(formData, "maxPostsPerRun", 5, 1, 20);
  const backfillMonths = fieldInt(formData, "backfillMonths", 0, 0, 24);

  let error: string | null = null;
  if (!name) error = "Your name is required.";
  else if (!PROFILE_URL_PATTERN.test(linkedinProfileUrl))
    error =
      "The LinkedIn profile URL should look like https://www.linkedin.com/in/your-name/";
  else if (icpDescription.length < 20)
    error =
      "Describe your ideal client in at least a sentence or two — relevance scoring uses this text as its entire rubric.";
  else if (!coreTopic) error = "The core topic is required.";

  if (error) {
    redirect(`/setup?error=${encodeURIComponent(error)}`);
  }

  const data = {
    name,
    linkedinProfileUrl,
    icpDescription,
    coreTopic,
    scoringTweaks: scoringTweaks || null,
    maxPostsPerRun,
    backfillMonths,
  };

  const existing = await getAccount();
  if (existing) {
    await db.account.update({ where: { id: existing.id }, data });
  } else {
    await db.account.create({ data });
  }

  revalidatePath("/");
  redirect("/");
}
