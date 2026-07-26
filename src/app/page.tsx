import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import LocalDate from "@/components/LocalDate";
import LeadsTable from "@/components/LeadsTable";
import RunPanel from "@/components/RunPanel";
import type { RunGate } from "@/components/RunPanel";
import { getAccount } from "@/lib/account";
import { getAccountData } from "@/lib/data";
import { failStaleRuns } from "@/lib/pipeline";
import { buildLeadViews } from "@/lib/views";

export const metadata = { title: "Dashboard · LinkedIn Engagement" };

// The dashboard reads the database on every request; never prerender it.
export const dynamic = "force-dynamic";

export default async function Home() {
  // First run: no profile yet, so the setup screen comes first.
  const accountRow = await getAccount();
  if (!accountRow) redirect("/setup");

  await failStaleRuns(accountRow.id);
  const data = await getAccountData(accountRow.id);
  if (!data) redirect("/setup");
  const { account, people, events, posts, runs } = data;

  const scored = people.filter((person) => person.relevanceScore != null);
  const leads = buildLeadViews(people, events, posts);
  const flagged = leads.filter(
    (lead) => lead.flagged && !lead.dismissed && !lead.snoozed
  ).length;

  const gate: RunGate = {
    keysConfigured: Boolean(
      process.env.APIFY_TOKEN && process.env.ANTHROPIC_API_KEY
    ),
  };

  return (
    <>
      <Header accountName={account.name} />
      <main id="main" className="wrap">
        <h1>Your Leads</h1>
        <p className="sub">
          {account.name}. Snapshot as of <LocalDate />.{" "}
          <Link href="/setup">Edit profile &amp; ICP</Link>
        </p>

        {people.length === 0 ? (
          <>
            <div className="card full" style={{ marginBottom: 18 }}>
              <h2>Welcome</h2>
              <p style={{ fontSize: 14 }}>
                Your dashboard is ready. Click <b>Run My Posts</b> below for
                your first run: your posts get synced, everyone who engaged is
                captured, and each person is scored against your ideal client
                profile. Your leads accumulate here from then on.
              </p>
              <div className="note">
                Scoring runs on your own API keys. If the Run button is
                disabled, copy <code>.env.example</code> to <code>.env</code>,
                add your Apify and Anthropic keys, and restart the app. The
                README walks through it.
              </div>
            </div>
            <RunPanel runs={runs} gate={gate} />
          </>
        ) : (
          <>
            {/* Contact now counts active flagged leads, the same flag the
                table's 🚩 filter shows, so the numbers always agree. */}
            <div className="kpis">
              <div className="kpi flag">
                <div className="l">Contact now</div>
                <div className="n">{flagged}</div>
                <div className="d">
                  Strong fit and warm; the 🚩 filter below shows them
                </div>
              </div>
              <div className="kpi">
                <div className="l">Scored leads</div>
                <div className="n">{scored.length}</div>
                <div className="d">Across {posts.length} synced posts</div>
              </div>
              <div className="kpi">
                <div className="l">Total leads</div>
                <div className="n">{people.length}</div>
                <div className="d">
                  {scored.length} scored, {people.length - scored.length}{" "}
                  awaiting enrichment
                </div>
              </div>
            </div>

            <LeadsTable leads={leads} />

            <RunPanel runs={runs} gate={gate} />

          </>
        )}
      </main>
    </>
  );
}
