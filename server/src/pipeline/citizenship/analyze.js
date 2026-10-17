/**
 * Citizenship analysis — the numbers behind the Citizenship report.
 *
 * The report measures the process from start to finish: how long each step
 * took, how long the whole thing took, and how both differ across groups of
 * applicants (province, application type, nationality, IRCC office and the
 * extra checks some cases go through).
 *
 * Two rules shape every figure:
 *
 *   The finish line is the decision. The tracker has no refusals, and many
 *   applicants stop updating once they hear back, so "decided" means the
 *   decision date or — when that is blank, as it usually is — the first later
 *   date filled in: oath letter, then oath ceremony, then certificate. Each
 *   figure that uses it reports how many cases were measured to which date.
 *
 *   Durations are measured from the dates, not the tracker's precomputed
 *   "Days from …" columns. The finish line above has no column of its own, and
 *   measuring everything the same way keeps the step and total figures
 *   comparable. Negative spans are data-entry errors and are dropped.
 *
 * Month of application is used for volume only. Processing time is never
 * bucketed by month: the report does not treat the calendar as a factor.
 */

import { parseLooseDate } from '../filter.js';
import { F, CITIZENSHIP_STATUSES } from './fieldMap.js';

const MS_PER_DAY = 86400000;

/** Smallest group whose average is shown or commented on. */
export const MIN_GROUP = 5;
/** Nationalities have a long tail; only the busiest are broken down. */
const TOP_NATIONALITIES = 10;

/* ---------------- the finish line ---------------- */

/** Where a case's decision date comes from, in the order they are tried. */
export const DECISION_SOURCES = [
  { source: 'decision', field: F.decision, label: 'decision date' },
  { source: 'oathLetter', field: F.oathLetter, label: 'oath letter date' },
  { source: 'oathCeremony', field: F.oathCeremony, label: 'oath ceremony date' },
  { source: 'certificate', field: F.certificate, label: 'certificate date' },
];

/** Statuses at or past the decision. */
const DECIDED_STATUSES = new Set(['Decision Made', 'Oath Letter received', 'Oath completed']);

/** The case's decision point: { date, source }, or null if it has none. */
export function decisionPoint(r) {
  for (const { source, field } of DECISION_SOURCES) {
    const date = parseLooseDate(r[field]);
    if (date) return { date, source };
  }
  return null;
}

/**
 * Has the case been decided? By status or by any decision-or-later date, so an
 * applicant who filled in the oath letter but never moved their status still
 * counts.
 */
export const isDecided = (r) => DECIDED_STATUSES.has(r[F.status]) || decisionPoint(r) !== null;

/* ---------------- durations ---------------- */

/** Stands in for a field name: "this case's decision point". */
const DECISION = '@decision';

const dateOf = (r, field) =>
  field === DECISION ? decisionPoint(r)?.date ?? null : parseLooseDate(r[field]);

/** Whole days from one date to another; null if either is missing or the span is negative. */
function spanDays(r, from, to) {
  const a = dateOf(r, from);
  const b = dateOf(r, to);
  if (!a || !b) return null;
  const d = Math.round((b - a) / MS_PER_DAY);
  return d < 0 ? null : d;
}

/** Application to decision — the report's headline duration. */
export const totalDays = (r) => spanDays(r, F.sent, DECISION);

/**
 * The steps between milestones.
 *
 * `band: true` marks the four that run end to end from AOR to decision; with
 * Application → AOR before them they make up the step-by-step charts. The rest
 * are tiles only — they overlap the bands (AOR → background check runs
 * alongside the test) or sit after the finish line (oath letter, ceremony).
 */
export const STEPS = [
  { id: 'sentToAor', label: 'Application → AOR', from: F.sent, to: F.aor, band: true },
  { id: 'aorToInProcess', label: 'AOR → In process', from: F.aor, to: F.inProcess },
  { id: 'sentToTestInvite', label: 'Application → test invite', from: F.sent, to: F.testInvite },
  { id: 'aorToTestInvite', label: 'AOR → test invite', from: F.aor, to: F.testInvite, band: true },
  { id: 'testInviteToTest', label: 'Test invite → test taken', from: F.testInvite, to: F.test, band: true },
  { id: 'testToDecision', label: 'Test taken → decision', from: F.test, to: DECISION, band: true },
  // The real decision date only: with the fallback, a case measured to its
  // oath letter would show a zero-day step here.
  { id: 'decisionToOathLetter', label: 'Decision → oath letter', from: F.decision, to: F.oathLetter },
  { id: 'oathLetterToCeremony', label: 'Oath letter → oath ceremony', from: F.oathLetter, to: F.oathCeremony },
  { id: 'aorToBackgroundCheck', label: 'AOR → background check done', from: F.aor, to: F.backgroundCheck },
];

export const BAND_STEPS = STEPS.filter((s) => s.band);

/* ---------------- statistics ---------------- */

const round1 = (n) => Math.round(n * 10) / 10;

/** Mean / median / min / max / count over the finite numbers given. */
export function statsOf(values) {
  const n = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!n.length) return { mean: null, median: null, min: null, max: null, count: 0 };
  const mid = Math.floor(n.length / 2);
  return {
    mean: round1(n.reduce((s, x) => s + x, 0) / n.length),
    median: n.length % 2 ? n[mid] : round1((n[mid - 1] + n[mid]) / 2),
    min: n[0],
    max: n[n.length - 1],
    count: n.length,
  };
}

/** Linear-interpolated quantile of a sorted array. */
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Extreme total durations, by the same rule the Express Entry report uses
 * (../outliers.js): more than three interquartile ranges beyond the middle half
 * of decided cases, judged only once there are 20 of them. Such cases are left
 * out of every timing figure; they still count in tiles, status and shares.
 */
const OUTLIER_MIN_SAMPLE = 20;
const IQR_MULTIPLE = 3;

function detectOutliers(records) {
  const days = records.map(totalDays).filter((d) => d !== null).sort((a, b) => a - b);
  const none = { isOutlier: () => false, summary: { count: 0, lowerFenceDays: null, upperFenceDays: null } };
  if (days.length < OUTLIER_MIN_SAMPLE) return none;

  const q1 = quantile(days, 0.25);
  const q3 = quantile(days, 0.75);
  const iqr = q3 - q1;
  const upper = Math.round(q3 + IQR_MULTIPLE * iqr);
  const lowerRaw = Math.round(q1 - IQR_MULTIPLE * iqr);
  const lower = lowerRaw > 0 ? lowerRaw : null;
  const isOutlier = (r) => {
    const d = totalDays(r);
    return d !== null && (d > upper || (lower !== null && d < lower));
  };
  return {
    isOutlier,
    summary: { count: records.filter(isOutlier).length, lowerFenceDays: lower, upperFenceDays: upper },
  };
}

/* ---------------- grouping ---------------- */

/** Tally a field's values, skipping blanks. */
function countBy(rows, keyOf) {
  const acc = {};
  for (const r of rows) {
    const k = keyOf(r);
    if (k !== null && k !== undefined && k !== '') acc[k] = (acc[k] || 0) + 1;
  }
  return acc;
}

/** { label: count } -> [{ label, count }], busiest first. */
const ranked = (counts, limit = Infinity) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));

/** Total and per-step durations for one set of cases. */
function timingsOf(rows) {
  return {
    total: statsOf(rows.map(totalDays)),
    steps: Object.fromEntries(
      BAND_STEPS.map((s) => {
        const st = statsOf(rows.map((r) => spanDays(r, s.from, s.to)));
        return [s.id, { meanDays: st.mean, count: st.count }];
      })
    ),
  };
}

/**
 * The step-by-step breakdown for one variable.
 *
 * Groups need MIN_GROUP decided cases to appear, so an average never rests on
 * one or two applicants; how many were left out is returned for the chart note.
 * Step averages come from whichever cases filled in both ends of that step, so
 * they need not add up to the total — each carries its own count.
 *
 * @param {object[]} rows cases with outliers already removed
 * @param {(r: object) => string|null} keyOf the group a case belongs to
 */
function breakdown(rows, keyOf, { limit = Infinity } = {}) {
  const byKey = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (k === null || k === undefined || k === '') continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }

  const all = [...byKey.entries()].map(([label, groupRows]) => ({
    label,
    cases: groupRows.length,
    ...timingsOf(groupRows),
  }));
  const eligible = all
    .filter((g) => g.total.count >= MIN_GROUP)
    .sort((a, b) => b.total.count - a.total.count);
  const groups = eligible.slice(0, limit);

  return {
    groups,
    omittedGroups: all.length - groups.length,
    casesSpecifying: [...byKey.values()].reduce((s, g) => s + g.length, 0),
  };
}

/**
 * Yes / No / unknown for one of the extra checks. A date filled in counts as
 * yes even when the yes/no box was left blank; a blank box with no date is
 * unknown, not no.
 */
function yesNo(r, flagField, dateField) {
  if (r[flagField] === 'Yes' || (dateField && parseLooseDate(r[dateField]))) return 'Yes';
  if (r[flagField] === 'No') return 'No';
  return null;
}

/* ---------------- the process line ---------------- */

const STAGE_LABELS = {
  Sent: 'Sent',
  Delivered: 'Delivered',
  AOR: 'AOR',
  'In-process': 'In process',
  'Test letter received': 'Test invite',
  'Test Completed': 'Test done',
  'Decision Made': 'Decision',
  'Oath Letter received': 'Oath letter',
  'Oath completed': 'Oath done',
};

/* ---------------- the summary ---------------- */

/**
 * @param {object[]} records relabelled, filtered citizenship records
 * @param {object} [options]
 * @param {boolean} [options.excludeOutliers] leave extreme durations out of
 *   every timing figure (see detectOutliers)
 * @returns {object} the summary payload for the Citizenship report
 */
export function analyzeCitizenship(records, { excludeOutliers = false } = {}) {
  const total = records.length;

  const outliers = excludeOutliers ? detectOutliers(records) : null;
  const timed = outliers ? records.filter((r) => !outliers.isOutlier(r)) : records;

  /* tiles */
  const decisionReceivedCount = records.filter(isDecided).length;

  /* headline duration, and what it was measured to */
  const totalStats = statsOf(timed.map(totalDays));
  const finishSources = Object.fromEntries(DECISION_SOURCES.map(({ source }) => [source, 0]));
  for (const r of timed) {
    if (totalDays(r) !== null) finishSources[decisionPoint(r).source] += 1;
  }

  /* milestone tiles */
  const steps = STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    band: Boolean(s.band),
    ...statsOf(timed.map((r) => spanDays(r, s.from, s.to))),
  }));
  const longestStep = steps
    .filter((s) => s.band && s.count >= MIN_GROUP)
    .reduce((best, s) => (!best || s.mean > best.mean ? s : best), null);

  /* where applications are now */
  const statusBreakdown = countBy(records, (r) => r[F.status]);
  const stageCounts = CITIZENSHIP_STATUSES.map((status) => ({
    status,
    label: STAGE_LABELS[status],
    count: statusBreakdown[status] || 0,
  }));
  const known = new Set(CITIZENSHIP_STATUSES);
  const otherStatusCount = records.filter((r) => !known.has(r[F.status])).length;

  /* who is applying */
  const monthlyApplications = {};
  for (const r of records) {
    const d = parseLooseDate(r[F.sent]);
    if (!d) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    monthlyApplications[key] = (monthlyApplications[key] || 0) + 1;
  }
  const provinceCounts = countBy(records, (r) => r[F.province]);
  const applicationTypeCounts = countBy(records, (r) => r[F.applicationType]);
  const nationalityCounts = countBy(records, (r) => r[F.nationality]);

  /* step-by-step by group */
  const extra = {
    interview: (r) => yesNo(r, F.interview, F.interviewDate),
    fingerprint: (r) => yesNo(r, F.fingerprint, F.fingerprintDate),
    urgent: (r) => yesNo(r, F.urgent),
  };
  const byGroup = {
    province: breakdown(timed, (r) => r[F.province]),
    applicationType: breakdown(timed, (r) => r[F.applicationType]),
    nationality: breakdown(timed, (r) => r[F.nationality], { limit: TOP_NATIONALITIES }),
    office: breakdown(timed, (r) => r[F.office]),
    interview: breakdown(timed, extra.interview),
    fingerprint: breakdown(timed, extra.fingerprint),
    urgent: breakdown(timed, extra.urgent),
  };

  /* individual cases */
  const cases = timed
    .map((r) => {
      const days = totalDays(r);
      if (days === null) return null;
      const caseId = r['Case ID'] || r['_slugs'] || r['Username'] || 'Unknown';
      const nationality = r[F.nationality] || '';
      const applicationType = r[F.applicationType] || '';
      return {
        caseId,
        nationality,
        applicationType,
        province: r[F.province] || '',
        measuredTo: decisionPoint(r).source,
        days,
        label: [nationality, applicationType, caseId].filter(Boolean).join(' / '),
      };
    })
    .filter(Boolean);
  const slowestCases = [...cases].sort((a, b) => b.days - a.days).slice(0, 5);
  const quickestCases = [...cases].sort((a, b) => a.days - b.days).slice(0, 5);

  /* how many filled in the optional fields */
  const filled = (keyOf) => records.filter((r) => keyOf(r) !== null && keyOf(r) !== undefined && keyOf(r) !== '').length;
  const coverage = {
    nationality: filled((r) => r[F.nationality]),
    province: filled((r) => r[F.province]),
    applicationType: filled((r) => r[F.applicationType]),
    office: filled((r) => r[F.office]),
    interview: filled(extra.interview),
    fingerprint: filled(extra.fingerprint),
    urgent: filled(extra.urgent),
    // Answered at least one of the three — the extra-checks chart's coverage.
    extra: filled((r) => extra.interview(r) || extra.fingerprint(r) || extra.urgent(r)),
    decisionDate: filled((r) => parseLooseDate(r[F.decision])),
  };

  return {
    totalRecordsAnalyzed: total,
    decisionReceivedCount,
    // Defined as the remainder so the tiles always add up to Cases Submitted.
    inProgressCount: total - decisionReceivedCount,

    daysToDecision: totalStats,
    finishSources,
    steps,
    longestStep: longestStep && { id: longestStep.id, label: longestStep.label, meanDays: longestStep.mean, count: longestStep.count },

    statusBreakdown,
    stageCounts,
    otherStatusCount,

    monthlyApplications: Object.fromEntries(Object.entries(monthlyApplications).sort()),
    provinceShares: ranked(provinceCounts),
    applicationTypeShares: ranked(applicationTypeCounts),
    topNationalities: ranked(nationalityCounts, TOP_NATIONALITIES),

    byGroup,
    minGroup: MIN_GROUP,

    slowestCases,
    quickestCases,

    coverage,
    outliers: outliers ? outliers.summary : null,
  };
}
