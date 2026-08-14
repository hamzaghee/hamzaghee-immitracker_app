/**
 * Standalone HTML report.
 *
 * Emits one self-contained document — inline CSS, inline SVG, no external
 * requests — so it opens offline from a Downloads folder. It is also exactly
 * what Puppeteer renders to PDF, so the two exports cannot disagree.
 *
 * Renders in light or dark to match the theme the user was viewing when they
 * pressed download. Colours are baked in rather than left to a media query:
 * a PDF has no viewer preference to respond to, and a file emailed onward
 * should look like the one that was exported.
 *
 * Built section by section: the report content is still being revised, so each
 * block should be replaceable without touching the others.
 */

import { esc, fmt, PALETTE, STREAM_SLOT } from '../../../shared/chartGeometry.js';
import { parseRichText, sectionTagLabel } from '../../../shared/text.js';
import { hBar, lineChart, donut, groupedBar } from './charts.js';

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

function chartsSection(s, config, P, mode) {
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
  ${card('Monthly submissions', 'Cases by month of submission', lineChart(monthly, { ...opts, gradientId: `g-subs-${mode}` }))}
  ${card('Monthly processing times', 'Average Submission → PPR by month of submission', lineChart(monthlyTimes, { ...opts, suffix: 'd', gradientId: `g-times-${mode}` }))}
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
  *{box-sizing:border-box}
  body{margin:0;background:${P.page};color:${P.textPrimary};
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55;}
  .wrap{max-width:1000px;margin:0 auto;padding:2rem 1.5rem 3rem}
  .masthead{border-bottom:1px solid ${P.border};padding-bottom:1rem;margin-bottom:1.5rem}
  h1{font-size:1.5rem;font-weight:650;margin:0;letter-spacing:-.01em}
  h2{font-size:1.1rem;font-weight:640;margin:2rem 0 .85rem}
  h3{font-size:.98rem;font-weight:620;margin:0}
  h4{font-size:.92rem;font-weight:620;margin:0 0 .3rem}
  .desc{font-size:.8rem;color:${P.textSecondary};margin:.15rem 0 .9rem}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1rem;margin-bottom:1.25rem}
  .tiles.six{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
  .tile,.card{background:${P.surface};border:1px solid ${P.border};border-radius:10px}
  .tile{padding:1rem 1.1rem}
  .tile-label{font-size:.78rem;color:${P.textSecondary};font-weight:500}
  .tile-value{font-size:1.75rem;font-weight:650;margin-top:.3rem;letter-spacing:-.02em;line-height:1.1}
  .tile-value .unit{font-size:.9rem;font-weight:500;color:${P.textSecondary};margin-left:.25rem}
  .tile-foot{font-size:.75rem;color:${P.textMuted};margin-top:.3rem}
  .card{padding:1.1rem 1.2rem 1.2rem;margin-bottom:1.25rem}
  .legend{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin-top:.9rem}
  .li{display:flex;align-items:center;gap:.4rem;font-size:.8rem;color:${P.textSecondary}}
  .sw{width:10px;height:10px;border-radius:2px;flex:0 0 auto}
  .analysis{display:grid;gap:.85rem}
  .an{background:${P.surface};border:1px solid ${P.border};border-left:3px solid ${P.series[0]};
    border-radius:8px;padding:.9rem 1.1rem}
  .an p{margin:0 0 .5rem;font-size:.9rem;color:${P.textSecondary}}
  .an p:last-child{margin-bottom:0}
  .an ul{margin:.2rem 0 .5rem;padding-left:1.1rem;font-size:.9rem;color:${P.textSecondary}}
  .an ul:last-child{margin-bottom:0}
  .an li{margin:.15rem 0}
  .tag{font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;font-weight:650;
    color:${P.textMuted};border:1px solid ${P.border};border-radius:4px;padding:.05rem .3rem;margin-left:.45rem;vertical-align:middle}
  .empty{font-size:.85rem;color:${P.textMuted};margin:.5rem 0}
  .note{font-size:.82rem;color:${P.textSecondary};background:${P.surface};
    border:1px solid ${P.border};border-left:3px solid ${P.series[3]};border-radius:8px;padding:.75rem 1rem;margin-bottom:1.25rem}
  @media print{
    /* Keep the chosen theme in print — a dark export should stay dark. */
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
 * @param {'light'|'dark'} [args.theme]
 * @returns {string} a complete HTML document
 */
export function renderReportHtml({ summary, sections = [], config = {}, notice = '', theme = 'light' }) {
  const mode = theme === 'dark' ? 'dark' : 'light';
  const P = PALETTE[mode];

  return `<!doctype html>
<html lang="en" data-theme="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${mode}">
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
${chartsSection(summary, config, P, mode)}
</div>
</body>
</html>`;
}
