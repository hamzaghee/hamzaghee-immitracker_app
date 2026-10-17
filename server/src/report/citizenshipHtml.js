/**
 * Standalone HTML report for Citizenship — the counterpart of html.js, built
 * from the same building blocks, styles and chart builders so the two report
 * types look like one product.
 *
 * Same contract as html.js: one self-contained document, no external
 * requests, and exactly what Puppeteer renders to PDF. Its layout mirrors
 * web/src/components/CitizenshipReport.jsx; a change to one needs the same
 * change to the other.
 */

import { esc, fmt, PALETTE } from '../../../shared/chartGeometry.js';
import {
  CZ_CHART,
  TILE_STEPS,
  BANDS,
  finishNote,
  czOutlierNote,
  groupNote,
  coverageFor,
  czProcessStages,
  CZ_PROCESS_NOTE,
  shareOf,
  stepRows,
  extraCheckRows,
  extraOmitted,
} from '../../../shared/citizenshipReport.js';
import { joinNotes } from '../../../shared/reportData.js';
import { hBar, lineChart, donut, stackedBar } from './charts.js';
import {
  tile,
  card,
  insightLookup,
  legendOf,
  headerSection,
  analysisSection,
  processSection,
  styles,
} from './html.js';

/** The headline tiles. Decision received and In progress add up to the total. */
function tilesSection(s) {
  const pctOf = (n) => `${(s.totalRecordsAnalyzed ? (n / s.totalRecordsAnalyzed) * 100 : 0).toFixed(1)}% of cases`;
  return `<div class="tiles">
    ${tile({ label: 'Cases Submitted', value: s.totalRecordsAnalyzed, foot: 'In the selected period' })}
    ${tile({ label: 'Decision Received', value: s.decisionReceivedCount, foot: `${pctOf(s.decisionReceivedCount)} · decision or a later step` })}
    ${tile({ label: 'In Progress', value: s.inProgressCount, foot: pctOf(s.inProgressCount) })}
  </div>`;
}

function milestonesSection(s, insightFor) {
  const byId = Object.fromEntries(s.steps.map((x) => [x.id, x]));
  const total = s.daysToDecision;
  return `<h2>Processing Milestones</h2>
  <div class="milestones tall">
    ${tile({
      featured: true,
      label: 'Application → Decision',
      value: total.mean ?? '—',
      unit: total.mean === null ? '' : 'days',
      foot: `Average of all decided cases · ${fmt(total.count)} cases`,
    })}
    ${TILE_STEPS.map((id) => byId[id])
      .filter(Boolean)
      .map((st) =>
        tile({ label: st.label, value: st.mean ?? '—', unit: st.mean === null ? '' : 'days', foot: `Total cases: ${fmt(st.count)}` })
      )
      .join('')}
  </div>
  <p class="tile-note"><span class="tile-note-swatch"></span>${esc(finishNote(s))}</p>
  ${czOutlierNote(s) ? `<p class="card-note milestone-note">${esc(czOutlierNote(s))}</p>` : ''}
  ${insightFor(CZ_CHART.milestones) ? `<div class="milestone-insight">${insightFor(CZ_CHART.milestones)}</div>` : ''}
  ${processSection(s, insightFor, { data: czProcessStages(s), note: CZ_PROCESS_NOTE, chart: CZ_CHART.process })}`;
}

/**
 * A step-by-step card. The export has no table toggle, so the figures behind
 * the bars are printed underneath — colour alone never carries a value.
 */
function stepsCard(title, desc, rows, note, insight, P) {
  const legend = legendOf(BANDS.map((b) => ({ label: b.label, color: P.series[b.slot] })));
  const table = rows.length
    ? `<table class="data"><thead><tr><th>Group</th>${BANDS.map((b) => `<th class="num">${esc(b.label)}</th>`).join('')}<th class="num">Total</th><th class="num">Cases</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr><td>${esc(r.label)}</td>${r.segments
              .map((x) => `<td class="num">${x.value === null ? '—' : fmt(Math.round(x.value))}</td>`)
              .join('')}<td class="num">${fmt(Math.round(r.total))}</td><td class="num">${fmt(r.totalCount)}</td></tr>`
        )
        .join('')}</tbody></table>`
    : '';
  // Legend between the bars and the table, next to the colours it explains.
  return card(title, desc, stackedBar(rows, { palette: P }) + legend + table, '', note, insight);
}

function chartsSection(s, P, insightFor) {
  const opts = { palette: P };
  const total = s.totalRecordsAnalyzed;
  const timing = czOutlierNote(s);

  const statuses = Object.entries(s.statusBreakdown || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
  const monthly = Object.entries(s.monthlyApplications || {}).map(([label, value]) => ({ label, value }));
  const provinces = shareOf(s.provinceShares, total);
  const types = (s.applicationTypeShares || []).map((r, i) => ({ label: r.label, value: r.count, color: P.series[i] }));
  const nationalities = (s.topNationalities || []).map((r) => ({ label: r.label, value: r.count }));
  const caseBars = (arr) => arr.map((c) => ({ label: c.label, value: c.days }));
  const g = s.byGroup || {};

  return `
  <h2>Step by Step</h2>
  ${stepsCard('By province', 'Average days at each step, and in total, for decided cases', stepRows(g.province), joinNotes(groupNote(g.province, s.minGroup), timing), insightFor(CZ_CHART.stepsProvince), P)}
  ${stepsCard('Single vs family', 'Average days at each step, and in total, for decided cases', stepRows(g.applicationType), joinNotes(groupNote(g.applicationType, s.minGroup), timing), insightFor(CZ_CHART.stepsApplicationType), P)}
  ${stepsCard('By nationality', 'The 10 nationalities with the most decided cases', stepRows(g.nationality), joinNotes(groupNote(g.nationality, s.minGroup), coverageFor(s, 'nationality'), timing), insightFor(CZ_CHART.stepsNationality), P)}
  ${stepsCard('By IRCC office', 'Average days at each step, by the office processing the application', stepRows(g.office), joinNotes(groupNote(g.office, s.minGroup), coverageFor(s, 'office'), timing), insightFor(CZ_CHART.stepsOffice), P)}
  ${stepsCard('Extra checks', 'With and without an interview, a fingerprint request or urgent processing', extraCheckRows(g), joinNotes(groupNote(extraOmitted(g), s.minGroup), coverageFor(s, 'extra'), timing), insightFor(CZ_CHART.stepsExtraChecks), P)}


  <h2>Who Is Applying</h2>
  ${card('Application status', 'Where cases currently sit in the process', hBar(statuses, { ...opts, gutter: 160 }), '', '', insightFor(CZ_CHART.status))}
  ${card('Monthly applications', 'Cases by the month the application was sent', lineChart(monthly, { ...opts, gradientId: 'g-apps' }), '', '', insightFor(CZ_CHART.monthlyApplications))}
  ${card('Cases by province', 'Share of cases by the province the applicant lives in', hBar(provinces, { ...opts, gutter: 170, suffix: '%' }), '', '', insightFor(CZ_CHART.provinces))}
  ${card('Single and family applications', 'Share of cases by application type', donut(types, opts), legendOf(types.map((d) => ({ label: `${d.label} — ${fmt(d.value)}`, color: d.color }))), '', insightFor(CZ_CHART.applicationTypes))}
  ${card('Top 10 nationalities', 'Applicant nationality', hBar(nationalities, { ...opts, gutter: 170 }), '', coverageFor(s, 'nationality'), insightFor(CZ_CHART.nationalities))}

  <h2>Individual Cases</h2>
  ${card('5 slowest cases', 'Longest application to decision', hBar(caseBars(s.slowestCases), { ...opts, gutter: 230, suffix: 'd' }), '', timing, insightFor(CZ_CHART.slowest))}
  ${card('5 quickest cases', 'Shortest application to decision', hBar(caseBars(s.quickestCases), { ...opts, gutter: 230, suffix: 'd' }), '', timing, insightFor(CZ_CHART.quickest))}`;
}

/** Table styles for the step-by-step figures, which only this report prints. */
const extraStyles = (P) => `
  table.data{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px;line-height:18px}
  table.data th{font-weight:800;color:${P.textSecondary};text-align:left;border-bottom:1px solid ${P.border};padding:4px 8px}
  table.data td{color:${P.textSecondary};border-bottom:1px solid ${P.page};padding:4px 8px}
  table.data .num{text-align:right;font-variant-numeric:tabular-nums}
  .milestones.tall .featured{grid-row:span 3}`;

/**
 * @param {object} args
 * @param {object} args.summary   analyzeCitizenship() output
 * @param {object[]} args.sections analysis sections, already filtered/overridden
 * @param {object} args.config    the report configuration
 * @param {string} [args.notice]  optional banner, e.g. AI analysis skipped
 * @returns {string} a complete HTML document
 */
export function renderCitizenshipHtml({ summary, sections = [], config = {}, notice = '' }) {
  const P = PALETTE;
  const insightFor = insightLookup(sections);
  const filters = [config.applicationTypeLabel, config.provinceLabel, config.periodLabel].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Citizenship Processing Insights</title>
<style>${styles(P)}${extraStyles(P)}</style>
</head>
<body>
<div class="wrap">
${headerSection({ ...config, programLabel: 'Citizenship' })}
${filters ? `<p class="desc">${esc(filters)}</p>` : ''}
${notice ? `<p class="note">${esc(notice)}</p>` : ''}
${tilesSection(summary)}
${milestonesSection(summary, insightFor)}
${analysisSection(sections)}
${chartsSection(summary, P, insightFor)}
</div>
</body>
</html>`;
}
