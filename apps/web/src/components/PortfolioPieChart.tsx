'use client';

type Slice = { label: string; value: number; color: string };

const COLORS = [
  '#0b1f3a',
  '#16325c',
  '#a8893e',
  '#c4a35a',
  '#4a6741',
  '#6b8f71',
  '#8b4513',
  '#5c6bc0',
  '#00897b',
  '#d84315',
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

export function PortfolioPieChart({
  items,
}: {
  items: Array<{ symbol: string; weightPct: number }>;
}) {
  const slices: Slice[] = items
    .filter((i) => i.weightPct > 0)
    .map((i, idx) => ({
      label: i.symbol,
      value: i.weightPct,
      color: COLORS[idx % COLORS.length],
    }));

  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let angle = 0;
  const paths = slices.map((slice) => {
    const sweep = (slice.value / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    return {
      ...slice,
      d: sweep >= 359.9
        ? `M ${100} ${100} m ${-80} 0 a ${80} ${80} 0 1 0 ${160} 0 a ${80} ${80} 0 1 0 ${-160} 0`
        : arcPath(100, 100, 80, start, end),
    };
  });

  if (slices.length === 0) {
    return <p className="text-sm text-navy-800/50">داده‌ای برای نمودار نیست.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg viewBox="0 0 200 200" className="h-48 w-48 shrink-0" aria-label="نمودار ترکیب سبد">
        {paths.map((p) => (
          <path key={p.label} d={p.d} fill={p.color} stroke="#f7f5f1" strokeWidth={1.5} />
        ))}
      </svg>
      <ul className="grid max-w-md flex-1 grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="truncate font-medium">{s.label}</span>
            <span className="text-navy-800/55">
              {s.value.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
