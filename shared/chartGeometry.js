/**
 * Chart geometry and palette, shared by the React dashboard and the standalone
 * HTML report generator.
 *
 * Plain ESM with no dependencies so the Node server can import it directly and
 * Vite can bundle it. It exists so the on-screen charts and the exported ones
 * cannot drift: same bar maths, same axis ticks, same colours.
 *
 * Brand tokens come from the Immitracker design system v1.0; the categorical
 * chart slots deliberately do not — see PALETTE.series.
 */

/* ---------------- palette ---------------- */

/**
 * Brand tokens from the Immitracker design system v1.0.
 *
 * Two hues: red for advocacy, action and primary CTAs; blue for wayfinding and
 * informational accents. Dark Blue is the default ink. Neutrals are the cool
 * grays derived from it.
 *
 * Light only. The app had a dark column; it was removed because the design
 * system specifies one palette and an export has to commit to it anyway.
 */
export const BRAND = {
  // Primary - red
  red100: '#FFD7CF',
  red500: '#E7664C',
  red700: '#BC513B',
  // Accent - blue
  blue100: '#BDD6FF',
  blue500: '#2176FF',
  // Neutrals, derived from Ink 900
  ink900: '#2D3142',
  ink700: '#4A4F62',
  ink500: '#6E7385',
  ink300: '#B6BAC6',
  ink200: '#D9DCE3',
  ink100: '#ECEEF2',
  ink50: '#F5F6F9',
  white: '#FFFFFF',
};

/**
 * The palette the charts and report styles read.
 *
 * Primary fill is Dark Red (red700), not Med Red: white text on Med Red is
 * 3.28:1 and fails WCAG AA, while Dark Red clears it at 4.80:1. Med Red is the
 * hover step. Both are design-system values.
 */
export const PALETTE = {
  surface: BRAND.white,
  page: BRAND.ink50,
  textPrimary: BRAND.ink900,
  textSecondary: BRAND.ink700,
  textMuted: BRAND.ink500,
  gridline: BRAND.ink200,
  baseline: BRAND.ink300,
  border: BRAND.ink200,

  primary: BRAND.red700,
  primaryHover: BRAND.red500,
  primaryTint: BRAND.red100,
  accent: BRAND.blue500,
  accentTint: BRAND.blue100,

  /**
   * Categorical chart slots, unchanged from the pre-brand palette and still
   * colourblind-validated. The brand's two hues cannot carry five series --
   * Med Blue against Med Red is 1.26:1, far below the 3:1 needed to tell two
   * bars apart, and red/blue is the classic protan/deutan confusion pair. So
   * the brand colours the frame and these colour the data.
   *
   * Do not substitute values here without re-running a CVD check: the slot
   * *ordering* is the safety mechanism, not decoration.
   */
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
  // Recessive fill for the non-selected programmes in the comparison chart.
  muted: BRAND.ink300,

  /**
   * Semantic status. The design system defines no success/warning/danger, so
   * these are chosen to clear 4.5:1 on both white and Ink 50, and to stay
   * clearly distinct from the primary red so an error never reads as a CTA.
   */
  good: '#13794A',
  warning: '#946100',
  critical: '#C0392B',
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

export const streamColorHex = (name) => PALETTE.series[STREAM_SLOT[name] ?? 0];

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
