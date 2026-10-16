/**
 * Extreme processing-time cases.
 *
 * A handful of cases take years rather than months — an ITA from 2022 approved
 * in 2025 — and with the small monthly samples this data has, one of them is
 * enough to make a whole month or category look slow. Rather than showing a
 * "with and without" pair, such cases are taken out of every processing-time
 * figure and each affected chart says so. They still count as cases: the tiles,
 * status and share charts are unchanged.
 *
 * The rule is Tukey's "far out" fence: more than three interquartile ranges
 * beyond the middle half of completed cases. It adapts to the slice being
 * reported and is deliberately conservative — ordinary slow cases stay in.
 */

import { parseLooseDate } from './filter.js';
import { countryName } from '../../../shared/text.js';

export const DAYS_FIELD = 'Days from Submission to PPR';

/** Below this many completed cases the quartiles are too unstable to judge by. */
export const MIN_SAMPLE = 20;

/** Fence distance, in interquartile ranges. 3 is Tukey's "far out". */
const IQR_MULTIPLE = 3;

const daysOf = (r) => {
  const d = parseFloat(r[DAYS_FIELD]);
  return Number.isFinite(d) ? d : null;
};

/** Linear-interpolated quantile of a sorted array. */
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const monthKey = (v) => {
  const d = parseLooseDate(v);
  return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : null;
};

/**
 * @param {object[]} records relabeled records for the report slice
 * @returns {{
 *   lowerFenceDays: number|null,
 *   upperFenceDays: number|null,
 *   isOutlier: (r: object) => boolean,
 *   summary: { count: number, upperFenceDays: number|null, lowerFenceDays: number|null, cases: object[] }
 * }}
 */
export function detectOutliers(records) {
  const days = records.map(daysOf).filter((d) => d !== null).sort((a, b) => a - b);

  if (days.length < MIN_SAMPLE) {
    return {
      lowerFenceDays: null,
      upperFenceDays: null,
      isOutlier: () => false,
      summary: { count: 0, lowerFenceDays: null, upperFenceDays: null, cases: [] },
    };
  }

  const q1 = quantile(days, 0.25);
  const q3 = quantile(days, 0.75);
  const iqr = q3 - q1;
  const upper = Math.round(q3 + IQR_MULTIPLE * iqr);
  // Durations cannot go below zero, so a negative fence means "no low outliers".
  const lowerRaw = Math.round(q1 - IQR_MULTIPLE * iqr);
  const lower = lowerRaw > 0 ? lowerRaw : null;

  const isOutlierDays = (d) => d !== null && (d > upper || (lower !== null && d < lower));
  const isOutlier = (r) => isOutlierDays(daysOf(r));

  const cases = records
    .filter(isOutlier)
    .map((r) => ({
      days: daysOf(r),
      direction: daysOf(r) > upper ? 'slow' : 'fast',
      stream: r['Stream'] || null,
      nationality: r['Nationality'] ? countryName(r['Nationality']) : null,
      drawCategory: r['EE Draw Category'] || null,
      submittedMonth: monthKey(r['Submitted']),
      itaMonth: monthKey(r['ITA Date']),
    }))
    .sort((a, b) => b.days - a.days);

  return {
    lowerFenceDays: lower,
    upperFenceDays: upper,
    isOutlier,
    summary: { count: cases.length, lowerFenceDays: lower, upperFenceDays: upper, cases },
  };
}

/**
 * Same fence applied to another set of rows — the comparison chart's rows span
 * every programme, but must use the threshold the rest of the report used.
 */
export function withinFences(records, { lowerFenceDays, upperFenceDays }) {
  if (upperFenceDays === null || upperFenceDays === undefined) return records;
  return records.filter((r) => {
    const d = daysOf(r);
    if (d === null) return true;
    if (d > upperFenceDays) return false;
    if (lowerFenceDays !== null && lowerFenceDays !== undefined && d < lowerFenceDays) return false;
    return true;
  });
}
