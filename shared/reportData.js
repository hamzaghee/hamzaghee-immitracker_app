/**
 * Report datasets shared by the React dashboard and the exported report.
 *
 * The newer report blocks need more than a sort: percentages against a partial
 * denominator, a coverage note, a process line. Shaping them once here keeps
 * the on-screen figures and the downloaded ones from drifting apart.
 */

import { fmt } from './chartGeometry.js';

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/**
 * { label: count } -> [{ label, count, value }] sorted by count, where `value`
 * is the percentage of `denominator`.
 */
export function shareRows(counts, denominator) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, value: pct(count, denominator) }));
}

/**
 * { key: { meanDays, count } } -> [{ label, value, count }], busiest first.
 *
 * Sorted by sample size rather than by duration: a group with one completed
 * case can have the most extreme mean, and ranking by mean would put it on top.
 */
export function meanRows(map, names) {
  return Object.entries(map || {})
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, v]) => ({ label: names?.[key] || key, value: v.meanDays, count: v.count }));
}

/**
 * The caveat for an optional field: how many cases actually filled it in.
 * Empty when all of them did.
 * @param {string} lead what is missing, e.g. "Not all applicants specify draw category."
 * @param {number} specified cases with the field filled in
 * @param {number} total cases in scope
 * @param {string} [scope] noun for `total`, e.g. "approved cases"
 */
export function coverageNote(lead, specified, total, scope = 'cases') {
  // Nothing to caveat when every case filled the field in (the demo data does).
  if (specified >= total) return '';
  return `${lead} Figures cover the ${fmt(specified)} of ${fmt(total)} ${scope} (${pct(
    specified,
    total
  )}%) that did.`;
}

export const DRAW_CATEGORY_LEAD = 'Not all applicants specify draw category.';

export const CRS_LEAD = 'Not all applicants report a CRS score.';

/** CRS bands as chart rows. */
export const crsRows = (bands) => (bands || []).map((b) => ({ label: b.label, value: b.count }));

/**
 * Notes for the two CRS charts: coverage, plus for PNP what its scores include
 * and how many look like pre-nomination entries.
 */
export function crsNotes(dist) {
  const g = dist?.general || {};
  const p = dist?.pnp || {};
  const pnpScoring =
    !p.scored || p.belowNomination === p.scored
      ? ''
      : p.belowNomination
    ? `PNP scores include the 600 provincial nomination points. ${fmt(p.belowNomination)} of ${fmt(
        p.scored
      )} report a score below 600, likely entered before nomination; scores are shown as reported.`
    : 'PNP scores include the 600 provincial nomination points.';
  return {
    general: coverageNote(CRS_LEAD, g.scored, g.total, 'FSW and CEC cases'),
    pnp: [coverageNote(CRS_LEAD, p.scored, p.total, 'PNP cases'), pnpScoring].filter(Boolean).join(' '),
  };
}

/**
 * Stable ids for the report's charts. AI notes are attached to a chart by id,
 * and the dashboard and the export both look them up here, so a note lands
 * under the same chart in both.
 */
export const CHART = {
  milestones: 'milestones',
  process: 'process',
  streams: 'stream-breakdown',
  status: 'status',
  countries: 'countries',
  nationalities: 'nationalities',
  streamTimes: 'stream-times',
  drawShare: 'draw-share',
  drawTimes: 'draw-times',
  nationalityTimes: 'nationality-times',
  crsGeneral: 'crs-general',
  crsPnp: 'crs-pnp',
  monthlySubmissions: 'monthly-submissions',
  monthlyTimes: 'monthly-times',
  comparison: 'comparison',
  slowest: 'slowest-cases',
  quickest: 'quickest-cases',
};

/** Charts built from processing times — the ones an excluded case changes. */
const TIMING_CHARTS = new Set([
  CHART.milestones,
  CHART.streamTimes,
  CHART.drawTimes,
  CHART.nationalityTimes,
  CHART.monthlyTimes,
  CHART.comparison,
]);

const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

/**
 * Note for a chart whose figures leave out extreme cases (see
 * server/src/pipeline/outliers.js). Empty when nothing was excluded or the
 * chart is unaffected — the slowest-cases chart only cares about slow ones.
 */
export function outlierNote(s, chartId) {
  const cases = s?.outliers?.cases || [];
  const relevant = cases.filter((c) =>
    TIMING_CHARTS.has(chartId) ||
    (chartId === CHART.slowest && c.direction === 'slow') ||
    (chartId === CHART.quickest && c.direction === 'fast')
  );
  if (!relevant.length) return '';
  const detail = relevant
    .slice(0, 3)
    .map((c) => [`${fmt(c.days)} days`, c.stream, c.nationality].filter(Boolean).join(', '))
    .join('; ');
  const more = relevant.length > 3 ? `; and ${plural(relevant.length - 3, 'other', 'others')}` : '';
  return `Excludes ${plural(relevant.length, 'extreme case', 'extreme cases')} (${detail}${more}) that would distort processing times.`;
}

/** Joins a chart's notes, skipping empty ones. */
export const joinNotes = (...notes) => notes.filter(Boolean).join(' ');

/** Submission → PPR moved into the milestones row; this is its explanation. */
export const END_TO_END_NOTE = 'Total process';

export const PROCESS_NOTE =
  'Cases by their current status. Refused can happen at any stage, so it sits outside the line. Status and PPR date are reported separately, so these counts can differ slightly from the Approved tile.';

/** Stages that count as an outcome rather than a step still in progress. */
const DONE = new Set(['PPR', 'Landed']);

/**
 * The process line: each stage with its count, share of the total, a relative
 * size for the marker, and whether it is a finished state.
 *
 * Express Entry by default. Citizenship passes its own finished states and
 * `withRefused: false` — its tracker records no refusals — and gets
 * `refused: null` back.
 */
export function processStages(s, { done = DONE, withRefused = true } = {}) {
  const stages = s.stageCounts || [];
  const total = s.totalRecordsAnalyzed || 0;
  const refused = withRefused ? { status: 'Refused', label: 'Refused', count: s.refusalCount || 0 } : null;
  const max = Math.max(1, ...stages.map((x) => x.count), refused?.count ?? 0);
  // Area, not diameter, tracks the count — so the radius goes with the root.
  const size = (n) => Math.round(12 + 26 * Math.sqrt(n / max));
  const shape = (x, tone) => ({ ...x, pct: pct(x.count, total), size: size(x.count), tone });
  return {
    stages: stages.map((x) => shape(x, done.has(x.status) ? 'done' : 'active')),
    refused: refused && shape(refused, 'refused'),
    other: s.otherStatusCount || 0,
  };
}
