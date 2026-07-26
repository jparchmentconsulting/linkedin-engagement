"use client";

import "./chartSetup";
import { Bar } from "react-chartjs-2";
import type { PipelineRun } from "@/lib/types";

// Run-over-run view of the pipeline: one bar group per completed run, so a
// growing history reads as a trend instead of an ever-longer table.
export default function RunTrend({ runs }: { runs: PipelineRun[] }) {
  // Chronological order, completed runs only.
  const done = runs
    .filter((run) => run.status === "SUCCEEDED")
    .slice()
    .reverse();

  return (
    <div
      className="chartbox chartbox-sm"
      role="img"
      aria-label="Bar chart: engagements captured and people scored per completed run"
    >
      <Bar
        data={{
          labels: done.map((run) =>
            new Date(run.startedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          ),
          datasets: [
            {
              label: "Engagements captured",
              data: done.map((run) => run.peopleFound ?? 0),
              backgroundColor: "#2e7d5b",
            },
            {
              label: "People scored",
              data: done.map((run) => run.peopleScored ?? 0),
              backgroundColor: "#1f4e3d",
            },
          ],
        }}
        options={{
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
          scales: { y: { beginAtZero: true } },
        }}
      />
    </div>
  );
}
