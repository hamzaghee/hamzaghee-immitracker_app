/**
 * Standalone HTML report.
 *
 * Emits one self-contained document — inline CSS, inline SVG, no external
 * requests — so it opens offline from a Downloads folder. It is also exactly
 * what Puppeteer renders to PDF, so the two exports cannot disagree.
 *
 * One palette, baked in rather than left to a media query: a PDF has no viewer
 * preference to respond to, and a file emailed onward should look like the one
 * that was exported.
 *
 * Typography and colour mirror web/src/theme.css. The two are separate
 * stylesheets on purpose — this one has to survive with no external requests —
 * so a change to one needs the same change to the other.
 *
 * Built section by section: the report content is still being revised, so each
 * block should be replaceable without touching the others.
 */

import { esc, fmt, PALETTE, STREAM_SLOT } from '../../../shared/chartGeometry.js';
import { parseRichText, sectionTagLabel } from '../../../shared/text.js';
import {
  shareRows,
  meanRows,
  crsRows,
  crsNotes,
  coverageNote,
  outlierNote,
  joinNotes,
  processStages,
  CHART,
  DRAW_CATEGORY_LEAD,
  END_TO_END_NOTE,
  PROCESS_NOTE,
} from '../../../shared/reportData.js';
import { hBar, vBar, lineChart, donut, groupedBar } from './charts.js';
import { FONT_FACE, LOGO_SVG } from './assets.js';

const sortedEntries = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);

/** Sorted entries with the key swapped for its display name. */
const namedEntries = (obj, names) =>
  sortedEntries(obj).map(([code, value]) => ({ label: names?.[code] || code, value }));

const runsToHtml = (runs) =>
  runs.map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join('');

/**
 * Renders a section body.
 *
 * The model writes markdown — a repeated heading, `-` bullets, `**bold**`. Each
 * run is escaped individually and only the tags we generate are emitted, so
 * nothing the model wrote can become an element.
 */
const richText = (s, title) =>
  parseRichText(s, { title })
    .map((b) =>
      b.type === 'ul'
        ? `<ul>${b.items.map((it) => `<li>${runsToHtml(it)}</li>`).join('')}</ul>`
        : `<p>${runsToHtml(b.runs)}</p>`
    )
    .join('');

/* ---------------- building blocks ---------------- */

const tile = ({ label, value, unit, foot, featured = false }) => `
  <div class="tile${featured ? ' featured' : ''}">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${fmt(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>
    ${foot ? `<div class="tile-foot">${esc(foot)}</div>` : ''}
  </div>`;

const card = (title, desc, body, legend = '', note = '', insight = '') => `
  <section class="card">
    <h3>${esc(title)}</h3>
    ${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
    ${body}
    ${legend}
    ${note ? `<p class="card-note">${esc(note)}</p>` : ''}
    ${insight}
  </section>`;

/** One analysis section: the Analysis block's cards and the notes under charts. */
const sectionBlock = (sec, cls = 'an') => `<div class="${cls}">
      <h4>${esc(sec.title)}${
        sectionTagLabel(sec.source)
          ? `<span class="tag">${esc(sectionTagLabel(sec.source))}</span>`
          : ''
      }</h4>
      ${richText(sec.body, sec.title)}
    </div>`;

/** Looks up the AI note for a chart; most charts have none. */
const insightLookup = (sections) => {
  const byChart = new Map(sections.filter((x) => x.chart).map((x) => [x.chart, x]));
  return (chart) => (byChart.has(chart) ? sectionBlock(byChart.get(chart), 'an inline') : '');
};

const legendOf = (items) => `
  <div class="legend">${items
    .map((i) => `<span class="li"><span class="sw" style="background:${i.color}"></span>${esc(i.label)}</span>`)
    .join('')}</div>`;

/* ---------------- sections ---------------- */

const headerSection = (config) => `
  <header class="masthead">
    <img class="brand-mark" src="${LOGO_SVG}" alt="Immitracker">
    <h1>${esc(config.programLabel || 'Express Entry')} Processing Insights</h1>
  </header>`;

function tilesSection(s) {
  const pctOf = (n) =>
    `${(s.totalRecordsAnalyzed ? (n / s.totalRecordsAnalyzed) * 100 : 0).toFixed(1)}% of cases`;
  return `<div class="tiles">
    ${tile({ label: 'Cases Submitted', value: s.totalRecordsAnalyzed, foot: 'In the selected period' })}
    ${tile({ label: 'Approved', value: s.approvedCount, foot: 'Cases that have reached PPR status' })}
    ${tile({ label: 'In Progress', value: s.inProgressCount, foot: pctOf(s.inProgressCount) })}
    ${tile({ label: 'Refused', value: s.refusalCount, foot: pctOf(s.refusalCount) })}
  </div>`;
}

/** Milestones in the order the report spec defines, two of them derived. */
function milestonesSection(s, insightFor) {
  const rows = [
    ['Submission → AOR', s.daysSubmissionToAor],
    ['AOR → Medicals passed', s.daysAorToMeds],
    ['AOR → Biometrics letter', s.daysAorToBil],
    ['AOR → PPR', s.daysAorToPPR],
    ['Biometrics → PPR', s.daysBilToPPR],
    ['Medicals → PPR', s.daysMedsToPPR],
  ];
  return `<h2>Processing Milestones</h2>
  <div class="milestones">
    ${tile({
      featured: true,
      label: 'Submission → PPR',
      value: s.daysSubmissionToPPR.mean,
      unit: 'days',
      foot: `Average of all completed cases · ${fmt(s.daysSubmissionToPPR.count)} cases`,
    })}
    ${rows
      .map(([label, st]) =>
        tile({ label, value: st.mean, unit: 'days', foot: `Total cases: ${fmt(st.count)}` })
      )
      .join('')}
  </div>
  <p class="tile-note"><span class="tile-note-swatch"></span>${esc(END_TO_END_NOTE)}</p>
  ${outlierNote(s, CHART.milestones) ? `<p class="card-note milestone-note">${esc(outlierNote(s, CHART.milestones))}</p>` : ''}
  ${insightFor(CHART.milestones) ? `<div class="milestone-insight">${insightFor(CHART.milestones)}</div>` : ''}
  ${processSection(s, insightFor)}`;
}

/** Same structure as web/src/components/ProcessLine.jsx. */
function processSection(s, insightFor) {
  const { stages, refused, other } = processStages(s);
  if (!stages.length) return '';
  const stage = (st, tag = 'li', cls = 'stage') => `
    <${tag} class="${cls} tone-${st.tone}">
      <span class="stage-track"><span class="stage-dot" style="width:${st.size}px;height:${st.size}px"></span></span>
      <span class="stage-count">${fmt(st.count)}</span>
      <span class="stage-label">${esc(st.label)}</span>
      <span class="stage-pct">${st.pct}%</span>
    </${tag}>`;
  const otherNote = other ? ` ${fmt(other)} cases have another or no status and are not shown.` : '';
  return `<section class="card">
    <h3>Where applications are now</h3>
    <div class="process">
      <ol class="process-line">${stages.map((st) => stage(st)).join('')}</ol>
      ${stage(refused, 'div', 'stage process-aside')}
    </div>
    <p class="card-note">${esc(PROCESS_NOTE + otherNote)}</p>
    ${insightFor(CHART.process)}
  </section>`;
}

/** The Analysis block. Chart notes are placed under their charts instead. */
function analysisSection(sections) {
  const own = sections.filter((sec) => !sec.chart);
  if (!own.length) return '';
  return `<h2>Analysis</h2>
  <div class="analysis">
    ${own.map((sec) => sectionBlock(sec)).join('')}
  </div>`;
}

function chartsSection(s, config, P, insightFor) {
  const streamColor = (name) => P.series[STREAM_SLOT[name] ?? 0];
  const opts = { palette: P };

  const streams = sortedEntries(s.streamDistribution).map(([label, value]) => ({
    label,
    value,
    color: streamColor(label),
  }));
  const statuses = sortedEntries(s.statusBreakdown).map(([label, value]) => ({ label, value }));
  // Country codes are resolved to names for display; the underlying maps stay
  // keyed by code so the pinned-output comparison keeps working.
  const countries = namedEntries(s.topCountriesOfResidence, s.countryNames);
  const nationalities = namedEntries(s.topNationalities, s.countryNames);
  const streamAvg = sortedEntries(s.streamVsSubmissionToPPR).map(([label, value]) => ({
    label,
    value,
    color: streamColor(label),
  }));
  const monthly = Object.entries(s.monthlySubmissions).map(([label, value]) => ({ label, value }));
  const monthlyTimes = Object.entries(s.monthlyProcessingTimes).map(([label, v]) => ({
    label,
    value: v.meanDays,
  }));

  // Comparison: all programmes always, the selected one emphasised.
  const anySelected = config.stream && config.stream !== 'all';
  const comparison = (s.streamComparison || []).map((c) => {
    const recede = anySelected && config.stream !== c.key;
    return {
      label: c.label,
      highlighted: config.stream === c.key,
      values: [
        { name: 'Longest case', value: c.longest, color: recede ? P.muted : P.series[1] },
        { name: 'Shortest case', value: c.shortest, color: recede ? P.muted : P.series[0] },
      ],
    };
  });

  const caseBars = (arr) => arr.map((c) => ({ label: c.label || c.slug || c.caseId, value: c.days }));

  // Draw category and nationality timings — shaped by shared/reportData.js
  // exactly as the dashboard shapes them.
  const drawShare = shareRows(s.drawCategoryCounts, s.drawCategorySpecified);
  const drawTimes = meanRows(s.processingByDrawCategory);
  const drawTimesSpecified = drawTimes.reduce((n, d) => n + d.count, 0);
  const nationalityTimes = meanRows(s.processingByNationality, s.countryNames);
  const total = s.totalRecordsAnalyzed;

  // CRS: general and PNP apart, as on the dashboard. A stream filter can leave
  // one side empty, in which case its card is dropped.
  const crs = s.crsDistribution || {};
  const crsNote = crsNotes(crs);
  const crsCard = (title, part, width, note, chart) =>
    part?.bands?.length
      ? card(
          title,
          `Cases per ${width}-point band · median ${fmt(part.median)}`,
          vBar(crsRows(part.bands), opts),
          '',
          note,
          insightFor(chart)
        )
      : '';
  const excluded = (chart) => outlierNote(s, chart);

  return `
  ${card('Stream breakdown', 'Share of cases by program category', donut(streams, opts), legendOf(streams.map((d) => ({ label: `${d.label} — ${fmt(d.value)}`, color: d.color }))), '', insightFor(CHART.streams))}
  ${card('Application status', 'Where cases currently sit in the pipeline', hBar(statuses, { ...opts, gutter: 150 }), '', '', insightFor(CHART.status))}
  ${card('Top 10 countries of residence', 'Where applicants were living when they applied', hBar(countries, { ...opts, gutter: 170 }), '', '', insightFor(CHART.countries))}
  ${card('Top 10 nationalities', 'Applicant nationality', hBar(nationalities, { ...opts, gutter: 170 }), '', '', insightFor(CHART.nationalities))}
  ${card('Average Submission → PPR by stream', 'Mean elapsed days, coloured by stream', hBar(streamAvg, { ...opts, gutter: 130, suffix: 'd' }), '', excluded(CHART.streamTimes), insightFor(CHART.streamTimes))}
  ${card('Cases by draw category', 'Percentage of cases in each Express Entry draw category', hBar(drawShare, { ...opts, gutter: 210, suffix: '%' }), '', coverageNote(DRAW_CATEGORY_LEAD, s.drawCategorySpecified, total), insightFor(CHART.drawShare))}
  ${card('Average processing time by draw category', 'Mean Submission → PPR of completed cases, busiest category first', hBar(drawTimes, { ...opts, gutter: 210, suffix: 'd' }), '', joinNotes(coverageNote(DRAW_CATEGORY_LEAD, drawTimesSpecified, s.daysSubmissionToPPR.count, 'completed cases'), excluded(CHART.drawTimes)), insightFor(CHART.drawTimes))}
  ${card('Average processing time by nationality', 'Mean Submission → PPR for the 10 nationalities with the most completed cases', hBar(nationalityTimes, { ...opts, gutter: 170, suffix: 'd' }), '', excluded(CHART.nationalityTimes), insightFor(CHART.nationalityTimes))}
  ${crsCard('CRS score distribution — FSW & CEC', crs.general, 25, crsNote.general, CHART.crsGeneral)}
  ${crsCard('CRS score distribution — PNP', crs.pnp, 50, crsNote.pnp, CHART.crsPnp)}
  ${card('Monthly submissions', 'Cases by month of submission', lineChart(monthly, { ...opts, gradientId: 'g-subs' }), '', '', insightFor(CHART.monthlySubmissions))}
  ${card('Monthly processing times', 'Average Submission → PPR by month of submission', lineChart(monthlyTimes, { ...opts, suffix: 'd', gradientId: 'g-times' }), '', excluded(CHART.monthlyTimes), insightFor(CHART.monthlyTimes))}
  ${card(
    'Comparison of min & max processing times',
    'Longest and shortest Submission → PPR per program, within the selected period',
    groupedBar(comparison, opts),
    legendOf([
      { label: 'Longest case', color: P.series[1] },
      { label: 'Shortest case', color: P.series[0] },
    ]),
    excluded(CHART.comparison),
    insightFor(CHART.comparison)
  )}
  ${card('5 slowest cases', 'Longest Submission → PPR durations', hBar(caseBars(s.slowestCases), { ...opts, gutter: 190, suffix: 'd' }), '', excluded(CHART.slowest), insightFor(CHART.slowest))}
  ${card('5 quickest cases', 'Shortest Submission → PPR durations', hBar(caseBars(s.quickestCases), { ...opts, gutter: 190, suffix: 'd' }), '', excluded(CHART.quickest), insightFor(CHART.quickest))}`;
}

/* ---------------- document ---------------- */

const styles = (P) => `
  ${FONT_FACE}
  *{box-sizing:border-box}
  body{margin:0;background:${P.page};color:${P.textPrimary};
    font-family:'Mulish',system-ui,-apple-system,"Segoe UI",sans-serif;
    font-size:16px;line-height:24px;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1000px;margin:0 auto;padding:32px 24px 48px}

  .masthead{display:flex;align-items:center;gap:16px;
    border-bottom:1px solid ${P.border};padding-bottom:24px;margin-bottom:24px}
  .brand-mark{height:36px;width:auto;flex-shrink:0;display:block}

  h1{font-size:28px;line-height:36px;font-weight:800;letter-spacing:-.01em;margin:0}
  h2{font-size:18px;line-height:26px;font-weight:800;margin:32px 0 16px}
  h3{font-size:16px;line-height:24px;font-weight:800;margin:0}
  h4{font-size:18px;line-height:26px;font-weight:800;margin:0 0 8px}
  .desc{font-size:13px;line-height:20px;color:${P.textSecondary};margin:4px 0 16px}

  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin-bottom:24px}
  .milestones{display:grid;grid-template-columns:minmax(180px,1.15fr) repeat(3,minmax(0,1fr));gap:16px}
  .milestones .featured{grid-row:span 2}
  .tile.featured{background:${P.accentWash};border-color:${P.accent}}
  .tile-note{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:20px;
    color:${P.textSecondary};margin:12px 0 24px}
  .tile-note-swatch{flex:0 0 auto;width:12px;height:12px;margin-top:4px;border-radius:3px;
    background:${P.accentWash};border:1px solid ${P.accent}}
  .card-note{font-size:13px;line-height:20px;color:${P.textMuted};margin:16px 0 0}

  .process{display:flex;align-items:flex-start;gap:16px;margin-top:16px}
  .process-line{flex:1;display:flex;list-style:none;margin:0;padding:0}
  .stage{flex:1 1 0;min-width:0;position:relative;display:flex;flex-direction:column;
    align-items:center;text-align:center}
  .process-line .stage+.stage::before{content:'';position:absolute;top:22px;right:50%;
    width:100%;height:2px;background:${P.baseline}}
  .stage-track{position:relative;z-index:1;height:44px;display:flex;align-items:center;justify-content:center}
  .stage-dot{display:block;border-radius:999px;background:${P.accent};box-shadow:0 0 0 3px ${P.surface}}
  .tone-done .stage-dot{background:${P.good}}
  .tone-refused .stage-dot{background:${P.critical}}
  .stage-count{font-size:18px;line-height:26px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:8px}
  .stage-label{font-size:12px;line-height:16px;font-weight:800;color:${P.textSecondary};padding:0 2px}
  .stage-pct{font-size:12px;line-height:18px;color:${P.textMuted}}
  .process-aside{flex:0 0 84px;border-left:1px dashed ${P.baseline};padding-left:12px}
  .tile,.card{background:${P.surface};border:1px solid ${P.border};border-radius:20px}
  /* Flex column so a wrapped label takes the slack above the value, leaving
     every number in a row on the same baseline. */
  .tile{padding:24px;display:flex;flex-direction:column}
  .tile-value{margin-top:auto}
  .tile-label{font-size:13px;line-height:20px;color:${P.textSecondary};font-weight:800}
  .tile-value{font-size:28px;line-height:36px;font-weight:800;letter-spacing:-.01em;
    padding-top:4px;font-variant-numeric:tabular-nums}
  .tile-value .unit{font-size:16px;font-weight:400;color:${P.textSecondary};margin-left:4px;letter-spacing:0}
  .tile-foot{font-size:13px;line-height:20px;color:${P.textMuted};margin-top:4px}

  .card{padding:24px;margin-bottom:24px}
  .legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:12px}
  .li{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:${P.textSecondary}}
  .sw{width:10px;height:10px;border-radius:999px;flex:0 0 auto}

  .analysis{display:grid;gap:12px}
  .an{background:${P.surface};border:1px solid ${P.border};border-left:3px solid ${P.primary};
    border-radius:14px;padding:16px 24px}
  .an p{margin:0 0 8px;font-size:16px;line-height:24px;color:${P.textSecondary}}
  .an p:last-child{margin-bottom:0}
  .an ul{margin:4px 0 8px;padding-left:24px;font-size:16px;line-height:24px;color:${P.textSecondary}}
  .an ul:last-child{margin-bottom:0}
  .an li{margin:4px 0}
  .an.inline{margin-top:16px;padding:12px 16px;background:${P.page}}
  .an.inline h4{font-size:13px;line-height:20px}
  .an.inline p,.an.inline ul{font-size:13px;line-height:20px}
  .milestone-note{margin:0 0 16px}
  .milestone-insight .an.inline{margin:0 0 24px}
  .tag{font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;
    color:${P.textSecondary};background:${P.page};border:1px solid ${P.border};border-radius:999px;
    padding:4px 12px;margin-left:8px;vertical-align:middle}

  .empty{font-size:13px;line-height:20px;color:${P.textSecondary};margin:8px 0}
  .note{font-size:13px;line-height:20px;color:${P.textSecondary};background:${P.surface};
    border:1px solid ${P.border};border-left:3px solid ${P.warning};border-radius:14px;
    padding:16px;margin-bottom:24px}

  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    /* The PDF is generated with zero page margins so the page background
       reaches the paper edge; the page inset lives here instead. */
    .wrap{max-width:none;padding:14mm 12mm 16mm}
    .card,.tile,.an{break-inside:avoid;page-break-inside:avoid}
    h2{break-after:avoid;page-break-after:avoid}
  }`;

/**
 * @param {object} args
 * @param {object} args.summary   analyze() output
 * @param {object[]} args.sections analysis sections, already filtered/overridden
 * @param {object} args.config    { programLabel, streamLabel, periodLabel, stream }
 * @param {string} [args.notice]  optional banner, e.g. AI analysis skipped
 * @returns {string} a complete HTML document
 */
export function renderReportHtml({ summary, sections = [], config = {}, notice = '' }) {
  const P = PALETTE;
  const insightFor = insightLookup(sections);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(config.programLabel || 'Express Entry')} Processing Insights</title>
<style>${styles(P)}</style>
</head>
<body>
<div class="wrap">
${headerSection(config)}
${notice ? `<p class="note">${esc(notice)}</p>` : ''}
${tilesSection(summary)}
${milestonesSection(summary, insightFor)}
${analysisSection(sections)}
<h2>Charts</h2>
${chartsSection(summary, config, P, insightFor)}
</div>
</body>
</html>`;
}
