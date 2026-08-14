import { fmt, useTooltip, useWidth, ChartPlaceholder, Tooltip } from './primitives.jsx';

/**
 * Part-to-whole donut. Capped at 6 segments by the caller; a 2px surface gap
 * separates neighbouring fills instead of a stroke border.
 *
 * data: [{ label, value, color }]
 */
export default function DonutChart({ data, size = 200, thickness = 34, centerLabel = 'total' }) {
  const [ref, width] = useWidth();
  const { tip, show, hide } = useTooltip();

  const total = data.reduce((s, d) => s + d.value, 0);

  if (!width) return <ChartPlaceholder innerRef={ref} height={size} />;

  const dim = Math.min(size, width);
  const cx = dim / 2;
  const cy = dim / 2;
  const rOuter = dim / 2 - 2;
  const rInner = rOuter - thickness;

  // 2px gap expressed as an angle at the mid-radius.
  const gapPx = 2;
  const rMid = (rOuter + rInner) / 2;
  const gapAngle = total ? gapPx / rMid : 0;

  const arc = (a0, a1) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(rOuter, a0);
    const [x1, y1] = p(rOuter, a1);
    const [x2, y2] = p(rInner, a1);
    const [x3, y3] = p(rInner, a0);
    return `M${x0},${y0} A${rOuter},${rOuter} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rInner},${rInner} 0 ${large} 0 ${x3},${y3} Z`;
  };

  let cursor = -Math.PI / 2;
  const segments = data.map((d) => {
    const sweep = total ? (d.value / total) * Math.PI * 2 : 0;
    const a0 = cursor + gapAngle / 2;
    const a1 = cursor + sweep - gapAngle / 2;
    cursor += sweep;
    return { ...d, a0, a1: Math.max(a0, a1), pct: total ? (d.value / total) * 100 : 0 };
  });

  return (
    <div className="chart-wrap" ref={ref}>
      <svg className="chart" width={dim} height={dim} role="img" style={{ margin: '0 auto' }}>
        {segments.map((s) => (
          <path
            key={s.label}
            d={arc(s.a0, s.a1)}
            fill={s.color}
            onMouseMove={(e) => {
              const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
              show(
                e.clientX - r.left,
                e.clientY - r.top,
                s.label,
                `${fmt(s.value)}`,
                `${s.pct.toFixed(1)}% of ${fmt(total)}`
              );
            }}
            onMouseLeave={hide}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" style={{ fill: 'var(--text-primary)', fontSize: 22, fontWeight: 650 }}>
          {fmt(total)}
        </text>
        <text x={cx} y={cy + 15} textAnchor="middle" style={{ fill: 'var(--text-muted)', fontSize: 11 }}>
          {centerLabel}
        </text>
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
