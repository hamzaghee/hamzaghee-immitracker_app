import {
  barPath,
  fmt,
  niceTicks,
  truncate,
  useTooltip,
  useWidth,
  ChartPlaceholder,
  Tooltip,
} from './primitives.jsx';

/**
 * Bar chart, horizontal or vertical.
 *
 * data: [{ label, value, color?, sub? }]
 * A single-measure chart uses one colour for every bar (slot 1) — a value ramp
 * across nominal categories would double-encode length as hue. Pass an explicit
 * `color` per datum only when the category is a coloured entity elsewhere in
 * the dashboard (e.g. Stream).
 */
export default function BarChart({
  data,
  orientation = 'horizontal',
  color = 'var(--series-1)',
  valueSuffix = '',
  gutter = 130,
  barThickness = 18,
  bandGap = 10,
  height,
}) {
  const [ref, width] = useWidth();
  const { tip, show, hide } = useTooltip();

  const max = Math.max(0, ...data.map((d) => d.value));
  const { ticks, max: axisMax } = niceTicks(max);

  if (!width) {
    const reserved =
      orientation === 'horizontal' ? data.length * (barThickness + bandGap) + 30 : (height || 240) + 46;
    return <ChartPlaceholder innerRef={ref} height={reserved} />;
  }

  if (orientation === 'horizontal') {
    const band = barThickness + bandGap;
    const plotH = data.length * band;
    const padTop = 6;
    const axisH = 24;
    const h = plotH + padTop + axisH;
    // Never let the label gutter take more than ~42% of a narrow card; labels
    // truncate instead, and the full text stays in the tooltip and table view.
    const g = Math.max(48, Math.min(gutter, width * 0.42));
    const plotW = Math.max(60, width - g - 52);
    const scale = (v) => (axisMax ? (v / axisMax) * plotW : 0);

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
              <text
                className="axis-label"
                x={g + scale(t)}
                y={padTop + plotH + 15}
                textAnchor="middle"
              >
                {fmt(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const y = padTop + i * band + bandGap / 2;
            const w = scale(d.value);
            return (
              <g key={d.label}>
                <text className="cat-label" x={g - 10} y={y + barThickness / 2 + 4} textAnchor="end">
                  {truncate(d.label, Math.max(6, Math.floor(g / 7)))}
                  <title>{d.label}</title>
                </text>
                <path d={barPath(g, y, w, barThickness, 4, 'right')} fill={d.color || color} />
                <text className="value-label" x={g + w + 7} y={y + barThickness / 2 + 4}>
                  {fmt(d.value)}
                  {valueSuffix}
                </text>
                <rect
                  className="hit"
                  x={g}
                  y={padTop + i * band}
                  width={Math.max(plotW, 1)}
                  height={band}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                    show(e.clientX - r.left, e.clientY - r.top, d.label, `${fmt(d.value)}${valueSuffix}`, d.sub);
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

  // vertical
  const plotH = height || 240;
  const axisW = 42;
  const labelH = 46;
  const h = plotH + labelH;
  const plotW = Math.max(60, width - axisW - 12);
  const band = data.length ? plotW / data.length : plotW;
  const bw = Math.max(6, Math.min(barThickness * 2, band - 8));
  const scale = (v) => (axisMax ? (v / axisMax) * plotH : 0);

  return (
    <div className="chart-wrap" ref={ref}>
      <svg className="chart" width={width} height={h} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={axisW}
              x2={axisW + plotW}
              y1={plotH - scale(t)}
              y2={plotH - scale(t)}
              stroke={t === 0 ? 'var(--baseline)' : 'var(--gridline)'}
              strokeWidth="1"
            />
            <text className="axis-label" x={axisW - 8} y={plotH - scale(t) + 4} textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = axisW + i * band + (band - bw) / 2;
          const bh = scale(d.value);
          return (
            <g key={d.label}>
              <path d={barPath(x, plotH - bh, bw, bh, 4, 'top')} fill={d.color || color} />
              <text
                className="cat-label"
                x={axisW + i * band + band / 2}
                y={plotH + 16}
                textAnchor="end"
                transform={`rotate(-35 ${axisW + i * band + band / 2} ${plotH + 16})`}
              >
                {truncate(d.label, 16)}
                <title>{d.label}</title>
              </text>
              <rect
                className="hit"
                x={axisW + i * band}
                y={0}
                width={band}
                height={plotH}
                onMouseMove={(e) => {
                  const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                  show(e.clientX - r.left, e.clientY - r.top, d.label, `${fmt(d.value)}${valueSuffix}`, d.sub);
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
