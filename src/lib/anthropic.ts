import "server-only";
import type { RelevanceSignals, WarmthSignals } from "./scoring";

// One structured Anthropic call per person at scoring time: returns boolean
// signal detections + a rationale string. The model NEVER returns a numeric
// score — the deterministic point tables in scoring.ts do the arithmetic on
// these booleans, so scores are reproducible.

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// Last line of defense before the API. Scraped text can carry NUL bytes and
// lone UTF-16 surrogates (a broken half of an emoji). JSON.stringify emits a
// lone surrogate as a bare \uXXXX escape, and Anthropic's JSON parser rejects
// the body with a 400 ("no low surrogate in string"), which fails scoring for
// everyone in the batch. Ingestion sanitizes stored fields, but one bad
// character slipping through (or arriving via the ICP) shouldn't sink a run, so
// every prompt is cleaned here regardless of where its text came from.
function cleanPrompt(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

// The model occasionally spills its tool-call wrapper into a returned string
// value (a rationale ending in "</rationale></invoke>"). Strip trailing
// closing-tag fragments from every model string before anything persists or
// displays it.
function stripTagSpill(text: string): string {
  return text.replace(/(\s*<\/[\w-]+>)+\s*$/, "").trim();
}

export interface PersonAssessment
  extends RelevanceSignals,
    WarmthSignals {
  rationale: string;
  companyName: string | null;
  companyIndustry: string | null;
  companyNiche: string | null;
}

const assessmentSchema = {
  type: "object",
  properties: {
    coreFit: {
      type: "string",
      enum: ["STRONG", "PARTIAL", "NONE"],
      description:
        "How well this person matches the IDEAL CLIENT PROFILE above, judged ONLY against that description. STRONG = clearly the kind of client described. PARTIAL = plausibly a fit, some signals line up but it is not clear-cut. NONE = does not match the described ideal client. Do not import any outside idea of a 'good lead'; the profile is the whole rubric.",
    },
    isDisqualified: {
      type: "boolean",
      description:
        "True ONLY if this person matches an exclusion explicitly stated in the ideal client profile (e.g. the profile says 'not corporate employees' and this is one). Do NOT invent exclusions the profile did not state. In particular, never exclude someone just for being an established operator, a peer, or a competitor unless the profile explicitly says to exclude them.",
    },
    hasSubstantiveComment: {
      type: "boolean",
      description:
        "At least one comment adds a real thought — not 'great post', 'love this', or emoji-only",
    },
    engagedWithCoreTopic: {
      type: "boolean",
      description:
        "At least one engaged post is about the profile owner's core topic",
    },
    rationale: {
      type: "string",
      description:
        "2-3 sentences on why this person is a STRONG, PARTIAL, or NONE match for the ideal client profile, citing specifics from their profile and how they engaged. If disqualified, name the exact stated exclusion they hit. Do not use point/score language.",
    },
    companyName: {
      type: ["string", "null"],
      description: "Their company/practice name if evident, else null",
    },
    companyIndustry: { type: ["string", "null"] },
    companyNiche: {
      type: ["string", "null"],
      description: "One line on what the company actually does, else null",
    },
  },
  required: [
    "coreFit",
    "isDisqualified",
    "hasSubstantiveComment",
    "engagedWithCoreTopic",
    "rationale",
    "companyName",
    "companyIndustry",
    "companyNiche",
  ],
} as const;

export interface AssessmentInput {
  icpDescription: string;
  coreTopic: string;
  scoringTweaks: string | null;
  person: {
    name: string;
    headline: string | null;
    aboutSummary: string | null;
    followerCount: number | null;
    premiumProfile: boolean;
  };
  events: Array<{
    eventType: string;
    postTitleHook: string | null;
    contentOfComment: string | null;
    date: string;
  }>;
}

export async function assessPerson(
  input: AssessmentInput
): Promise<PersonAssessment> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const prompt = [
    `You are the scoring analyst for a LinkedIn lead workflow. Assess ONE person; deterministic code computes the numeric scores from your answers, so answer strictly by the definitions given.`,
    ``,
    `The ideal client profile below is your ENTIRE rubric for relevance. Judge fit against it and nothing else. Do not carry in any generic notion of a "good lead": whether someone is a coach, has a program, runs solo, or sounds busy only matters if this profile says it does. Only treat a person as disqualified when the profile explicitly names an exclusion they hit; never exclude someone just for being an established operator, a peer, or a competitor unless the profile says to.`,
    ``,
    `Score only on what you can actually see: their profile, headline, company, and the posts they engaged with. Client profiles often describe things you cannot observe from LinkedIn — someone's revenue, goals, mindset, or whether they are "stuck", "ready to invest", or "not yet converting visibility into clients". Do NOT treat missing evidence of those as a reason to lower fit or to withhold a STRONG rating. Judge fit from the observable proxies: their role, niche, seniority, and the topics they engage with. When those match the described client, that is a STRONG fit even though you cannot confirm their private intent. Reserve a lower rating for people whose visible profile genuinely does not match, and disqualification for exclusions you can actually see.`,
    ``,
    `IDEAL CLIENT PROFILE (Relevance is fit to this):`,
    input.icpDescription,
    ``,
    `CORE TOPIC (for engagedWithCoreTopic):`,
    input.coreTopic,
    input.scoringTweaks ? `\nSCORING NOTES:\n${input.scoringTweaks}` : ``,
    ``,
    `THE PERSON:`,
    `Name: ${input.person.name}`,
    `Headline: ${input.person.headline ?? "(none)"}`,
    `Followers: ${input.person.followerCount ?? "unknown"} · Premium: ${input.person.premiumProfile ? "yes" : "no"}`,
    `About: ${input.person.aboutSummary?.slice(0, 1500) ?? "(none)"}`,
    ``,
    `THEIR ENGAGEMENT EVENTS:`,
    input.events.length === 0
      ? `(none)`
      : input.events
          .map(
            (event) =>
              `- ${event.eventType}${event.postTitleHook ? ` on "${event.postTitleHook}"` : ""} (${event.date})${event.contentOfComment ? `: "${event.contentOfComment.slice(0, 400)}"` : ""}`
          )
          .join("\n"),
    ``,
    `Report your assessment with the report_assessment tool.`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      tools: [
        {
          name: "report_assessment",
          description: "Report the detected scoring signals for this person",
          input_schema: assessmentSchema,
        },
      ],
      tool_choice: { type: "tool", name: "report_assessment" },
      messages: [{ role: "user", content: cleanPrompt(prompt) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    content: Array<{ type: string; input?: PersonAssessment }>;
  };
  const toolUse = data.content.find((block) => block.type === "tool_use");
  if (!toolUse?.input) throw new Error("Anthropic returned no tool_use block");
  const out = toolUse.input;
  out.rationale = stripTagSpill(out.rationale);
  if (out.companyName) out.companyName = stripTagSpill(out.companyName);
  if (out.companyIndustry) out.companyIndustry = stripTagSpill(out.companyIndustry);
  if (out.companyNiche) out.companyNiche = stripTagSpill(out.companyNiche);
  return out;
}
