/**
 * Report analysis — the "AI Analysis" stage.
 *
 * Three kinds of text, from three sources:
 *
 *   Analyses 1-3 are *computed*. The report spec gives exact sentence
 *   templates with numeric slots, so a language model adds nothing but risk;
 *   these are filled from the summary and are always correct and always
 *   present, even with no model running.
 *
 *   The executive summary, the key takeaways and the notes under each chart
 *   are *generated*. Code first runs a bank of questions over the data
 *   (findings.js) and keeps only the answers that stand out; the model writes
 *   those up in plain language and may skip any the chart already makes
 *   obvious. So there is not a note for every chart — only where there is
 *   something worth saying.
 *
 *   Everything generated is then fact-checked (factCheck.js): in code, then by
 *   a second, separate model call. Whatever fails is removed, and if the check
 *   cannot run, nothing generated is published.
 *
 * Every section carries { id, title, body, source } so the report page can hide
 * or replace any of them individually; chart notes also carry `chart`, the id
 * of the chart they sit under.
 */

import { daysToMonths } from './analyze.js';
import { generateJson, llmConfigured, probeLlm } from './llm.js';
import { mechanicalCheck, reviewWithModel } from './factCheck.js';
import { glossaryText } from './glossary.js';
import { CHART } from '../../../shared/reportData.js';

export { probeLlm };

/** Whole budget for both model calls, writer and reviewer. */
const TOTAL_BUDGET_MS = 240000;
/** The reviewer is not started with less than this left; the report fails closed instead. */
const MIN_REVIEW_MS = 20000;

const PERSONA =
  'You are a Canadian immigration expert analyst. You provide impartial, ' +
  'objective insight drawn solely from the data provided in this report. ' +
  'Never invent, extrapolate or infer figures that are not given to you.';

/** "3.8 months" — the format the report spec asks for. */
const months = (days) => {
  const m = daysToMonths(days);
  return m === null ? 'n/a' : `${m.toFixed(1)} months`;
};

/** "2026-02" -> "February 2026" */
function monthName(key) {
  if (!key) return 'n/a';
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return String(key);
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-CA', {
    month: 'long',
    timeZone: 'UTC',
  })} ${y}`;
}

/** Human label for the configured period, used in Analysis 1. */
export function periodLabel({ from, to } = {}) {
  const fmt = (v) => new Date(v).toLocaleDateString('en-CA', { dateStyle: 'medium', timeZone: 'UTC' });
  if (from && to) return `${fmt(from)} to ${fmt(to)}`;
  if (from) return `${fmt(from)} onward`;
  if (to) return `up to ${fmt(to)}`;
  return 'the selected period';
}

/**
 * Analyses 1-3, computed from the summary. Never fails, never hallucinates.
 *
 * @param {object} s summary from analyze()
 * @param {{from?:string,to?:string,programLabel?:string}} config
 */
export function computedSections(s, config = {}) {
  const out = [];
  const period = periodLabel(config);
  const excluded = s.outliers?.count || 0;

  out.push({
    id: 'analysis-1',
    title: 'Submission to final approval',
    source: 'computed',
    body:
      `Over ${period}, on average it took ${months(s.daysSubmissionToPPR.mean)} for applications ` +
      `to go from submission to final approval (Portal 2 / PPR). ` +
      `This is based on ${s.daysSubmissionToPPR.count.toLocaleString('en-CA')} cases that have reached PPR.` +
      (excluded
        ? ` ${excluded === 1 ? 'One extreme case is' : `${excluded} extreme cases are`} left out of this and every other processing time, because ${excluded === 1 ? 'it' : 'they'} would distort the averages.`
        : ''),
  });

  if (s.slowestMonth && s.fastestMonth) {
    const caveat =
      s.monthSampleFloor > 1
        ? ` Months with fewer than ${s.monthSampleFloor} completed cases are excluded to avoid single cases skewing the result.`
        : ' Note that some months rest on very few completed cases.';
    out.push({
      id: 'analysis-2',
      title: 'Fastest and slowest months',
      source: 'computed',
      body:
        `The slowest month for application approvals was ${monthName(s.slowestMonth.month)} ` +
        `at ${months(s.slowestMonth.meanDays)} (${s.slowestMonth.count} cases). ` +
        `The fastest was ${monthName(s.fastestMonth.month)} ` +
        `at ${months(s.fastestMonth.meanDays)} (${s.fastestMonth.count} cases).` +
        caveat,
    });
  }

  const slowest = s.slowestCases?.[0];
  const quickest = s.quickestCases?.[0];
  if (slowest && quickest) {
    out.push({
      id: 'analysis-3',
      title: 'Fastest and slowest individual cases',
      source: 'computed',
      body:
        `The slowest case was ${slowest.label} at ${months(slowest.days)}. ` +
        `The fastest was ${quickest.label} at ${months(quickest.days)}.`,
    });
  }

  return out;
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * The headline figures, for the executive summary. Months precomputed so the
 * model never divides, and the percentages so it never has to either.
 *
 * Only the three outcomes the tiles show, which add up to the total. The
 * current-status counts (at PPR, landed, decision made) used to sit here too,
 * and the model listed "391 reached PPR" next to "128 at PPR" as if they
 * contradicted each other.
 */
function factSheet(s, config) {
  // Rounded as the report prints them — see the note in findings.js.
  const share = (n) => {
    const p = s.totalRecordsAnalyzed ? (n / s.totalRecordsAnalyzed) * 100 : 0;
    return p >= 10 ? Math.round(p) : round1(p);
  };
  return {
    program: config.programLabel || 'Express Entry',
    stream: config.streamLabel || 'All Streams',
    period: periodLabel(config),
    casesSubmitted: s.totalRecordsAnalyzed,
    approvedCases: s.approvedCount,
    approvedPct: share(s.approvedCount),
    stillInProgressCases: s.inProgressCount,
    stillInProgressPct: share(s.inProgressCount),
    refusedCases: s.refusalCount,
    refusedPct: share(s.refusalCount),
    definitions:
      'Approved means the case has reached PPR, including cases that have since landed. ' +
      'Approved, still in progress and refused add up to the cases submitted.',
    submissionToPPR: {
      meanDays: Math.round(s.daysSubmissionToPPR.mean),
      meanMonths: daysToMonths(s.daysSubmissionToPPR.mean),
      cases: s.daysSubmissionToPPR.count,
    },
    extremeCasesExcludedFromTimes: s.outliers?.count || 0,
    streamDistribution: s.streamDistribution,
  };
}

/** What a reader sees at each chart, so the model knows what is already obvious. */
const CHART_DESCRIPTIONS = {
  [CHART.milestones]: 'Processing milestones: average days for each step, Submission → AOR through to PPR',
  [CHART.process]: 'Where applications are now: cases by current status along the process',
  [CHART.streams]: 'Stream breakdown: share of cases by stream',
  [CHART.status]: 'Application status: cases by current status',
  [CHART.countries]: 'Top 10 countries of residence',
  [CHART.nationalities]: 'Top 10 nationalities',
  [CHART.streamTimes]: 'Average Submission → PPR by stream',
  [CHART.drawShare]: 'Cases by draw category (share of cases)',
  [CHART.drawTimes]: 'Average processing time by draw category',
  [CHART.nationalityTimes]: 'Average processing time by nationality',
  [CHART.monthlySubmissions]: 'Monthly submissions: cases by month of submission',
  [CHART.monthlyTimes]: 'Monthly processing times: average Submission → PPR by month of submission',
  [CHART.comparison]: 'Longest and shortest case per program',
  [CHART.slowest]: 'The 5 slowest cases',
  [CHART.quickest]: 'The 5 quickest cases',
};

/** A finding as the model sees it — no score, nothing it should not cite. */
const forModel = (f) => ({
  id: f.id,
  chart: f.chart,
  topic: f.topic,
  statement: f.statement,
  angle: f.angle,
  key_figures: f.keyFigures,
  facts: f.facts,
});

function writerSchema(chartIds) {
  const cited = { type: 'array', items: { type: 'string' } };
  return {
    type: 'object',
    properties: {
      executive_summary: { type: 'string' },
      key_takeaways: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, finding_ids: cited },
          required: ['text', 'finding_ids'],
        },
      },
      chart_notes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            // An empty enum is invalid, so a report with no charted findings
            // falls back to a plain string; the code check rejects any stray.
            chart: chartIds.length ? { type: 'string', enum: chartIds } : { type: 'string' },
            finding_ids: cited,
            text: { type: 'string' },
          },
          required: ['chart', 'finding_ids', 'text'],
        },
      },
    },
    required: ['executive_summary', 'key_takeaways', 'chart_notes'],
  };
}

export function buildWriterPrompt(s, config, findings) {
  const charts = [...new Set(findings.map((f) => f.chart).filter(Boolean))];
  return `${PERSONA}

You are writing the commentary for a report on ${config.programLabel || 'Express Entry'} processing times (${config.streamLabel || 'All Streams'}, ${periodLabel(config)}). It is read by applicants and people following the process, not by analysts.

Code has already gone through the data and picked out the FINDINGS below. Each has a plain statement that is true, an angle suggesting what it means for a reader, its key figures, and the facts behind it. Your job is to turn the interesting ones into short, natural commentary that explains what a reader would not see from the chart alone.

RULES
- Use only figures that appear in the facts of the findings you cite (or, for the executive summary, in REPORT FACTS). Do not work out new numbers: no new averages, differences, ratios or percentages.
- Durations: write the days figure, and if you mention months use the months figure given. Never convert days to months yourself.
- Figures are already rounded the way the report prints them. Write each one exactly as given: do not add decimals, and do not round further. Use two or three figures per note at most; pick the ones that carry the point.
- Do not restate the statement. Lead with what it means for the reader, using the angle as a guide, then back it up with a figure or two.
- Any text that uses a finding must state at least one of that finding's key_figures, and name the specific month, stream or group it is about. "Submissions surged in one month" is too vague; "Submissions jumped to 128 in January 2026, 2.7 times a typical month" is right.
- Explain why something happened where the facts support it. When an explanation goes beyond the facts — for example linking a fast month to a large invitation round — word it as a possibility: "may", "might", "likely", "suggests". Never state what IRCC intended or prioritised as fact.
- A finding whose facts include "sensitive": true involves nationality. Describe the pattern only. Do not suggest any reason for it.
- Mention it when a finding rests on few cases.
- Use every term as the GLOSSARY defines it. PPR is final approval, not permanent residence: write "approval (PPR)", never "permanent residence", for it.
- Name exactly the groups a finding compares. If it compares CEC with FSW-Outland, say "FSW-Outland", never "other streams", "the rest" or "everyone else".
- Never express a duration as a multiple ("1.4 times the speed", "twice as fast", "2 times longer"). Compare durations with the day figures, or the days difference when one is given.
- Skip any finding a reader would see straight away from the chart, with nothing more to add. Skipping most of them is fine; a few good notes beat many thin ones.

WHAT TO WRITE
1. executive_summary: two to four sentences from REPORT FACTS: cases submitted; how many were approved, are still in progress and were refused, with their percentages; and the average Submission to PPR in days and months. Follow the definitions given.
2. key_takeaways: the three to five most interesting findings in the whole report, one short headline sentence each, with the ids of the findings each one uses. Each one names what it is about, states the key figure, and says what it is being compared with, so the reader can tell why it matters ("CEC cases took 123 days, 33 days longer than FSW-Outland", not just "CEC cases took 123 days"). A takeaway is the headline; it should not copy a chart note.
3. chart_notes: at most one note per chart, one to three sentences, placed under the chart its findings belong to. A note may combine several findings for the same chart. Charts with findings: ${charts.length ? charts.map((c) => `${c} (${CHART_DESCRIPTIONS[c] || c})`).join('; ') : 'none'}.

STYLE
Plain English, short sentences, the way you would explain it to a friend going through the process. No headings, no bullet points, no markdown. AOR, ITA and PPR are fine; avoid other jargon.
Examples of the tone wanted. The brackets are placeholders: never copy them, and never use a figure that is not in the facts.
- "[Month] looks like the slowest month, but that is mostly one case that took [N] days. With only [N] approvals that month, a single long wait is enough to pull the average up."
- "Most of [month]'s quick approvals came from people invited in [month], which may reflect a large invitation round being processed together."
- "Cases submitted since [month] look faster, but only [N]% of them have been approved so far. The slower ones are still waiting, so expect these months to rise."
- "Applicants who received an extra document request waited [N] days on average, against [N] days for everyone else."

GLOSSARY
${glossaryText()}

REPORT FACTS
${JSON.stringify(factSheet(s, config), null, 2)}

FINDINGS
${JSON.stringify(findings.map(forModel), null, 2)}`;
}

/** The Express Entry pieces generateInsights() is parameterised by. */
const EXPRESS_ENTRY_WRITER = {
  buildPrompt: buildWriterPrompt,
  factSheet,
  chartDescriptions: CHART_DESCRIPTIONS,
  glossary: glossaryText(),
};

/** Turns the writer's JSON into checkable items, each with the sources it may draw on. */
function toItems(json, sheet, findingsById, chartDescriptions = CHART_DESCRIPTIONS) {
  const sourcesOf = (ids) =>
    (ids || [])
      .filter((id) => findingsById.has(id))
      .map((id) => {
        const f = findingsById.get(id);
        return { statement: f.statement, facts: f.facts };
      });
  const items = [];

  if (json?.executive_summary) {
    items.push({ id: 'executive-summary', label: 'Executive summary', text: json.executive_summary, sources: [sheet] });
  }
  (json?.key_takeaways || []).slice(0, 5).forEach((t, i) => {
    items.push({
      id: `takeaway-${i + 1}`,
      label: `Key takeaway ${i + 1}`,
      text: t?.text,
      findingIds: Array.isArray(t?.finding_ids) ? t.finding_ids : [],
      sources: sourcesOf(t?.finding_ids),
    });
  });
  const seen = new Set();
  for (const n of json?.chart_notes || []) {
    if (!n?.chart || seen.has(n.chart)) continue;
    seen.add(n.chart);
    items.push({
      id: `note-${n.chart}`,
      label: `Note under ${chartDescriptions[n.chart] || n.chart}`,
      chart: n.chart,
      text: n.text,
      findingIds: Array.isArray(n.finding_ids) ? n.finding_ids : [],
      sources: sourcesOf(n.finding_ids),
    });
  }
  return items;
}

/** Checked items -> report sections. Takeaways become one bulleted section. */
function toSections(items) {
  const sections = [];
  const exec = items.find((i) => i.id === 'executive-summary');
  if (exec) {
    sections.push({ id: 'executive-summary', title: 'Executive Summary & Macro Performance', body: exec.text, source: 'ai' });
  }
  const takeaways = items.filter((i) => i.id.startsWith('takeaway-'));
  if (takeaways.length) {
    sections.push({
      id: 'key-takeaways',
      title: 'Key Takeaways',
      body: takeaways.map((t) => `- ${t.text}`).join('\n'),
      source: 'ai',
    });
  }
  for (const n of items.filter((i) => i.chart)) {
    sections.push({ id: n.id, title: 'What stands out', body: n.text, source: 'ai', chart: n.chart });
  }
  return sections;
}

/**
 * Generated commentary, fact-checked. Never throws — returns
 * `{ available:false, reason }` so the caller can render the computed sections
 * and note the omission.
 *
 * @param {object} summary analyze() output
 * @param {object} config report configuration
 * @param {object[]} findings from buildFindings()
 * @param {object} [options]
 * @param {(stage: 'writing'|'checking', detail?: string) => void} [options.onStage]
 *   progress callback, so the report page can show the fact check as its own step
 * @param {object} [options.writer] what differs between report types: the
 *   writer prompt, the headline fact sheet, the chart descriptions and the
 *   glossary. Defaults to Express Entry; see citizenship/insights.js.
 * @returns {Promise<object>}
 *   { available, reason?, model?, sections?, qa: { checked, kept, removed[], reviewer? } }
 */
export async function generateInsights(
  summary,
  config = {},
  findings = [],
  { onStage = () => {}, budgetMs = TOTAL_BUDGET_MS, writer = EXPRESS_ENTRY_WRITER } = {}
) {
  if (!llmConfigured()) {
    return { available: false, reason: 'No GOOGLE_API_KEY configured' };
  }

  try {
    const deadline = Date.now() + budgetMs;
    const findingsById = new Map(findings.map((f) => [f.id, f]));
    const charts = [...new Set(findings.map((f) => f.chart).filter(Boolean))];

    onStage('writing');
    const written = await generateJson({
      prompt: writer.buildPrompt(summary, config, findings),
      schema: writerSchema(charts),
      deadline,
    });
    if (!written.ok) return { available: false, reason: written.reason };

    onStage('checking');
    const items = toItems(
      written.json,
      writer.factSheet(summary, config),
      findingsById,
      writer.chartDescriptions
    );
    const code = mechanicalCheck(items, findingsById);

    if (deadline - Date.now() < MIN_REVIEW_MS) {
      return { available: false, withheld: true, reason: 'No time was left to fact-check the commentary.' };
    }
    const review = await reviewWithModel(code.passed, { deadline, glossary: writer.glossary });
    if (!review.ok) {
      return {
        available: false,
        withheld: true,
        reason: `The fact check could not run (${review.reason}).`,
      };
    }

    const removed = [...code.removed, ...review.removed];
    for (const r of removed) console.warn(`[fact-check] removed ${r.id} (${r.stage}): ${r.reason}`);

    return {
      available: true,
      model: written.model,
      sections: toSections(review.passed),
      qa: {
        checked: items.length,
        kept: review.passed.length,
        removed,
        reviewer: review.model,
      },
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/**
 * The analysis block in order: executive summary, key takeaways, then the
 * computed analyses. Chart notes ride along at the end; the report places
 * them under their charts. Missing generated pieces simply drop out.
 */
export function assembleSections(computed, generated) {
  const ai = generated?.available ? generated.sections : [];
  const lead = ai.filter((x) => x.id === 'executive-summary' || x.id === 'key-takeaways');
  const notes = ai.filter((x) => x.chart);
  return [...lead, ...computed, ...notes];
}
