"use client";

import { useState } from "react";
import Avatar from "./Avatar";
import LeadDetail from "./LeadDetail";
import Pill from "./Pill";
import ScoreBar from "./ScoreBar";
import type { LeadView } from "@/lib/views";
import type { FitTier } from "@/lib/types";

const tierOptions: { value: FitTier; label: string }[] = [
  { value: "STRONG_FIT", label: "Strong fit" },
  { value: "POSSIBLE", label: "Possible" },
  { value: "NOT_A_FIT", label: "Not a fit" },
  { value: "UNSCORED", label: "Unscored" },
];

export default function LeadsTable({ leads }: { leads: LeadView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<"ALL" | FitTier>("ALL");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  // Dismissed leads stay out of sight (and out of the count) unless asked
  // for; that's what keeps "not a fit" clicks meaningful. Snoozed leads stay
  // visible here, marked with a pill.
  const [showDismissed, setShowDismissed] = useState(false);
  // Chunk the list so it opens on the highest-priority leads instead of one
  // long scroll. Leads are already priority-sorted, so the first page is always
  // the ones worth acting on; bump to 100 or All to go deeper.
  const [pageSize, setPageSize] = useState<50 | 100 | "ALL">(50);

  const visible = showDismissed
    ? leads
    : leads.filter((lead) => !lead.dismissed);
  const dismissedCount = leads.length - visible.length;

  const q = query.trim().toLowerCase();
  const matches = (lead: LeadView) =>
    (q === "" ||
      lead.name.toLowerCase().includes(q) ||
      (lead.companyName?.toLowerCase().includes(q) ?? false) ||
      (lead.headline?.toLowerCase().includes(q) ?? false)) &&
    (tier === "ALL" || lead.tier === tier) &&
    (!flaggedOnly || lead.flagged);

  const filtered = visible.filter(matches);
  const scored = filtered
    .filter((lead) => lead.relevanceScore != null)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const stubs = filtered.filter((lead) => lead.relevanceScore == null);
  const filtering = q !== "" || tier !== "ALL" || flaggedOnly;

  // Scored (priority-ranked) first, then unscored stubs, chunked to the page
  // size. Slicing the combined list keeps the boundary honest: "Showing 50 of
  // 424" counts everything below the cut, stubs included.
  const ordered = [...scored, ...stubs];
  const limit = pageSize === "ALL" ? ordered.length : pageSize;
  const shown = ordered.slice(0, limit);
  const hiddenByPage = ordered.length - shown.length;

  const toggle = (id: string) => setOpenId(openId === id ? null : id);
  const clear = () => {
    setQuery("");
    setTier("ALL");
    setFlaggedOnly(false);
  };

  return (
    <div className="card full">
      <h2>
        All leads{" "}
        <span className="count-chip">
          {filtering
            ? `${filtered.length} of ${visible.length}`
            : visible.length}
        </span>
      </h2>
      <div className="filters">
        <input
          type="search"
          placeholder="Search name, company, or headline"
          aria-label="Search leads"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Filter by fit tier"
          value={tier}
          onChange={(e) => setTier(e.target.value as "ALL" | FitTier)}
        >
          <option value="ALL">All tiers</option>
          {tierOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Rows to show"
          value={String(pageSize)}
          onChange={(e) =>
            setPageSize(
              e.target.value === "ALL"
                ? "ALL"
                : (Number(e.target.value) as 50 | 100)
            )
          }
        >
          <option value="50">Show 50</option>
          <option value="100">Show 100</option>
          <option value="ALL">Show all</option>
        </select>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
          />
          🚩 Flagged only
        </label>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
          />
          Show dismissed
        </label>
        {filtering && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={clear}
          >
            Clear
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table aria-label="All leads, scored first, ranked by priority">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Expand</span>
              </th>
              <th scope="col">Lead</th>
              <th scope="col">Tier</th>
              <th scope="col">
                <span
                  className="col-tip"
                  title="How well this lead matches your ideal-client profile. Drives the tier: Strong Fit, Possible, or Not a Fit."
                >
                  Relevance
                </span>
              </th>
              <th scope="col">
                <span
                  className="col-tip"
                  title="How engaged they are: comments and reactions across your posts. Comments count most; a single like barely moves it."
                >
                  Warmth
                </span>
              </th>
              <th scope="col">
                <span
                  className="col-tip"
                  title="Overall ranking. Relevance leads; warmth breaks ties within a tier."
                >
                  Priority
                </span>
              </th>
              <th scope="col" className="hide-sm">
                Company
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((lead) => (
              <RowPair
                key={lead.id}
                lead={lead}
                open={openId === lead.id}
                onToggle={() => toggle(lead.id)}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="note">
                  No leads match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        {hiddenByPage > 0 && (
          <>
            Showing the top {shown.length} of {ordered.length}. Use{" "}
            <b>Show 100</b> or <b>Show all</b> above, or filter, to see the rest.{" "}
          </>
        )}
        {stubs.length > 0 && (
          <>
            Includes {stubs.length} unscored follower stub
            {stubs.length === 1 ? "" : "s"} awaiting enrichment and scoring.{" "}
          </>
        )}
        {dismissedCount > 0 && (
          <>
            {dismissedCount} dismissed lead{dismissedCount === 1 ? "" : "s"}{" "}
            hidden; tick Show dismissed to bring them into view.{" "}
          </>
        )}
        Open any row for the full profile, AI assessment, and engagement
        history.
      </div>
    </div>
  );
}

function RowPair({
  lead,
  open,
  onToggle,
}: {
  lead: LeadView;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="lead-row" onClick={onToggle}>
        <td>
          <button
            type="button"
            className={`chev-btn${open ? " open" : ""}`}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} details for ${lead.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <span className="chev" aria-hidden>
              ▶
            </span>
          </button>
        </td>
        <td>
          <span className="lead-id">
            <Avatar name={lead.name} />
            <span className="nm">{lead.name}</span>
            {lead.dismissed && <span className="pill t-no">Dismissed</span>}
            {!lead.dismissed && lead.snoozed && (
              <span className="pill t-un">Snoozed</span>
            )}
          </span>
        </td>
        <td>
          <Pill tier={lead.tier} />
        </td>
        <td>
          <ScoreBar value={lead.relevanceScore} label="Relevance" />
        </td>
        <td>
          <ScoreBar value={lead.warmthScore} label="Warmth" />
        </td>
        <td>{lead.priority != null ? <b>{lead.priority}</b> : "–"}</td>
        <td className="hide-sm">{lead.companyName ?? "–"}</td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={7}>
            <LeadDetail lead={lead} />
          </td>
        </tr>
      )}
    </>
  );
}
