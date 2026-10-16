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
import { detectOutliers, withinFences } from './outliers.js';

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

const DRAW_FIELD = 'EE Draw Category';

/**
 * The process line, in order. Refused sits outside it — it can happen at any
 * point — and is reported separately.
 */
export const PROCESS_STAGES = [
  { status: 'Submitted', label: 'Submitted' },
  { status: 'e-APR AOR', label: 'AOR' },
  { status: 'Biometrics', label: 'Biometrics' },
  { status: 'Medicals Passed', label: 'Medicals passed' },
  { status: 'Background Check', label: 'Background check' },
  { status: 'Decision Made', label: 'Decision made' },
  { status: 'PPR', label: 'PPR' },
  { status: 'Landed', label: 'Landed' },
];

/** Provincial nomination adds this many CRS points. */
const PNP_BONUS = 600;

/**
 * CRS scores counted into fixed-width bands, empty bands included so gaps in
 * the distribution stay visible.
 *
 * @param {number[]} scores
 * @param {number} width band width in points
 * @param {number} [cap] scores at or above this go into one open "cap+" band
 *   rather than stretching the axis with empty bands
 * @returns {{ label: string, from: number, count: number }[]}
 */
export function crsBands(scores, width, cap = Infinity) {
  if (!scores.length) return [];
  const min = Math.min(...scores);
  const max = Math.min(Math.max(...scores), cap - 1);
  const bands = [];
  for (let from = Math.floor(min / width) * width; from <= max; from += width) {
    const to = Math.min(from + width, cap);
    bands.push({
      label: `${from}–${to - 1}`,
      from,
      count: scores.filter((s) => s >= from && s < to).length,
    });
  }
  const above = scores.filter((s) => s >= cap).length;
  if (above) bands.push({ label: `${cap}+`, from: cap, count: above });
  return bands;
}

/**
 * CRS distribution, split by whether the case is a provincial nominee.
 *
 * Nomination adds 600 points, so pooling PNP with everyone else puts a second
 * hump past 900 and squeezes the rest of the curve. FSW/CEC get 25-point bands
 * up to 600 with a single 600+ band for the rare outlier; PNP is sparser and
 * spread across ~600 points, so it gets 50-point bands. Scores are shown as
 * reported, not adjusted: some PNP applicants report a score below 600,
 * apparently from before their nomination, and subtracting 600 would be wrong
 * for them.
 */
function crsDistribution(records) {
  const pnpStreams = new Set(STREAM_GROUPS.pnp.values);
  const scoresOf = (rows) =>
    rows.map((r) => parseFloat(r['CRS Score'])).filter((n) => isFinite(n) && n > 0);
  const general = records.filter((r) => !pnpStreams.has(r['Stream']));
  const pnp = records.filter((r) => pnpStreams.has(r['Stream']));
  const generalScores = scoresOf(general);
  const pnpScores = scoresOf(pnp);
  return {
    general: {
      bands: crsBands(generalScores, 25, PNP_BONUS),
      scored: generalScores.length,
      total: general.length,
      median: statsOf(generalScores).median,
    },
    pnp: {
      bands: crsBands(pnpScores, 50),
      scored: pnpScores.length,
      total: pnp.length,
      median: statsOf(pnpScores).median,
      belowNomination: pnpScores.filter((s) => s < PNP_BONUS).length,
    },
  };
}

const sumValues = (obj) => Object.values(obj).reduce((s, v) => s + v, 0);

/**
 * Mean Submission→PPR per group, over completed cases only.
 * @returns {{ [group: string]: { meanDays: number, count: number } }}
 */
function meanDaysBy(records, keyOf) {
  const acc = {};
  for (const r of records) {
    const key = keyOf(r);
    const days = parseFloat(r['Days from Submission to PPR']);
    if (key === undefined || key === null || key === '' || isNaN(days)) continue;
    (acc[key] ||= { sum: 0, count: 0 }).sum += days;
    acc[key].count += 1;
  }
  return Object.fromEntries(
    Object.entries(acc).map(([k, v]) => [
      k,
      { meanDays: Math.round((v.sum / v.count) * 10) / 10, count: v.count },
    ])
  );
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
 * @param {boolean} [options.excludeOutliers]
 *   Take extreme processing-time cases out of every timing figure (see
 *   outliers.js). Counts are unaffected. Off by default so the pinned-output
 *   check keeps comparing like with like; the report flow turns it on.
 * @returns {object} the summary payload
 */
export function analyze(records, { comparisonRecords = records, excludeOutliers = false } = {}) {
  const totalRecords = records.length;

  // `timed` backs every processing-time figure; `records` every count.
  const outliers = excludeOutliers ? detectOutliers(records) : null;
  const timed = outliers ? records.filter((r) => !outliers.isOutlier(r)) : records;
  const timedComparison = outliers ? withinFences(comparisonRecords, outliers) : comparisonRecords;

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

  const subToPprStats = calculateStats(timed, 'Days from Submission to PPR');
  const aorToPprStats = calculateStats(timed, 'Days from AOR to PPR');
  const aorToMedsStats = calculateStats(timed, 'Number of Days after AOR to Meds passed');
  const aorToBilStats = calculateStats(timed, 'Number of days from AOR to BIL');
  const medsToPprStats = calculateStats(timed, 'Number of Days after Meds passed to PPR');

  // Two milestones have no precomputed column, so derive them from the dates.
  const subToAorStats = statsOf(timed.map((r) => spanDays(r, 'Submitted', 'AOR Date')));
  const bilToPprStats = statsOf(
    timed.map((r) => spanDays(r, 'Biometrics Invitation Letter', PPR_FIELD))
  );

  // "Approved" = reached PPR. Keyed off the PPR date rather than Current Status,
  // because a case that has since Landed still passed through PPR.
  const approvedCount = records.filter((r) => parseLooseDate(r[PPR_FIELD])).length;

  // Stream vs Submission-to-PPR: per-stream averages plus the raw points.
  const streamSubToPpr = {};
  const streamVsSubToPprPoints = [];
  for (const r of timed) {
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
  for (const r of timed) {
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
    const days = timedComparison
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
  const casesWithDays = timed
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

  // Draw category and NOC are optional fields — many applicants leave them
  // blank — so each comes with the number of cases that filled it in, and the
  // report states its percentages against that rather than the full total.
  const drawCategoryCounts = countBy(records, DRAW_FIELD);
  const drawCategorySpecified = sumValues(drawCategoryCounts);
  const nocCounts = countBy(records, 'NOC Code');

  // Of the approved (PPR-dated) cases, how they split across draw categories.
  const approvedRecords = records.filter((r) => parseLooseDate(r[PPR_FIELD]));
  const approvalsByDrawCategory = countBy(approvedRecords, DRAW_FIELD);

  const processingByDrawCategory = meanDaysBy(timed, (r) => r[DRAW_FIELD]);
  // Nationality has a long tail of one-case countries; keep the ten with the
  // most completed cases so each average rests on a real sample.
  const processingByNationality = Object.fromEntries(
    Object.entries(meanDaysBy(timed, (r) => r['Nationality']))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
  );

  // Cases sitting at each step of the process right now, in process order.
  // Statuses outside the known sequence are kept rather than dropped, so the
  // counts always add up to the total.
  const stageCounts = PROCESS_STAGES.map(({ status, label }) => ({
    status,
    label,
    count: statusBreakdown[status] || 0,
  }));
  const knownStatuses = new Set([...PROCESS_STAGES.map((s) => s.status), 'Refused']);
  const otherStatusCount = Object.entries(statusBreakdown)
    .filter(([k]) => !knownStatuses.has(k))
    .reduce((sum, [, v]) => sum + v, 0);
  const unknownStatusCount = records.filter((r) => !r['Current Status']).length;

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
    countryNames: countryNameMap(topCountries, topNationalities, processingByNationality),
    monthlyProcessingTimes,
    slowestMonth,
    fastestMonth,
    // Minimum cases a month needed to qualify above — surfaced so the report
    // can caveat the figure rather than presenting it as unconditional.
    monthSampleFloor,
    streamComparison,

    /* ---- added for the V.0.4 report revisions ---- */

    // Neither approved nor refused. Defined as the remainder so the three
    // headline tiles always add up to Cases Submitted.
    inProgressCount: Math.max(0, totalRecords - approvedCount - refusalCount),
    drawCategoryCounts,
    drawCategorySpecified,
    approvalsByDrawCategory,
    approvalsDrawCategorySpecified: sumValues(approvalsByDrawCategory),
    processingByDrawCategory,
    processingByNationality,
    // An array, not a map: NOC codes are integer-like strings, and JS orders
    // integer keys numerically, which would undo the frequency sort.
    topNocCodes: Object.entries(nocCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, count]) => ({ code, count })),
    nocSpecified: sumValues(nocCounts),
    stageCounts,
    // Cases with a status outside the process line, or none at all.
    otherStatusCount: otherStatusCount + unknownStatusCount,
    crsDistribution: crsDistribution(records),

    /* ---- added for the AI analysis revision ---- */

    // Extreme cases left out of the timing figures above, or null when
    // exclusion was not requested. Charts cite this in their notes.
    outliers: outliers ? outliers.summary : null,
  };
}
