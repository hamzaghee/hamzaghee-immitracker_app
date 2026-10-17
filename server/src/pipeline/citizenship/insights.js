/**
 * The Citizenship report's text: the computed analyses, and what the AI writer
 * needs to know about this report type.
 *
 * The generation itself — writing, the code check, the reviewer — is shared
 * with Express Entry (../insights.js). What differs is handed to it as a
 * `writer`: the prompt, the headline fact sheet, the chart descriptions and
 * the glossary.
 */

import { daysToMonths, DAYS_PER_MONTH } from '../analyze.js';
import { periodLabel } from '../insights.js';
import { CZ_CHART } from '../../../../shared/citizenshipReport.js';

const PERSONA =
  'You are a Canadian immigration expert analyst. You provide impartial, ' +
  'objective insight drawn solely from the data provided in this report. ' +
  'Never invent, extrapolate or infer figures that are not given to you.';

const months = (days) => {
  const m = daysToMonths(days);
  return m === null ? 'n/a' : `${m.toFixed(1)} months`;
};
const n = (x) => Number(x || 0).toLocaleString('en-CA');
const round1 = (x) => Math.round(x * 10) / 10;

/** "Application → AOR" -> "application to AOR", for use mid-sentence. */
const stepPhrase = (label) =>
  String(label)
    .replace(' → ', ' to ')
    .replace(/^Application\b/, 'application')
    .replace(/^Test\b/, 'test');

/**
 * Analyses 1-3, computed from the summary. Never fails, never hallucinates.
 *
 * @param {object} s analyzeCitizenship() output
 * @param {{ from?: string, to?: string }} config
 */
export function citizenshipComputedSections(s, config = {}) {
  const out = [];
  const total = s.daysToDecision;
  const excluded = s.outliers?.count || 0;
  const toLater = (s.finishSources?.oathLetter || 0) + (s.finishSources?.oathCeremony || 0) + (s.finishSources?.certificate || 0);

  if (total?.count) {
    out.push({
      id: 'analysis-1',
      title: 'Application to decision',
      source: 'computed',
      body:
        `Over ${periodLabel(config)}, on average it took ${months(total.mean)} (${n(Math.round(total.mean))} days) ` +
        `for applications to go from being sent to a decision. ` +
        `This is based on ${n(total.count)} decided cases. ` +
        (toLater
          ? `${n(toLater)} of them did not record the decision date, so they are measured to the first later date they did record, usually the oath letter.`
          : '') +
        (excluded
          ? ` ${excluded === 1 ? 'One extreme case is' : `${n(excluded)} extreme cases are`} left out of this and every other processing time, because ${excluded === 1 ? 'it' : 'they'} would distort the averages.`
          : ''),
    });
  }

  if (s.longestStep) {
    out.push({
      id: 'analysis-2',
      title: 'The longest step',
      source: 'computed',
      body:
        `The longest step was ${stepPhrase(s.longestStep.label)}, at ${n(Math.round(s.longestStep.meanDays))} days on average ` +
        `(${months(s.longestStep.meanDays)}), across ${n(s.longestStep.count)} cases.`,
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
        `The slowest case was ${slowest.label} at ${months(slowest.days)} (${n(slowest.days)} days). ` +
        `The fastest was ${quickest.label} at ${months(quickest.days)} (${n(quickest.days)} days).`,
    });
  }

  return out;
}

/** The headline figures, for the executive summary. Percentages and months precomputed. */
function factSheet(s, config) {
  const share = (x) => {
    const p = s.totalRecordsAnalyzed ? (x / s.totalRecordsAnalyzed) * 100 : 0;
    return p >= 10 ? Math.round(p) : round1(p);
  };
  return {
    program: 'Citizenship',
    applicationType: config.applicationTypeLabel || 'All application types',
    province: config.provinceLabel || 'All provinces',
    period: periodLabel(config),
    casesSubmitted: s.totalRecordsAnalyzed,
    decisionReceivedCases: s.decisionReceivedCount,
    decisionReceivedPct: share(s.decisionReceivedCount),
    stillInProgressCases: s.inProgressCount,
    stillInProgressPct: share(s.inProgressCount),
    definitions:
      'Decision received means the case has a decision, or has reached any later step (oath letter, oath ceremony). ' +
      'Decision received and still in progress add up to the cases submitted. The tracker records no refusals.',
    applicationToDecision: s.daysToDecision?.count
      ? {
          meanDays: Math.round(s.daysToDecision.mean),
          meanMonths: daysToMonths(s.daysToDecision.mean),
          decidedCases: s.daysToDecision.count,
        }
      : null,
    extremeCasesExcludedFromTimes: s.outliers?.count || 0,
  };
}

const CHART_DESCRIPTIONS = {
  [CZ_CHART.milestones]: 'Processing milestones: average days for each step, application to decision and beyond',
  [CZ_CHART.process]: 'Where applications are now: cases by current status along the process',
  [CZ_CHART.status]: 'Application status: cases by current status',
  [CZ_CHART.monthlyApplications]: 'Monthly applications: cases by the month they were sent',
  [CZ_CHART.provinces]: 'Cases by province',
  [CZ_CHART.applicationTypes]: 'Single and family applications',
  [CZ_CHART.nationalities]: 'Top 10 nationalities',
  [CZ_CHART.stepsProvince]: 'Step by step, by province: average days per step and in total',
  [CZ_CHART.stepsApplicationType]: 'Step by step, single against family applications',
  [CZ_CHART.stepsNationality]: 'Step by step, by nationality',
  [CZ_CHART.stepsOffice]: 'Step by step, by IRCC office',
  [CZ_CHART.stepsExtraChecks]: 'Step by step, with and without an interview, a fingerprint request or urgent processing',
  [CZ_CHART.slowest]: 'The 5 slowest cases',
  [CZ_CHART.quickest]: 'The 5 quickest cases',
};

export const CITIZENSHIP_GLOSSARY = [
  ['IRCC', 'Immigration, Refugees and Citizenship Canada, the government department that processes applications.'],
  ['Citizenship application', 'An application by a permanent resident to become a Canadian citizen.'],
  ['Single / Family application', 'Whether one person applied alone, or a family applied together.'],
  ['Application date', 'The date the application was sent. Processing times are counted from here.'],
  ['AOR', 'Acknowledgement of Receipt: IRCC confirms it has received the application.'],
  ['In process', 'IRCC has started processing the application.'],
  ['Test invite', 'The invitation to take the citizenship test.'],
  ['Test', 'The citizenship knowledge test, taken online within a set window after the invite.'],
  ['Background check', 'Security and criminality checks.'],
  ['Interview', 'Some applicants are asked to attend an interview with IRCC. Most are not.'],
  ['Fingerprint request', 'Some applicants are asked to submit fingerprints. Most are not.'],
  ['Urgent processing', 'Faster processing IRCC grants to a few applicants with an urgent need.'],
  ['Decision', 'IRCC has decided the application. The tracker records no refusals, so a decision here means approval.'],
  ['Decision received', 'A case with a decision date, or any later step: oath letter, oath ceremony or certificate.'],
  ['Oath letter', 'The invitation to the citizenship ceremony. It comes after the decision.'],
  ['Oath ceremony', 'The ceremony at which the applicant takes the oath and becomes a citizen.'],
  ['Application to decision', 'The total processing time: days from the application date to the decision. When the decision date is blank, the first later date recorded is used instead, usually the oath letter.'],
];

const glossaryText = () => CITIZENSHIP_GLOSSARY.map(([term, meaning]) => `- ${term}: ${meaning}`).join('\n');

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

function buildPrompt(s, config, findings) {
  const charts = [...new Set(findings.map((f) => f.chart).filter(Boolean))];
  return `${PERSONA}

You are writing the commentary for a report on Canadian citizenship processing times (${config.applicationTypeLabel || 'All application types'}, ${config.provinceLabel || 'All provinces'}, ${periodLabel(config)}). It is read by applicants and people following the process, not by analysts.

The report measures how long the whole process and each step take, and how both differ between groups of applicants. Code has already gone through the data and picked out the FINDINGS below. Each has a plain statement that is true, an angle suggesting what it means for a reader, its key figures, and the facts behind it. Your job is to turn the interesting ones into short, natural commentary that explains what a reader would not see from the chart alone.

RULES
- Use only figures that appear in the facts of the findings you cite (or, for the executive summary, in REPORT FACTS). Do not work out new numbers: no new averages, differences, ratios or percentages.
- Durations: write the days figure, and if you mention months use the months figure given. Never convert days to months yourself (one month is ${DAYS_PER_MONTH} days).
- Figures are already rounded the way the report prints them. Write each one exactly as given. Use two or three figures per note at most.
- Do not restate the statement. Lead with what it means for the reader, using the angle as a guide, then back it up with a figure or two.
- Any text that uses a finding must state at least one of that finding's key_figures, and name the specific step or group it is about.
- Never link the month or season an application was sent to how long it took. The report does not treat the calendar as a factor.
- Make no comparison with IRCC's published processing times or any government estimate.
- Explain why something happened only where the facts support it, and word anything beyond the facts as a possibility: "may", "might", "likely". Never state what IRCC intended or prioritised as fact.
- A finding whose facts include "sensitive": true involves nationality. Describe the pattern only. Do not suggest any reason for it.
- Mention it when a finding rests on few cases.
- Use every term as the GLOSSARY defines it. The tracker records no refusals: never mention refusals or approval rates.
- Name exactly the groups a finding compares. If it compares Ontario with Alberta, say "Alberta", never "other provinces" or "everyone else".
- Never express a duration as a multiple ("twice as fast", "1.4 times longer"). Compare durations with the day figures, or the days difference when one is given.
- Skip any finding a reader would see straight away from the chart, with nothing more to add. A few good notes beat many thin ones.

WHAT TO WRITE
1. executive_summary: two to four sentences from REPORT FACTS: cases submitted; how many have received a decision and how many are still in progress, with their percentages; and the average application to decision in days and months. Follow the definitions given.
2. key_takeaways: the three to five most interesting findings in the whole report, one short headline sentence each, with the ids of the findings each one uses. Each names what it is about, states the key figure, and says what it is compared with.
3. chart_notes: at most one note per chart, one to three sentences, placed under the chart its findings belong to. Charts with findings: ${charts.length ? charts.map((c) => `${c} (${CHART_DESCRIPTIONS[c] || c})`).join('; ') : 'none'}.

STYLE
Plain English, short sentences, the way you would explain it to a friend going through the process. No headings, no bullet points, no markdown. AOR is fine; avoid other jargon.
Examples of the tone wanted. The brackets are placeholders: never copy them, and never use a figure that is not in the facts.
- "Most of the wait is before the test: [step] alone takes [N] days on average, out of [N] days in total."
- "Family applications took [N] days longer than single ones, and most of that extra time comes between the test and the decision."
- "Applicants asked to attend an interview waited [N] days on average, against [N] days for those who were not."

GLOSSARY
${glossaryText()}

REPORT FACTS
${JSON.stringify(factSheet(s, config), null, 2)}

FINDINGS
${JSON.stringify(findings.map(forModel), null, 2)}`;
}

/** What generateInsights() needs to write and check a Citizenship report. */
export const CITIZENSHIP_WRITER = {
  buildPrompt,
  factSheet,
  chartDescriptions: CHART_DESCRIPTIONS,
  glossary: glossaryText(),
};
