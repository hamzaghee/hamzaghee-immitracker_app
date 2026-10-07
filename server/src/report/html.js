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
import { hBar, lineChart, donut, groupedBar } from './charts.js';
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

const tile = ({ label, value, unit, foot }) => `
  <div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${fmt(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>
    ${foot ? `<div class="tile-foot">${esc(foot)}</div>` : ''}
  </div>`;

const card = (title, desc, body, legend = '') => `
  <section class="card">
    <h3>${esc(title)}</h3>
    ${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
    ${body}
    ${legend}
  </section>`;

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
  const pct = s.totalRecordsAnalyzed
    ? ((s.refusalCount / s.totalRecordsAnalyzed) * 100).toFixed(1)
    : '0.0';
  return `<div class="tiles">
    ${tile({ label: 'Cases Submitted', value: s.totalRecordsAnalyzed, foot: 'In the selected period' })}
    ${tile({ label: 'Approved', value: s.approvedCount, foot: 'Cases that have reached PPR status' })}
    ${tile({ label: 'Refused', value: s.refusalCount, foot: `${pct}% of cases` })}
    ${tile({
      label: 'Submission → PPR',
      value: s.daysSubmissionToPPR.mean,
      unit: 'days',
      foot: `Total cases: ${fmt(s.daysSubmissionToPPR.count)}`,
    })}
  </div>`;
}

/** Milestones in the order the report spec defines, two of them derived. */
function milestonesSection(s) {
  const rows = [
    ['Submission → AOR', s.daysSubmissionToAor],
    ['AOR → Medicals passed', s.daysAorToMeds],
    ['AOR → Biometrics letter', s.daysAorToBil],
    ['AOR → PPR', s.daysAorToPPR],
    ['Biometrics → PPR', s.daysBilToPPR],
    ['Medicals → PPR', s.daysMedsToPPR],
  ];
  return `<h2>Processing Milestones</h2>
  <div class="tiles six">
    ${rows
      .map(([label, st]) =>
        tile({ label, value: st.mean, unit: 'days', foot: `Total cases: ${fmt(st.count)}` })
      )
      .join('')}
  </div>`;
}

function analysisSection(sections) {
  if (!sections.length) return '';
  return `<h2>Analysis</h2>
  <div class="analysis">
    ${sections
      .map(
        (sec) => `<div class="an">
      <h4>${esc(sec.title)}${
        sectionTagLabel(sec.source)
          ? `<span class="tag">${esc(sectionTagLabel(sec.source))}</span>`
          : ''
      }</h4>
      ${richText(sec.body, sec.title)}
    </div>`
      )
      .join('')}
  </div>`;
}

function chartsSection(s, config, P) {
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

  return `
  ${card('Stream breakdown', 'Share of cases by program category', donut(streams, opts), legendOf(streams.map((d) => ({ label: `${d.label} — ${fmt(d.value)}`, color: d.color }))))}
  ${card('Application status', 'Where cases currently sit in the pipeline', hBar(statuses, { ...opts, gutter: 150 }))}
  ${card('Top 10 countries of residence', 'Where applicants were living when they applied', hBar(countries, { ...opts, gutter: 170 }))}
  ${card('Top 10 nationalities', 'Applicant nationality', hBar(nationalities, { ...opts, gutter: 170 }))}
  ${card('Average Submission → PPR by stream', 'Mean elapsed days, coloured by stream', hBar(streamAvg, { ...opts, gutter: 130, suffix: 'd' }))}
  ${card('Monthly submissions', 'Cases by month of submission', lineChart(monthly, { ...opts, gradientId: 'g-subs' }))}
  ${card('Monthly processing times', 'Average Submission → PPR by month of submission', lineChart(monthlyTimes, { ...opts, suffix: 'd', gradientId: 'g-times' }))}
  ${card(
    'Comparison of min & max processing times',
    'Longest and shortest Submission → PPR per program, within the selected period',
    groupedBar(comparison, opts),
    legendOf([
      { label: 'Longest case', color: P.series[1] },
      { label: 'Shortest case', color: P.series[0] },
    ])
  )}
  ${card('5 slowest cases', 'Longest Submission → PPR durations', hBar(caseBars(s.slowestCases), { ...opts, gutter: 190, suffix: 'd' }))}
  ${card('5 quickest cases', 'Shortest Submission → PPR durations', hBar(caseBars(s.quickestCases), { ...opts, gutter: 190, suffix: 'd' }))}`;
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
  .tiles.six{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
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
  .tag{font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;
    color:${P.textSecondary};background:${P.page};border:1px solid ${P.border};border-radius:999px;
    padding:4px 12px;margin-left:8px;vertical-align:middle}

  .empty{font-size:13px;line-height:20px;color:${P.textSecondary};margin:8px 0}
  .note{font-size:13px;line-height:20px;color:${P.textSecondary};background:${P.surface};
    border:1px solid ${P.border};border-left:3px solid ${P.warning};border-radius:14px;
    padding:16px;margin-bottom:24px}

  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .wrap{max-width:none;padding:0}
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
${milestonesSection(summary)}
${analysisSection(sections)}
<h2>Charts</h2>
${chartsSection(summary, config, P)}
</div>
</body>
</html>`;
}
