/**
 * Static SVG chart builders for the exported report.
 *
 * These mirror the React components but emit strings: no tooltips, no hover,
 * no interactivity — correct for a downloadable artifact. Geometry and palette
 * come from shared/chartGeometry.js so the two renderers cannot diverge.
 *
 * Every builder takes the palette as an option so an export can be rendered in
 * light or dark to match the theme the user was viewing.
 *
 * Every bar carries a direct value label. That is not decoration: three of the
 * light-mode series colours sit below 3:1 contrast against the surface, and the
 * relief rule requires the values be readable without relying on colour.
 */

import { barPath, niceTicks, truncate, fmt, esc, PALETTE } from '../../../shared/chartGeometry.js';

const text = (P, x, y, s, anchor = 'middle', fill = P.textMuted, extra = '') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="11" font-family="inherit"${extra}>${esc(s)}</text>`;

/**
 * Horizontal bars. data: [{ label, value, color?, }]
 */
export function hBar(data, { width = 620, gutter = 150, thickness = 18, gap = 10, suffix = '', palette = PALETTE.light } = {}) {
  const P = palette;
  if (!data.length) return `<p class="empty">No data for this selection.</p>`;
  const band = thickness + gap;
  const padTop = 6;
  const axisH = 26;
  const plotH = data.length * band;
  const h = plotH + padTop + axisH;
  const g = Math.max(60, Math.min(gutter, width * 0.42));
  const plotW = Math.max(60, width - g - 62);
  const { ticks, max } = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const sx = (v) => (max ? (v / max) * plotW : 0);

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${g + sx(t)}" x2="${g + sx(t)}" y1="${padTop}" y2="${padTop + plotH}" stroke="${
          t === 0 ? P.baseline : P.gridline
        }" stroke-width="1"/>` + text(P, g + sx(t), padTop + plotH + 16, fmt(t))
    )
    .join('');

  const bars = data
    .map((d, i) => {
      const y = padTop + i * band + gap / 2;
      const w = sx(d.value);
      return (
        text(P, g - 10, y + thickness / 2 + 4, truncate(d.label, Math.max(8, Math.floor(g / 6.5))), 'end', P.textSecondary) +
        `<path d="${barPath(g, y, w, thickness, 4, 'right')}" fill="${d.color || P.series[0]}"/>` +
        text(P, g + w + 7, y + thickness / 2 + 4, `${fmt(d.value)}${suffix}`, 'start', P.textSecondary)
      );
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${h}" width="100%" height="${h}" role="img">${grid}${bars}</svg>`;
}

/** Single-series line over time. data: [{ label, value }] */
export function lineChart(data, { width = 620, height = 210, suffix = '', palette = PALETTE.light, gradientId = 'lg' } = {}) {
  const P = palette;
  if (!data.length) return `<p class="empty">No data for this selection.</p>`;
  const axisW = 46;
  // Room for the top tick label and the peak's direct label — see the matching
  // note in web/src/components/LineChart.jsx; below ~22 the peak clips.
  const padTop = 24;
  const labelH = 52;
  const plotW = Math.max(60, width - axisW - 16);
  const { ticks, max } = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const x = (i) => (data.length <= 1 ? axisW + plotW / 2 : axisW + (i / (data.length - 1)) * plotW);
  const y = (v) => padTop + height - (max ? (v / max) * height : 0);
  const baseY = padTop + height;

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${axisW}" x2="${axisW + plotW}" y1="${y(t)}" y2="${y(t)}" stroke="${
          t === 0 ? P.baseline : P.gridline
        }" stroke-width="1"/>` + text(P, axisW - 8, y(t) + 4, fmt(t), 'end')
    )
    .join('');

  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const area = `${path} L${x(data.length - 1)},${baseY} L${x(0)},${baseY} Z`;
  const every = Math.max(1, Math.ceil(data.length / 12));
  const labels = data
    .map((d, i) =>
      i % every === 0
        ? text(P, x(i), baseY + 16, d.label, 'end', P.textSecondary, ` transform="rotate(-40 ${x(i)} ${baseY + 16})"`)
        : ''
    )
    .join('');

  const peak = data.reduce((a, b, i) => (b.value > data[a].value ? i : a), 0);

  return `<svg viewBox="0 0 ${width} ${padTop + height + labelH}" width="100%" height="${padTop + height + labelH}" role="img">
    <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${P.series[0]}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${P.series[0]}" stop-opacity="0.01"/>
    </linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#${gradientId})"/>
    <path d="${path}" fill="none" stroke="${P.series[0]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${labels}${text(P, x(peak), y(data[peak].value) - 10, `${fmt(data[peak].value)}${suffix}`, 'middle', P.textSecondary)}</svg>`;
}

/** Part-to-whole donut with a 2px surface gap between segments. */
export function donut(data, { size = 200, thickness = 34, centerLabel = 'cases', palette = PALETTE.light } = {}) {
  const P = palette;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return `<p class="empty">No data for this selection.</p>`;
  const cx = size / 2;
  const cy = size / 2;
  const rO = size / 2 - 2;
  const rI = rO - thickness;
  const gapAngle = 2 / ((rO + rI) / 2);

  let cursor = -Math.PI / 2;
  const arcs = data
    .map((d) => {
      const sweep = (d.value / total) * Math.PI * 2;
      const a0 = cursor + gapAngle / 2;
      const a1 = Math.max(a0, cursor + sweep - gapAngle / 2);
      cursor += sweep;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const [x0, y0] = p(rO, a0);
      const [x1, y1] = p(rO, a1);
      const [x2, y2] = p(rI, a1);
      const [x3, y3] = p(rI, a0);
      return `<path d="M${x0},${y0} A${rO},${rO} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rI},${rI} 0 ${large} 0 ${x3},${y3} Z" fill="${d.color}"/>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${arcs}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="${P.textPrimary}" font-size="22" font-weight="650" font-family="inherit">${fmt(total)}</text>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" fill="${P.textMuted}" font-size="11" font-family="inherit">${esc(centerLabel)}</text></svg>`;
}

/**
 * Grouped vertical bars — the longest/shortest comparison.
 * data: [{ label, values: [{ name, value, color }], highlighted }]
 */
export function groupedBar(data, { width = 620, height = 240, suffix = 'd', palette = PALETTE.light } = {}) {
  const P = palette;
  if (!data.length) return `<p class="empty">No data for this selection.</p>`;
  const axisW = 46;
  const padTop = 18;
  const labelH = 48;
  const plotW = Math.max(60, width - axisW - 16);
  const all = data.flatMap((g) => g.values.map((v) => v.value)).filter((v) => v != null);
  const { ticks, max } = niceTicks(Math.max(0, ...all));
  const band = plotW / data.length;
  const barW = Math.max(10, Math.min(34, (band - 24) / 2));
  const y = (v) => padTop + height - (max ? (v / max) * height : 0);

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${axisW}" x2="${axisW + plotW}" y1="${y(t)}" y2="${y(t)}" stroke="${
          t === 0 ? P.baseline : P.gridline
        }" stroke-width="1"/>` + text(P, axisW - 8, y(t) + 4, fmt(t), 'end')
    )
    .join('');

  const groups = data
    .map((grp, i) => {
      const cx = axisW + i * band + band / 2;
      const bars = grp.values
        .map((v, j) => {
          if (v.value == null) return '';
          // 2px gap between the pair rather than a stroke border.
          const bx = cx - barW - 1 + j * (barW + 2);
          const bh = padTop + height - y(v.value);
          return (
            `<path d="${barPath(bx, y(v.value), barW, bh, 4, 'top')}" fill="${v.color}"/>` +
            text(P, bx + barW / 2, y(v.value) - 6, `${fmt(v.value)}${suffix}`, 'middle', P.textSecondary)
          );
        })
        .join('');
      return (
        bars +
        text(P, cx, padTop + height + 18, grp.label, 'middle', P.textSecondary, grp.highlighted ? ' font-weight="650"' : '')
      );
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${padTop + height + labelH}" width="100%" height="${padTop + height + labelH}" role="img">${grid}${groups}</svg>`;
}
