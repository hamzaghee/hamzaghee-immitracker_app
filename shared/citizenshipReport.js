/**
 * Citizenship report datasets, shared by the React dashboard and the exported
 * report — the counterpart of reportData.js, which shapes Express Entry.
 *
 * Shaping happens once here so the on-screen figures and the downloaded ones
 * cannot drift apart.
 */

import { fmt } from './chartGeometry.js';
import { coverageNote, processStages } from './reportData.js';

/**
 * Stable chart ids. AI notes are attached to a chart by id, and both renderers
 * look them up here.
 */
export const CZ_CHART = {
  milestones: 'milestones',
  process: 'process',
  status: 'status',
  monthlyApplications: 'monthly-applications',
  provinces: 'provinces',
  applicationTypes: 'application-types',
  nationalities: 'nationalities',
  stepsProvince: 'steps-province',
  stepsApplicationType: 'steps-application-type',
  stepsNationality: 'steps-nationality',
  stepsOffice: 'steps-office',
  stepsExtraChecks: 'steps-extra-checks',
  slowest: 'slowest-cases',
  quickest: 'quickest-cases',
};

/** The milestone tiles, in the order the report shows them. */
export const TILE_STEPS = [
  'sentToAor',
  'aorToInProcess',
  'sentToTestInvite',
  'testInviteToTest',
  'testToDecision',
  'decisionToOathLetter',
  'oathLetterToCeremony',
  'aorToBackgroundCheck',
];

/** The steps that make up a step-by-step bar, end to end, with their colour slot. */
export const BANDS = [
  { id: 'sentToAor', label: 'Application → AOR', slot: 0 },
  { id: 'aorToTestInvite', label: 'AOR → test invite', slot: 1 },
  { id: 'testInviteToTest', label: 'Test invite → test', slot: 2 },
  { id: 'testToDecision', label: 'Test → decision', slot: 3 },
];

const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

/* ---------------- notes ---------------- */

/** Under the headline tile: what "decision" was measured to. */
export function finishNote(s) {
  const f = s?.finishSources || {};
  const later = [
    f.oathLetter ? `oath letter (${fmt(f.oathLetter)})` : '',
    f.oathCeremony ? `oath ceremony (${fmt(f.oathCeremony)})` : '',
    f.certificate ? `certificate (${fmt(f.certificate)})` : '',
  ].filter(Boolean);
  if (!later.length) return 'Measured from the application date to the decision date.';
  return (
    `Measured from the application date to the decision date. Most applicants leave the decision date blank, ` +
    `so where it is missing the first later date is used: ${later.join(', ')}. ` +
    `${plural(f.decision || 0, 'case has', 'cases have')} the decision date itself.`
  );
}

/** Applies to every chart built from processing times. */
export function czOutlierNote(s) {
  const o = s?.outliers;
  if (!o?.count) return '';
  return `Excludes ${plural(o.count, 'extreme case', 'extreme cases')} (over ${fmt(o.upperFenceDays)} days${
    o.lowerFenceDays ? ` or under ${fmt(o.lowerFenceDays)}` : ''
  }) that would distort processing times.`;
}

export const STEP_NOTE =
  'Each step is averaged over the cases that recorded both of its dates, so the steps need not add up to the total.';

/** Under a step-by-step chart: the sample rule and any groups it left out. */
export function groupNote(breakdown, minGroup) {
  const omitted = breakdown?.omittedGroups || 0;
  return `${STEP_NOTE} Groups with fewer than ${fmt(minGroup)} decided cases are not shown${
    omitted ? ` (${plural(omitted, 'group', 'groups')})` : ''
  }.`;
}

const LEADS = {
  nationality: 'Not all applicants give their nationality.',
  office: 'Not all applicants name their IRCC office.',
  extra: 'Not all applicants say whether they had an interview, a fingerprint request or urgent processing.',
};

export const coverageFor = (s, key) => coverageNote(LEADS[key], s.coverage?.[key] ?? 0, s.totalRecordsAnalyzed);

export const CZ_PROCESS_NOTE =
  'Cases by their current status. Many applicants stop updating once they hear back, so the later stages are undercounted here; the Decision received tile also counts anyone with a decision, oath letter or ceremony date.';

const DECIDED = new Set(['Decision Made', 'Oath Letter received', 'Oath completed']);

/** The process line, without the Refused marker Express Entry has. */
export const czProcessStages = (s) => processStages(s, { done: DECIDED, withRefused: false });

/* ---------------- rows ---------------- */

/** [{ label, count }] -> [{ label, value, count }] with value as % of total. */
export const shareOf = (rows, total) =>
  (rows || []).map((r) => ({
    label: r.label,
    count: r.count,
    value: total ? Math.round((r.count / total) * 1000) / 10 : 0,
  }));

/**
 * A breakdown as step-by-step bars:
 * [{ label, total, totalCount, segments: [{ id, label, slot, value, count }] }]
 */
export function stepRows(breakdown, relabel = (l) => l) {
  return (breakdown?.groups || []).map((g) => ({
    label: relabel(g.label),
    total: g.total.mean,
    totalCount: g.total.count,
    segments: BANDS.map((b) => ({
      id: b.id,
      label: b.label,
      slot: b.slot,
      value: g.steps[b.id]?.meanDays ?? null,
      count: g.steps[b.id]?.count ?? 0,
    })),
  }));
}

const EXTRA_LABELS = {
  interview: { Yes: 'Interview', No: 'No interview' },
  fingerprint: { Yes: 'Fingerprint request', No: 'No fingerprint request' },
  urgent: { Yes: 'Urgent processing', No: 'No urgent processing' },
};

/** The three extra checks as one chart: each check's "yes" row above its "no" row. */
export function extraCheckRows(byGroup) {
  return Object.entries(EXTRA_LABELS).flatMap(([key, labels]) =>
    stepRows(byGroup?.[key], (l) => labels[l] || l).sort((a, b) =>
      a.label.startsWith('No ') === b.label.startsWith('No ') ? 0 : a.label.startsWith('No ') ? 1 : -1
    )
  );
}

/** Combined omitted-group count for the extra-checks chart note. */
export const extraOmitted = (byGroup) => ({
  omittedGroups: ['interview', 'fingerprint', 'urgent'].reduce((n, k) => n + (byGroup?.[k]?.omittedGroups || 0), 0),
});

/** Table columns and rows for a step-by-step chart's table view. */
export const stepColumns = (groupLabel) => [
  { key: 'label', label: groupLabel },
  ...BANDS.map((b) => ({ key: b.id, label: b.label, num: true })),
  { key: 'total', label: 'Total days', num: true },
  { key: 'totalCount', label: 'Decided cases', num: true },
];

export const stepTableRows = (rows) =>
  rows.map((r) => ({
    key: r.label,
    label: r.label,
    total: r.total,
    totalCount: r.totalCount,
    ...Object.fromEntries(r.segments.map((s) => [s.id, s.value])),
  }));
