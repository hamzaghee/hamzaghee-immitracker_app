import { fmt, niceTicks, truncate, useTooltip, useWidth, ChartPlaceholder, Tooltip, SERIES } from './primitives.jsx';

/**
 * Step-by-step bars: one bar per group, one segment per step, with the group's
 * average total printed at the end. The exported report draws the same thing
 * (server/src/report/charts.js, stackedBar).
 *
 * data: [{ label, total, totalCount, segments: [{ id, label, slot, value, count }] }]
 *
 * The segments are step averages over different sets of cases, so they need
 * not add up to the total; the bar shows the steps and the label the total.
 */
export default function StackedBarChart({ data, gutter = 150, barThickness = 18, bandGap = 12 }) {
  const [ref, width] = useWidth();
  const { tip, show, hide } = useTooltip();

  if (!data.length) {
    // Keeps the measured ref attached, so the chart sizes itself if data arrives later.
    return (
      <div className="chart-wrap" ref={ref}>
        <p className="empty-note">No group has enough decided cases for this selection.</p>
      </div>
    );
  }

  const band = barThickness + bandGap;
  if (!width) return <ChartPlaceholder innerRef={ref} height={data.length * band + 30} />;

  const sum = (d) => d.segments.reduce((n, s) => n + (s.value || 0), 0);
  const { ticks, max } = niceTicks(Math.max(0, ...data.map((d) => Math.max(sum(d), d.total || 0))));
  const padTop = 6;
  const plotH = data.length * band;
  const h = plotH + padTop + 24;
  const g = Math.max(48, Math.min(gutter, width * 0.38));
  const plotW = Math.max(60, width - g - 92);
  const scale = (v) => (max ? (v / max) * plotW : 0);

  return (
    <div className="chart-wrap" ref={ref}>
      <svg className="chart" width={width} height={h} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={g + scale(t)}
              x2={g + scale(t)}
              y1={padTop}
              y2={padTop + plotH}
              stroke={t === 0 ? 'var(--baseline)' : 'var(--gridline)'}
              strokeWidth="1"
            />
            <text className="axis-label" x={g + scale(t)} y={padTop + plotH + 15} textAnchor="middle">
              {fmt(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const y = padTop + i * band + bandGap / 2;
          let x = g;
          const segs = d.segments
            .filter((s) => s.value)
            .map((s) => {
              const w = scale(s.value);
              const seg = { ...s, x, w };
              x += w;
              return seg;
            });
          return (
            <g key={d.label}>
              <text className="cat-label" x={g - 10} y={y + barThickness / 2 + 4} textAnchor="end">
                {truncate(d.label, Math.max(6, Math.floor(g / 7)))}
                <title>{d.label}</title>
              </text>
              {segs.map((s) => (
                <rect
                  key={s.id}
                  className="hit-seg"
                  // 1px surface gap between segments rather than a stroke.
                  x={s.x}
                  y={y}
                  width={Math.max(0, s.w - 1)}
                  height={barThickness}
                  fill={SERIES[s.slot]}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                    show(
                      e.clientX - r.left,
                      e.clientY - r.top,
                      `${d.label} · ${s.label}`,
                      `${fmt(Math.round(s.value))} days`,
                      `${fmt(s.count)} cases`
                    );
                  }}
                  onMouseLeave={hide}
                />
              ))}
              <text className="value-label" x={x + 7} y={y + barThickness / 2 + 4}>
                {fmt(Math.round(d.total))}d total
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
