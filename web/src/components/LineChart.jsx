import { useState } from 'react';
import { fmt, niceTicks, useWidth, ChartPlaceholder, Tooltip, useTooltip } from './primitives.jsx';

/**
 * Single-series time line with a crosshair. One series, so no legend box — the
 * card title names it. Every value is also in the table view.
 *
 * data: [{ label, value }] in chronological order.
 */
export default function LineChart({ data, color = 'var(--series-1)', height = 250, valueSuffix = '' }) {
  const [ref, width] = useWidth();
  const { tip, show, hide } = useTooltip();
  const [active, setActive] = useState(null);

  const axisW = 42;
  // Tall enough for the -40deg rotated month labels to sit inside the svg box,
  // so the card never grows a nested scrollbar.
  const labelH = 52;
  // Room for the top tick label *and* the peak's direct label, which sits 10px
  // above the point and carries roughly 8px of ascender above its baseline.
  // When the peak equals the axis maximum it sits at y = padTop, so anything
  // less than ~22 clips it.
  const padTop = 24;
  const plotH = height;
  const plotW = Math.max(60, width - axisW - 14);
  const max = Math.max(0, ...data.map((d) => d.value));
  const { ticks, max: axisMax } = niceTicks(max);

  const x = (i) => (data.length <= 1 ? axisW : axisW + (i / (data.length - 1)) * plotW);
  const y = (v) => padTop + plotH - (axisMax ? (v / axisMax) * plotH : 0);
  const baseY = padTop + plotH;

  if (!width) return <ChartPlaceholder innerRef={ref} height={padTop + plotH + labelH} />;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ');
  const area = data.length
    ? `${line} L${x(data.length - 1)},${baseY} L${x(0)},${baseY} Z`
    : '';

  // Label every nth tick so the axis never collides.
  const every = Math.max(1, Math.ceil(data.length / 12));

  const onMove = (e) => {
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (!data.length) return;
    const ratio = (px - axisW) / (plotW || 1);
    const i = Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))));
    setActive(i);
    show(x(i), y(data[i].value), data[i].label, `${fmt(data[i].value)}${valueSuffix}`);
  };

  const onLeave = () => {
    setActive(null);
    hide();
  };

  return (
    <div className="chart-wrap" ref={ref}>
      <svg
        className="chart"
        width={width}
        height={padTop + plotH + labelH}
        role="img"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
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

        <defs>
          <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {area ? <path d={area} fill="url(#lineFill)" /> : null}
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {data.map((d, i) =>
          i % every === 0 ? (
            <text
              key={d.label}
              className="cat-label"
              x={x(i)}
              y={baseY + 16}
              textAnchor="end"
              transform={`rotate(-40 ${x(i)} ${baseY + 16})`}
            >
              {d.label}
            </text>
          ) : null
        )}

        {active !== null ? (
          <g>
            <line
              x1={x(active)}
              x2={x(active)}
              y1={padTop}
              y2={baseY}
              stroke="var(--baseline)"
              strokeWidth="1"
            />
            {/* 2px surface ring keeps the marker readable over the line */}
            <circle cx={x(active)} cy={y(data[active].value)} r="5" fill={color} stroke="var(--surface-1)" strokeWidth="2" />
          </g>
        ) : null}

        {/* Direct-label the peak only — a number on every point would be chaos. */}
        {data.length
          ? (() => {
              const peak = data.reduce((a, b, i) => (b.value > data[a].value ? i : a), 0);
              return (
                <text className="value-label" x={x(peak)} y={y(data[peak].value) - 10} textAnchor="middle">
                  {fmt(data[peak].value)}
                </text>
              );
            })()
          : null}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
