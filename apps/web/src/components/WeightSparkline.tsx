/** رنگ پایهٔ نمودار (navy-900)، همان رنگ نقشهٔ حرارتی صفحهٔ صندوق */
const INK = '11, 31, 58';

const SPARK_W = 48;
const SPARK_H = 16;
const SPARK_PAD = 2;

const pct = (n: number) => `${n.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪`;

/**
 * نمودار روند کوچک وزن یک نماد در سبد صندوق در ماه‌ها. مثل ستون‌های جدول راست‌به‌چپ، زمان از راست
 * به چپ جلو می‌رود (ماه اول راست، آخرین ماه چپ). ماه بدون داده جا می‌ماند و خط از رویش رد می‌شود.
 */
export function WeightSparkline({ weights, label }: { weights: (number | null)[]; label: string }) {
  const known = weights
    .map((w, i) => ({ w, i }))
    .filter((x): x is { w: number; i: number } => x.w != null);
  if (known.length < 2) {
    return <span className="text-navy-800/30">—</span>;
  }
  const n = weights.length;
  const vals = known.map((k) => k.w);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => SPARK_W - SPARK_PAD - (i / Math.max(1, n - 1)) * (SPARK_W - 2 * SPARK_PAD);
  const y = (w: number) =>
    max === min ? SPARK_H / 2 : SPARK_PAD + (1 - (w - min) / span) * (SPARK_H - 2 * SPARK_PAD);
  const first = known[0].w;
  const last = known[known.length - 1];
  const delta = last.w - first;
  const pts = known.map((k) => `${x(k.i).toFixed(1)},${y(k.w).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${x(last.i).toFixed(1)},${SPARK_H} L${x(known[0].i).toFixed(1)},${SPARK_H} Z`;
  const trendFa = Math.abs(delta) < 0.05 ? 'تقریباً ثابت' : delta > 0 ? 'افزایشی' : 'کاهشی';
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      role="img"
      aria-label={`روند ${label}: ${trendFa}`}
      className="mx-auto block overflow-visible"
    >
      <title>{`روند ماهانه: ${trendFa} (${pct(first)} تا ${pct(last.w)})`}</title>
      <path d={area} fill={`rgba(${INK},0.1)`} />
      <path
        d={line}
        fill="none"
        stroke={`rgba(${INK},0.75)`}
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(last.i)} cy={y(last.w)} r={1.8} fill={`rgb(${INK})`} />
    </svg>
  );
}
