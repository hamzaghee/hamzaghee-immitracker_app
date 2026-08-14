import { barPath, fmt, niceTicks, useTooltip, useWidth, ChartPlaceholder, Tooltip } from './primitives.jsx';

/**
 * Grouped vertical bars — longest vs shortest case per programme.
 *
 * All programmes are always shown so the chart stays a comparison; the selected
 * one is emphasised and the rest recede. Colour is not the only cue: the
 * selected label is also bolded, and every bar is directly value-labelled.
 *
 * data: [{ label, highlighted, values: [{ name, value }] }]
 */
export default function GroupedBarChart({ data, height = 240, suffix = 'd', anySelected = false }) {
  const [ref, width] = useWidth();
  const { tip, show, hide } = useTooltip();

  const axisW = 46;
  const padTop = 18;
  const labelH = 46;

  if (!width) return <ChartPlaceholder innerRef={ref} height={padTop + height + labelH} />;
  if (!data?.length) return <p className="empty-note">No data for this selection.</p>;

  const plotW = Math.max(60, width - axisW - 14);
  const all = data.flatMap((g) => g.values.map((v) => v.value)).filter((v) => v != null);
  const { ticks, max } = niceTicks(Math.max(0, ...all));
  const band = plotW / data.length;
  const barW = Math.max(10, Math.min(34, (band - 26) / 2));
  const y = (v) => padTop + height - (max ? (v / max) * height : 0);

  // Slot 2 = longest, slot 1 = shortest; muted when another programme is selected.
  const colorFor = (grp, i) => {
    if (anySelected && !grp.highlighted) return 'var(--baseline)';
    return i === 0 ? 'var(--series-2)' : 'var(--series-1)';
  };

  return (
    <div className="chart-wrap" ref={ref}>
      <svg className="chart" width={width} height={padTop + height + labelH} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={axisW}
              x2={axisW + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? 'var(--baseline)' : 'var(--gridline)'}
              strokeWidth="1"
            />
            <text className="axis-label" x={axisW - 8} y={y(t) + 4} textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}

        {data.map((grp, i) => {
          const cx = axisW + i * band + band / 2;
          return (
            <g key={grp.label}>
              {grp.values.map((v, j) => {
                if (v.value == null) return null;
                // 2px gap between the pair rather than a stroke border.
                const bx = cx - barW - 1 + j * (barW + 2);
                const bh = padTop + height - y(v.value);
                return (
                  <g key={v.name}>
                    <path d={barPath(bx, y(v.value), barW, bh, 4, 'top')} fill={colorFor(grp, j)} />
                    <text className="value-label" x={bx + barW / 2} y={y(v.value) - 6} textAnchor="middle">
                      {fmt(v.value)}
                      {suffix}
                    </text>
                  </g>
                );
              })}
              <text
                className="cat-label"
                x={cx}
                y={padTop + height + 18}
                textAnchor="middle"
                style={{ fontWeight: grp.highlighted ? 650 : 400 }}
              >
                {grp.label}
              </text>
              <rect
                className="hit"
                x={axisW + i * band}
                y={0}
                width={band}
                height={padTop + height}
                onMouseMove={(e) => {
                  const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                  const parts = grp.values
                    .filter((v) => v.value != null)
                    .map((v) => `${v.name} ${fmt(v.value)}${suffix}`)
                    .join(' · ');
                  show(e.clientX - r.left, e.clientY - r.top, grp.label, parts);
                }}
                onMouseLeave={hide}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
