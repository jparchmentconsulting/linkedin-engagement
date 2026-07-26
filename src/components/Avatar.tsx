// Initials avatar with a deterministic color per name, so the same lead
// always renders the same hue across tables and sessions.

const palette = [
  "#2e7d5b",
  "#3b6ea5",
  "#b07a1b",
  "#7c5cbf",
  "#b05c7a",
  "#4a8f8c",
  "#8a6d3b",
  "#5b7d46",
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return palette[h % palette.length];
}

export default function Avatar({
  name,
  size = 30,
}: {
  name: string;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        background: hue(name),
        fontSize: Math.round(size * 0.37),
      }}
    >
      {initials(name)}
    </span>
  );
}
