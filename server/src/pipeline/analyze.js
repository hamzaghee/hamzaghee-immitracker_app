/**
 * Stage 3 — "Analysis - Code" (n8n code node).
 *
 * Port of the aggregation node. Output keys match the n8n payload exactly so
 * the numbers are directly comparable.
 *
 * One deliberate deviation: month bucketing uses UTC rather than local time.
 * The source timestamps are UTC midnight, so local-time bucketing in any
 * negative-offset timezone (e.g. America/Toronto) rolls a date back into the
 * previous month. n8n ran in a UTC container, so UTC here reproduces the
 * numbers it actually produced rather than the ones its code would produce on
 * a Canadian workstation.
 */

import { parseLooseDate } from './filter.js';
import { STREAM_GROUPS, COMPARISON_GROUPS } from './streamGroups.js';
import { countryNameMap } from '../../../shared/text.js';

const PPR_FIELD = 'Portal 2 Email / PPR Date';
const MS_PER_DAY = 86400000;
/** Mean days per month — used only for the months-format figures in AI prose. */
export const DAYS_PER_MONTH = 30.44;

export const daysToMonths = (d) =>
  typeof d === 'number' && isFinite(d) ? Math.round((d / DAYS_PER_MONTH) * 10) / 10 : null;

/**
 * Whole days between two date fields.
 *
 * Returns null when either end is missing or unparseable, and — deliberately —
 * when the span is negative. Some records have AOR before Submitted, which is a
 * data-entry error rather than a real duration; averaging those in would drag
 * the mean below zero for no good reason.
 */
function spanDays(row, startField, endField) {
  const a = parseLooseDate(row[startField]);
  const b = parseLooseDate(row[endField]);
  if (!a || !b) return null;
  const d = Math.round((b - a) / MS_PER_DAY);
  return d < 0 ? null : d;
}

/** Mean / median / count over an array of numbers, matching calculateStats(). */
function statsOf(nums) {
  const n = nums.filter((x) => typeof x === 'number' && isFinite(x));
  if (!n.length) return { median: 0, mean: 0, count: 0 };
  n.sort((a, b) => a - b);
  const mean = Math.round((n.reduce((s, x) => s + x, 0) / n.length) * 10) / 10;
  const mid = Math.floor(n.length / 2);
  const median =
    n.length % 2 !== 0 ? n[mid] : Math.round(((n[mid - 1] + n[mid]) / 2) * 10) / 10;
  return { median, mean, count: n.length };
}

/** Tally frequencies of a field's values, skipping empties. */
export function countBy(arr, key) {
  return arr.reduce((acc, row) => {
    const val = row[key];
    if (val !== undefined && val !== null && val !== '') {
      acc[val] = (acc[val] || 0) + 1;
    }
    return acc;
  }, {});
}

/** Mean / median / sample count over the numeric values of a field. */
export function calculateStats(arr, key) {
  const nums = arr.map((r) => parseFloat(r[key])).filter((n) => !isNaN(n));

  if (!nums.length) return { median: 0, mean: 0, count: 0 };

  nums.sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = Math.round((sum / nums.length) * 10) / 10;

  const mid = Math.floor(nums.length / 2);
  const median =
    nums.length % 2 !== 0
      ? nums[mid]
      : Math.round(((nums[mid - 1] + nums[mid]) / 2) * 10) / 10;

  return { median, mean, count: nums.length };
}

/**
 * @param {object[]} records filtered, relabeled records
 * @param {object} [options]
 * @param {object[]} [options.comparisonRecords]
 *   Rows backing the cross-programme comparison chart. Defaults to `records`,
 *   but the report flow passes the period-filtered set *before* the stream
 *   filter — otherwise selecting PNP leaves the FSW and CEC buckets empty and
 *   the comparison chart has nothing to compare.
 * @returns {object} the summary payload
 */
export function analyze(records, { comparisonRecords = records } = {}) {
  const totalRecords = records.length;

  const streamDistribution = countBy(records, 'Stream');
  const countryCounts = countBy(records, 'Country of Residence');
  const nationalityCounts = countBy(records, 'Nationality');
  const statusBreakdown = countBy(records, 'Current Status');

  const top10 = (counts) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reduce((acc, [k, v]) => {
        acc[k] = v;
        return acc;
      }, {});

  const topCountries = top10(countryCounts);
  const topNationalities = top10(nationalityCounts);

  const subToPprStats = calculateStats(records, 'Days from Submission to PPR');
  const aorToPprStats = calculateStats(records, 'Days from AOR to PPR');
  const aorToMedsStats = calculateStats(records, 'Number of Days after AOR to Meds passed');
  const aorToBilStats = calculateStats(records, 'Number of days from AOR to BIL');
  const medsToPprStats = calculateStats(records, 'Number of Days after Meds passed to PPR');

  // Two milestones have no precomputed column, so derive them from the dates.
  const subToAorStats = statsOf(records.map((r) => spanDays(r, 'Submitted', 'AOR Date')));
  const bilToPprStats = statsOf(
    records.map((r) => spanDays(r, 'Biometrics Invitation Letter', PPR_FIELD))
  );

  // "Approved" = reached PPR. Keyed off the PPR date rather than Current Status,
  // because a case that has since Landed still passed through PPR.
  const approvedCount = records.filter((r) => parseLooseDate(r[PPR_FIELD])).length;

  // Stream vs Submission-to-PPR: per-stream averages plus the raw points.
  const streamSubToPpr = {};
  const streamVsSubToPprPoints = [];
  for (const r of records) {
    const stream = r['Stream'];
    const days = parseFloat(r['Days from Submission to PPR']);
    if (stream !== undefined && stream !== null && stream !== '' && !isNaN(days)) {
      if (!streamSubToPpr[stream]) streamSubToPpr[stream] = { sum: 0, count: 0 };
      streamSubToPpr[stream].sum += days;
      streamSubToPpr[stream].count += 1;
      streamVsSubToPprPoints.push({ stream, days });
    }
  }
  const streamVsSubmissionToPPR = Object.entries(streamSubToPpr).reduce((acc, [stream, v]) => {
    acc[stream] = Math.round((v.sum / v.count) * 10) / 10;
    return acc;
  }, {});

  // Monthly submission frequency (YYYY-MM), UTC-bucketed — see file header.
  const monthlySubmissions = {};
  for (const r of records) {
    const d = parseLooseDate(r['Submitted']);
    if (!d) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    monthlySubmissions[key] = (monthlySubmissions[key] || 0) + 1;
  }
  const monthlySubmissionsSorted = Object.keys(monthlySubmissions)
    .sort()
    .reduce((acc, k) => {
      acc[k] = monthlySubmissions[k];
      return acc;
    }, {});

  // Mean Submission→PPR bucketed by submission month, so it shares an x-axis
  // with monthlySubmissions above.
  const monthlyDuration = {};
  for (const r of records) {
    const d = parseLooseDate(r['Submitted']);
    const days = parseFloat(r['Days from Submission to PPR']);
    if (!d || isNaN(days)) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    (monthlyDuration[key] ||= []).push(days);
  }
  const monthlyProcessingTimes = Object.keys(monthlyDuration)
    .sort()
    .reduce((acc, k) => {
      const a = monthlyDuration[k];
      acc[k] = {
        meanDays: Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10,
        count: a.length,
      };
      return acc;
    }, {});

  // Slowest / fastest month by mean processing time — Analysis 2 cites these.
  //
  // Require a minimum sample. Without it a month holding a single case wins
  // outright, and the AI then reports that one case as the month's performance.
  // Fall back to the unfiltered set only if nothing clears the bar, so a small
  // dataset still produces an answer rather than nothing.
  const MIN_MONTH_SAMPLE = 5;
  const allMonths = Object.entries(monthlyProcessingTimes);
  const eligible = allMonths.filter(([, v]) => v.count >= MIN_MONTH_SAMPLE);
  const monthPool = eligible.length ? eligible : allMonths;

  const pickMonth = (better) =>
    monthPool.reduce(
      (best, [k, v]) => (!best || better(v.meanDays, best.meanDays) ? { month: k, ...v } : best),
      null
    );
  const slowestMonth = pickMonth((a, b) => a > b);
  const fastestMonth = pickMonth((a, b) => a < b);
  const monthSampleFloor = eligible.length ? MIN_MONTH_SAMPLE : 1;

  // Comparison chart: longest vs shortest Submission→PPR per programme. Keyed
  // by group so a future Spousal/Citizenship upload can extend it unchanged.
  const streamComparison = COMPARISON_GROUPS.map((key) => {
    const allowed = new Set(STREAM_GROUPS[key].values);
    const days = comparisonRecords
      .filter((r) => allowed.has(r['Stream']))
      .map((r) => parseFloat(r['Days from Submission to PPR']))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
    return {
      key,
      label: STREAM_GROUPS[key].label,
      shortest: days.length ? days[0] : null,
      longest: days.length ? days[days.length - 1] : null,
      count: days.length,
    };
  });

  // Slowest / quickest by Submission-to-PPR. `slug` is added on top of the n8n
  // shape: Case ID is empty in this dataset, so the slug is the only stable
  // per-case identifier available for chart labels.
  const casesWithDays = records
    .map((r) => {
      const slug = r['_slugs'] || '';
      const nationality = r['Nationality'] || '';
      const stream = r['Stream'] || '';
      return {
        caseId: r['Case ID'] || r['Username'] || 'Unknown',
        slug,
        nationality,
        stream,
        // Axis label per the report spec: nationality / stream / case ID.
        label: [nationality, stream, slug || r['Username']].filter(Boolean).join(' / '),
        days: parseFloat(r['Days from Submission to PPR']),
      };
    })
    .filter((c) => !isNaN(c.days));
  const slowestCases = [...casesWithDays].sort((a, b) => b.days - a.days).slice(0, 5);
  const quickestCases = [...casesWithDays].sort((a, b) => a.days - b.days).slice(0, 5);

  const refusalCount = statusBreakdown['Refused'] || 0;
  const landedCount = statusBreakdown['Landed'] || 0;
  const pprCount = statusBreakdown['PPR'] || 0;
  const decisionMadeCount = statusBreakdown['Decision Made'] || 0;
  const bgCheckCount = statusBreakdown['Background Check'] || 0;
  const biometricsCount = statusBreakdown['Biometrics'] || 0;

  return {
    totalRecordsAnalyzed: totalRecords,
    refusalCount,
    landedCount,
    pprCount,
    decisionMadeCount,
    bgCheckCount,
    biometricsCount,
    streamDistribution,
    topCountriesOfResidence: topCountries,
    statusBreakdown,
    daysSubmissionToPPR: subToPprStats,
    daysAorToPPR: aorToPprStats,
    daysAorToMeds: aorToMedsStats,
    daysAorToBil: aorToBilStats,
    daysMedsToPPR: medsToPprStats,
    streamVsSubmissionToPPR,
    streamVsSubmissionToPPRPoints: streamVsSubToPprPoints,
    monthlySubmissions: monthlySubmissionsSorted,
    slowestCases,
    quickestCases,

    /* ---- added for the V.0.3 report structure ---- */

    // "Approved" tile — cases that reached PPR, by date not status.
    approvedCount,
    // Two derived milestones with no precomputed column.
    daysSubmissionToAor: subToAorStats,
    daysBilToPPR: bilToPprStats,
    topNationalities,
    /**
     * { IN: 'India', … } for the codes in the two maps above.
     *
     * The maps stay keyed by code on purpose: verify-against-pin.js compares
     * topCountriesOfResidence against n8n's pinned output, which uses codes.
     * Display names ride alongside so charts, tables, the export and the AI
     * fact sheet can all resolve them without breaking that comparison.
     */
    countryNames: countryNameMap(topCountries, topNationalities),
    monthlyProcessingTimes,
    slowestMonth,
    fastestMonth,
    // Minimum cases a month needed to qualify above — surfaced so the report
    // can caveat the figure rather than presenting it as unconditional.
    monthSampleFloor,
    streamComparison,
  };
}
