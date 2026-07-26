// Score readout: the number plus a 0–10 fill bar, colored by the same
// bands as Fit Tier (7+ green, 5–6 amber, below gray). The bar itself is
// decorative; the number carries the value for screen readers.

export default function ScoreBar({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  if (value == null) return <>–</>;
  const color =
    value >= 7 ? "var(--green)" : value >= 5 ? "var(--amber)" : "var(--gray)";
  return (
    <span className="scorebar" aria-label={`${label} ${value} out of 10`}>
      <span className="score-num" aria-hidden>
        {value}
      </span>
      <span className="score-track" aria-hidden>
        <span
          className="score-fill"
          style={{ width: `${value * 10}%`, background: color }}
        />
      </span>
    </span>
  );
}
