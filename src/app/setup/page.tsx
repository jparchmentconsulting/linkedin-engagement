import Header from "@/components/Header";
import { getAccount } from "@/lib/account";
import { saveSetup } from "@/lib/setupActions";

export const metadata = { title: "Setup · LinkedIn Engagement" };

// First-run setup, and the one place to refine it later. The ICP written here
// is the entire scoring rubric, so the guidance next to the field matters as
// much as the field.
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [account, { error }] = await Promise.all([getAccount(), searchParams]);
  const firstRun = account == null;

  return (
    <>
      <Header accountName={account?.name} />
      <main id="main" className="wrap">
        <h1>{firstRun ? "Welcome" : "Profile & ICP"}</h1>
        <p className="sub">
          {firstRun
            ? "Two minutes of setup, then the dashboard is yours. To change any of it later, come back to this page at /setup."
            : "Scoring reads this on every run, so changes here apply from your next run."}
        </p>

        <form action={saveSetup} className="card full" style={{ maxWidth: 760 }}>
          {error && (
            <div className="error" role="alert" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}

          <h2>About you</h2>
          <div className="field">
            <label htmlFor="name">Your name (or business name)</label>
            <input
              id="name"
              name="name"
              required
              defaultValue={account?.name ?? ""}
              placeholder="Jordan Rivera / Rivera Coaching"
            />
          </div>
          <div className="field">
            <label htmlFor="linkedinProfileUrl">Your LinkedIn profile URL</label>
            <input
              id="linkedinProfileUrl"
              name="linkedinProfileUrl"
              required
              type="url"
              defaultValue={account?.linkedinProfileUrl ?? ""}
              placeholder="https://www.linkedin.com/in/your-name/"
            />
            <p className="note" style={{ marginTop: 6 }}>
              Runs pull the posts from this profile and capture everyone who
              engaged with them.
            </p>
          </div>

          <h2 style={{ marginTop: 20 }}>What a good lead looks like</h2>
          <div className="field">
            <label htmlFor="icpDescription">Ideal client profile</label>
            <textarea
              id="icpDescription"
              name="icpDescription"
              required
              rows={4}
              defaultValue={account?.icpDescription ?? ""}
              placeholder="Self-employed coaches, consultants, and service providers who sell to other businesses. Not corporate employees, not students."
            />
            <p className="note" style={{ marginTop: 6 }}>
              This text is the entire scoring rubric. Describe your ideal
              client in terms visible on a LinkedIn profile (role, niche,
              seniority), and name any exclusions explicitly. Avoid invisible
              traits like revenue or goals. The scorer can&apos;t see those,
              and they drag every score down.
            </p>
          </div>
          <div className="field">
            <label htmlFor="coreTopic">Your core topic</label>
            <input
              id="coreTopic"
              name="coreTopic"
              required
              defaultValue={account?.coreTopic ?? ""}
              placeholder="AI workflows for coaches and consultants"
            />
            <p className="note" style={{ marginTop: 6 }}>
              Warmth scoring gives a bump to people who engage with posts on
              this topic, not just any post.
            </p>
          </div>
          <div className="field">
            <label htmlFor="scoringTweaks">Scoring notes (optional)</label>
            <textarea
              id="scoringTweaks"
              name="scoringTweaks"
              rows={2}
              defaultValue={account?.scoringTweaks ?? ""}
              placeholder="Treat marketing-agency owners as a partial fit, not strong."
            />
            <p className="note" style={{ marginTop: 6 }}>
              Extra instructions passed to the scorer on every run, for
              adjustments that don&apos;t belong in the ICP itself.
            </p>
          </div>

          <h2 style={{ marginTop: 20 }}>Run settings</h2>
          <div className="detail-grid">
            <div className="field">
              <label htmlFor="maxPostsPerRun">Posts per run</label>
              <input
                id="maxPostsPerRun"
                name="maxPostsPerRun"
                type="number"
                min={1}
                max={20}
                defaultValue={account?.maxPostsPerRun ?? 5}
              />
              <p className="note" style={{ marginTop: 6 }}>
                Each post is one paid engager scrape on your Apify key, so this
                bounds a run&apos;s cost.
              </p>
            </div>
            <div className="field">
              <label htmlFor="backfillMonths">
                Backfill history (months, 0 = off)
              </label>
              <input
                id="backfillMonths"
                name="backfillMonths"
                type="number"
                min={0}
                max={24}
                defaultValue={account?.backfillMonths ?? 0}
              />
              <p className="note" style={{ marginTop: 6 }}>
                Set this for your first run to reach back through your post
                history (up to 50 posts). It switches itself off after that
                run finishes.
              </p>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <button className="btn" type="submit">
              {firstRun ? "Save and open the dashboard" : "Save changes"}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
