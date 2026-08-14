/**
 * Stage 2 — "Filter 18 months" (n8n code node).
 *
 * The n8n node hard-coded an 18-month lookback on the "Submitted" field. That
 * remains the default here; the window and the date field are parameterised so
 * the dashboard can widen the slice without forking the logic. Calling this
 * with no options reproduces the n8n node exactly.
 */

export const DEFAULT_MONTHS = 18;
export const DEFAULT_DATE_FIELD = 'Submitted';

/** Parse a value the way the n8n node did: collapse whitespace, then `new Date`. */
export function parseLooseDate(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * @param {object[]} records relabeled records
 * @param {object} [options]
 * @param {number|null} [options.months] rolling lookback; `null` disables it
 * @param {string} [options.dateField] which date to filter on
 * @param {Date} [options.now] reference instant for the rolling window
 * @param {string|Date} [options.from] explicit period start (inclusive)
 * @param {string|Date} [options.to] explicit period end (inclusive)
 *
 * `from`/`to` describe the Report Configuration period and take precedence over
 * `months` when either is supplied. With neither present this behaves exactly as
 * it always has — `scripts/verify-against-pin.js` depends on that, so the
 * explicit-range path is strictly additive.
 */
export function filterByWindow(records, options = {}) {
  const {
    months = DEFAULT_MONTHS,
    dateField = DEFAULT_DATE_FIELD,
    now = new Date(),
    from,
    to,
  } = options;

  if (from !== undefined || to !== undefined) {
    const start = from ? parseLooseDate(from) : null;
    // An end date with no time component means midnight; treat it as the whole
    // day so a case submitted on the end date is not silently excluded.
    let end = to ? parseLooseDate(to) : null;
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(String(to).trim())) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1);
    }
    if (from && !start) {
      throw Object.assign(new Error(`Invalid period start: ${from}`), { status: 400 });
    }
    if (to && !end) {
      throw Object.assign(new Error(`Invalid period end: ${to}`), { status: 400 });
    }
    if (start && end && start > end) {
      throw Object.assign(new Error('Period start is after period end.'), { status: 400 });
    }

    return records.filter((row) => {
      const d = parseLooseDate(row[dateField]);
      if (d === null) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }

  if (months === null) return records;

  const cutoffDate = new Date(now);
  cutoffDate.setMonth(now.getMonth() - months);

  return records.filter((row) => {
    const submittedDate = parseLooseDate(row[dateField]);
    return submittedDate !== null && submittedDate >= cutoffDate && submittedDate <= now;
  });
}
