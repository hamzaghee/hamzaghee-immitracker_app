import { useCallback, useEffect, useRef, useState } from 'react';

// Geometry and the stream→slot mapping are shared with the server's report
// renderer so the on-screen and exported charts cannot drift apart.
export { barPath, niceTicks, truncate, fmt, STREAM_SLOT } from '@shared/chartGeometry.js';
import { STREAM_SLOT as SLOT } from '@shared/chartGeometry.js';

/**
 * Categorical slots as CSS variables rather than raw hex, so the dashboard
 * follows the light/dark theme. The exported report uses the hex values from
 * the same shared module.
 */
export const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
];

export const streamColor = (name) => SERIES[SLOT[name] ?? 0];

/**
 * Measures the container so charts can be fluid without a fixed viewBox.
 *
 * The setter uses the functional form deliberately: the observer is created
 * once, so comparing against a captured `width` would compare against a stale
 * value and could skip updates.
 */
export function useWidth() {
  const ref = useRef(null);
  // Starts at 0 — "not measured yet". Charts render a reserved-space
  // placeholder until a real width arrives, so a container that measures 0
  // (hidden tab, print, pane not composited) never draws an oversized svg
  // that overflows the page.
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w) setWidth((prev) => (Math.abs(w - prev) > 1 ? w : prev));
    };

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Fallback for environments where the observer misses a viewport change.
    window.addEventListener('resize', measure);
    measure();

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return [ref, width];
}

/** Reserved space shown while the container width is still unknown. */
export function ChartPlaceholder({ innerRef, height }) {
  return <div className="chart-wrap" ref={innerRef} style={{ minHeight: height }} />;
}

/** Shared hover-tooltip state for a chart. */
export function useTooltip() {
  const [tip, setTip] = useState(null);
  const show = useCallback((x, y, label, value, sub) => setTip({ x, y, label, value, sub }), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y - 8 }} role="status">
      <span className="tt-label">{tip.label}</span>
      <span className="tt-value">{tip.value}</span>
      {tip.sub ? <span className="tt-label">{tip.sub}</span> : null}
    </div>
  );
}

// niceTicks, barPath, truncate and fmt are re-exported from @shared above.
