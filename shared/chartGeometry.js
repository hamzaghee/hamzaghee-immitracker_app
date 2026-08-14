/**
 * Chart geometry and palette, shared by the React dashboard and the standalone
 * HTML report generator.
 *
 * Plain ESM with no dependencies so the Node server can import it directly and
 * Vite can bundle it. It exists so the on-screen charts and the exported ones
 * cannot drift: same bar maths, same axis ticks, same colours.
 *
 * The categorical hexes were validated with a colourblind-safety checker in
 * both modes. Do not substitute values here without re-running that check —
 * the slot *ordering* is the CVD-safety mechanism, not decoration.
 */

/* ---------------- palette ---------------- */

export const PALETTE = {
  light: {
    surface: '#fcfcfb',
    page: '#f9f9f7',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    textMuted: '#898781',
    gridline: '#e1e0d9',
    baseline: '#c3c2b7',
    border: 'rgba(11,11,11,0.10)',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
    // Recessive fill for the non-selected programmes in the comparison chart.
    muted: '#c3c2b7',
  },
  dark: {
    surface: '#1a1a19',
    page: '#0d0d0d',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    textMuted: '#898781',
    gridline: '#2c2c2a',
    baseline: '#383835',
    border: 'rgba(255,255,255,0.10)',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
    muted: '#4a4a46',
  },
};

/**
 * Stream -> colour slot. Fixed by entity, never by rank, so filtering the data
 * never repaints a stream that survives.
 */
export const STREAM_SLOT = {
  CEC: 0,
  'FSW-Outland': 1,
  'FSW-Inland': 2,
  'PNP-Outland': 3,
  'PNP-Inland': 4,
};

export const streamColorHex = (name, mode = 'light') =>
  PALETTE[mode].series[STREAM_SLOT[name] ?? 0];

/* ---------------- geometry ---------------- */

/** Axis ticks on 1/2/5 x 10^n steps. */
export function niceTicks(max, target = 5) {
  if (!isFinite(max) || max <= 0) return { ticks: [0], max: 1 };
  const rawStep = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, max: top };
}

/**
 * Rect with rounding on the data end only; the baseline end stays square so the
 * mark reads as anchored. Degrades when the bar is shorter than the radius.
 */
export function barPath(x, y, w, h, r = 4, side = 'right') {
  if (w <= 0 || h <= 0) return '';
  if (side === 'right') {
    const rr = Math.max(0, Math.min(r, w, h / 2));
    return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`;
  }
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return `M${x},${y + h} V${y + rr} A${rr},${rr} 0 0 1 ${x + rr},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h} Z`;
}

/** Truncates a label to fit a gutter. */
export function truncate(text, maxChars) {
  const s = String(text ?? '');
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

export const fmt = (n) =>
  typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-CA') : String(n ?? '');

/** Escapes text destined for SVG/HTML output. */
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
