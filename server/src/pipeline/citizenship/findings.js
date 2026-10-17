/**
 * Findings for the Citizenship report — the question bank behind its AI
 * analysis, built the same way as ../findings.js for Express Entry.
 *
 * Code asks the questions; the model only writes up the answers that stand
 * out. Every finding has the shape the writer and the fact check expect:
 *
 *   { id, chart, topic, statement, facts, angle, keyFigures, sides, score }
 *
 * The report measures how long the process and each step take, and how both
 * differ across groups. So the questions are about steps and groups. None of
 * them relates the month a case was submitted to how long it took — the
 * report deliberately does not treat the calendar as a factor.
 */

import { DAYS_PER_MONTH } from '../analyze.js';
import { totalDays, MIN_GROUP } from './analyze.js';
import { F } from './fieldMap.js';
import { CZ_CHART, BANDS } from '../../../../shared/citizenshipReport.js';

export const MAX_FINDINGS = 14;

/* ---------------- helpers ---------------- */

// Rounded the way the report prints them; see the note in ../findings.js.
const round1 = (x) => Math.round(x * 10) / 10;
const toMonths = (days) => round1(days / DAYS_PER_MONTH);
const pct = (n, d) => {
  if (!d) return 0;
  const p = (n / d) * 100;
  return p >= 10 ? Math.round(p) : round1(p);
};
const mean = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const whole = (x) => (typeof x === 'number' ? Math.round(x) : x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Days with their months twin, the pairing every duration fact uses. */
const dur = (prefix, days) =>
  days === null || days === undefined ? {} : { [`${prefix}Days`]: days, [`${prefix}Months`]: toMonths(days) };

/**
 * Of the steps both groups recorded enough of, the one where they differ most.
 * Lets a comparison say where the extra time goes, not only that it exists.
 */
function biggestStepGap(slow, fast) {
  let best = null;
  for (const b of BANDS) {
    const a = slow.steps[b.id];
    const z = fast.steps[b.id];
    if (!a || !z || a.count < MIN_GROUP || z.count < MIN_GROUP) continue;
    const gap = whole(a.meanDays) - whole(z.meanDays);
    if (!best || gap > best.gap) best = { step: b.label, slowDays: whole(a.meanDays), fastDays: whole(z.meanDays), gap };
  }
  return best && best.gap > 0 ? best : null;
}

/* ---------------- the questions ---------------- */

/** Extreme cases left out, and how far they would have moved the average. */
function qOutliers(ctx) {
  const o = ctx.summary.outliers;
  if (!o?.count) return [];
  const all = ctx.records.map(totalDays).filter((d) => d !== null);
  const kept = all.filter((d) => d <= o.upperFenceDays && (o.lowerFenceDays === null || d >= o.lowerFenceDays));
  const withAll = mean(all);
  const without = mean(kept);
  return [
    {
      id: 'outliers-excluded',
      chart: CZ_CHART.slowest,
      topic: 'Extreme cases excluded',
      statement:
        `${o.count} extreme case${o.count === 1 ? ' was' : 's were'} left out of the processing times. ` +
        `With ${o.count === 1 ? 'it' : 'them'}, the average from application to decision would be ${withAll} days instead of ${without}.`,
      facts: {
        excludedCases: o.count,
        ...dur('upperLimit', o.upperFenceDays),
        ...dur('averageIncludingExcluded', withAll),
        ...dur('averageExcludingThem', without),
      },
      angle: 'A few very long cases were left out so they do not make typical waits look longer than they are.',
      keyFigures: [withAll, without],
      sides: [],
      score: 0.85,
    },
  ];
}

/** Where most of the wait sits. */
function qLongestStep(ctx) {
  const s = ctx.summary;
  const total = whole(s.daysToDecision?.mean);
  const step = s.longestStep;
  if (!total || !step) return [];
  const days = whole(step.meanDays);
  const share = pct(days, total);
  return [
    {
      id: 'longest-step',
      chart: CZ_CHART.milestones,
      topic: 'The longest step',
      statement: `The longest step is ${step.label}, at ${days} days on average (${step.count} cases), against ${total} days from application to decision overall.`,
      facts: {
        step: step.label,
        ...dur('stepAverage', days),
        stepCases: step.count,
        ...dur('applicationToDecisionAverage', total),
        stepSharePct: share,
      },
      angle: 'Most of the wait comes in this one step; the rest of the process moves comparatively quickly.',
      keyFigures: [days, share],
      sides: [],
      score: clamp01(0.35 + share / 150),
    },
  ];
}

/**
 * How long the oath letter takes after the decision. Most cases are measured
 * to their oath letter, because the decision date is usually blank, so this is
 * roughly how much that adds to their total.
 */
function qDecisionToOathLetter(ctx) {
  const s = ctx.summary;
  const gap = s.steps.find((x) => x.id === 'decisionToOathLetter');
  if (!gap || gap.count < MIN_GROUP) return [];
  const days = whole(gap.mean);
  const toLetter = s.finishSources?.oathLetter || 0;
  const decided = s.daysToDecision?.count || 0;
  return [
    {
      id: 'decision-to-oath-letter',
      chart: CZ_CHART.milestones,
      topic: 'Decision to oath letter',
      statement:
        `Where both dates are recorded, the oath letter arrives ${days} days after the decision on average (${gap.count} cases). ` +
        `${toLetter} of the ${decided} decided cases are measured to their oath letter because the decision date was left blank.`,
      facts: {
        ...dur('decisionToOathLetterAverage', days),
        casesWithBothDates: gap.count,
        casesMeasuredToOathLetter: toLetter,
        decidedCases: decided,
        measuredToOathLetterPct: pct(toLetter, decided),
      },
      angle:
        'Most applicants only record the oath letter, which comes a little after the decision, so the true time to a decision is likely slightly shorter than the headline figure.',
      keyFigures: [days],
      sides: [],
      score: 0.4,
    },
  ];
}

/**
 * The slowest group against the fastest for one variable, and the step where
 * most of the difference sits.
 */
function groupGap(ctx, { key, chart, noun, sensitive = false, idPrefix, minGapPct = 10 }) {
  const groups = ctx.summary.byGroup?.[key]?.groups || [];
  if (groups.length < 2) return [];
  const sorted = [...groups].sort((a, b) => b.total.mean - a.total.mean);
  const slow = sorted[0];
  const fast = sorted[sorted.length - 1];
  const slowDays = whole(slow.total.mean);
  const fastDays = whole(fast.total.mean);
  const longer = slowDays - fastDays;
  const gapPct = pct(longer, fastDays);
  if (gapPct < minGapPct) return [];

  const step = biggestStepGap(slow, fast);
  const facts = {
    comparing: noun,
    slowerGroup: slow.label,
    fasterGroup: fast.label,
    ...dur('slowerGroupAverage', slowDays),
    ...dur('fasterGroupAverage', fastDays),
    daysLonger: longer,
    differencePct: gapPct,
    slowerGroupDecidedCases: slow.total.count,
    fasterGroupDecidedCases: fast.total.count,
    groupsCompared: groups.length,
  };
  if (step) {
    Object.assign(facts, {
      stepWithBiggestGap: step.step,
      stepSlowerGroupDays: step.slowDays,
      stepFasterGroupDays: step.fastDays,
      stepDaysLonger: step.gap,
    });
  }
  if (sensitive) facts.sensitive = true;

  return [
    {
      id: `${idPrefix}-gap`,
      chart,
      topic: `${noun}: slowest against fastest`,
      statement:
        `By ${noun}, ${slow.label} took longest from application to decision at ${slowDays} days (${slow.total.count} cases), ` +
        `${longer} days longer than ${fast.label} at ${fastDays} days (${fast.total.count} cases).` +
        (step ? ` The biggest difference is in ${step.step}: ${step.slowDays} days against ${step.fastDays}.` : ''),
      facts,
      angle: sensitive
        ? 'Describe the gap and the sample sizes only. Give no reason for it.'
        : step
        ? `Say where the extra time goes: most of it is in ${step.step}.`
        : 'One group is taking noticeably longer than another.',
      keyFigures: [slowDays, longer],
      sides: [
        { names: [slow.label], dir: 'slow' },
        { names: [fast.label], dir: 'fast' },
      ],
      score: clamp01(0.3 + gapPct / 100) * (Math.min(slow.total.count, fast.total.count) < 10 ? 0.8 : 1),
    },
  ];
}

const qProvinceGap = (ctx) =>
  groupGap(ctx, { key: 'province', chart: CZ_CHART.stepsProvince, noun: 'province', idPrefix: 'province' });

const qApplicationTypeGap = (ctx) =>
  groupGap(ctx, {
    key: 'applicationType',
    chart: CZ_CHART.stepsApplicationType,
    noun: 'application type',
    idPrefix: 'application-type',
    minGapPct: 5,
  });

const qOfficeGap = (ctx) =>
  groupGap(ctx, { key: 'office', chart: CZ_CHART.stepsOffice, noun: 'IRCC office', idPrefix: 'office' });

const qNationalityGap = (ctx) =>
  groupGap(ctx, {
    key: 'nationality',
    chart: CZ_CHART.stepsNationality,
    noun: 'nationality',
    idPrefix: 'nationality',
    sensitive: true,
    minGapPct: 15,
  });

/** One nationality at both ends of the individual-case charts. */
function qNationalityBothEnds(ctx) {
  const { slowestCases = [], quickestCases = [] } = ctx.summary;
  const slowSet = new Set(slowestCases.map((c) => c.nationality).filter(Boolean));
  const shared = quickestCases.map((c) => c.nationality).find((n) => n && slowSet.has(n));
  if (!shared) return [];
  const slowest = slowestCases.find((c) => c.nationality === shared);
  const quickest = quickestCases.find((c) => c.nationality === shared);
  return [
    {
      id: 'nationality-both-ends',
      chart: CZ_CHART.slowest,
      topic: 'Same nationality among the slowest and quickest',
      statement: `Applicants from ${shared} appear among both the 5 slowest and the 5 quickest cases: ${slowest.days} days and ${quickest.days} days.`,
      facts: {
        nationality: shared,
        ...dur('slowCase', slowest.days),
        ...dur('quickCase', quickest.days),
        slowestListedWithThisNationality: slowestCases.filter((c) => c.nationality === shared).length,
        quickestListedWithThisNationality: quickestCases.filter((c) => c.nationality === shared).length,
        sensitive: true,
      },
      angle: 'Waits vary widely even for applicants of the same nationality. Describe this only; give no reason for it.',
      keyFigures: [slowest.days, quickest.days],
      sides: [],
      score: 0.5,
    },
  ];
}

/** Whether an interview, fingerprint request or urgent processing goes with a different wait. */
function extraCheck(ctx, { key, idPrefix, yesText, noText }) {
  const groups = ctx.summary.byGroup?.[key]?.groups || [];
  const yes = groups.find((g) => g.label === 'Yes');
  const no = groups.find((g) => g.label === 'No');
  if (!yes || !no) return [];
  const yesDays = whole(yes.total.mean);
  const noDays = whole(no.total.mean);
  const diff = yesDays - noDays;
  const diffPct = pct(Math.abs(diff), noDays);
  if (diffPct < 10) return [];
  const step = diff > 0 ? biggestStepGap(yes, no) : biggestStepGap(no, yes);

  const facts = {
    ...dur(`${idPrefix}Average`, yesDays),
    [`${idPrefix}DecidedCases`]: yes.total.count,
    ...dur('withoutAverage', noDays),
    withoutDecidedCases: no.total.count,
    daysDifference: Math.abs(diff),
    differencePct: diffPct,
    direction: diff > 0 ? 'longer' : 'shorter',
  };
  if (step) Object.assign(facts, { stepWithBiggestGap: step.step, stepDaysLonger: step.gap });

  return [
    {
      id: `${idPrefix}-effect`,
      chart: CZ_CHART.stepsExtraChecks,
      topic: yesText,
      statement:
        `Decided cases with ${yesText} averaged ${yesDays} days from application to decision (${yes.total.count} cases), ` +
        `against ${noDays} days with ${noText} (${no.total.count} cases).` +
        (step ? ` Most of the difference is in ${step.step}.` : ''),
      facts,
      angle:
        diff > 0
          ? `${yesText[0].toUpperCase()}${yesText.slice(1)} goes with a longer wait${step ? `, mostly in ${step.step}` : ''}.`
          : `${yesText[0].toUpperCase()}${yesText.slice(1)} goes with a shorter wait.`,
      keyFigures: [yesDays, Math.abs(diff)],
      // No direction check in code: "interview" also matches inside "no
      // interview", so the subject of a sentence cannot be found reliably.
      // The reviewer still checks the direction.
      sides: [],
      score: clamp01(0.4 + diffPct / 100) * (yes.total.count < 10 ? 0.8 : 1),
    },
  ];
}

const qInterview = (ctx) =>
  extraCheck(ctx, { key: 'interview', idPrefix: 'interview', yesText: 'an interview', noText: 'no interview' });
const qFingerprint = (ctx) =>
  extraCheck(ctx, {
    key: 'fingerprint',
    idPrefix: 'fingerprint',
    yesText: 'a fingerprint request',
    noText: 'no fingerprint request',
  });
const qUrgent = (ctx) =>
  extraCheck(ctx, { key: 'urgent', idPrefix: 'urgent', yesText: 'urgent processing', noText: 'no urgent processing' });

/** Many open cases waiting at one stage. */
function qBottleneck(ctx) {
  const s = ctx.summary;
  const decided = new Set(['Decision Made', 'Oath Letter received', 'Oath completed']);
  const open = s.stageCounts.filter((x) => !decided.has(x.status));
  const openTotal = open.reduce((n, x) => n + x.count, 0);
  if (openTotal < MIN_GROUP * 2) return [];
  const top = [...open].sort((a, b) => b.count - a.count)[0];
  const share = pct(top.count, openTotal);
  if (share < 35) return [];
  return [
    {
      id: 'stage-bottleneck',
      chart: CZ_CHART.process,
      topic: 'Where open cases are waiting',
      statement: `${top.count} of the ${openTotal} cases still in progress (${share}%) are at ${top.label}.`,
      facts: { stage: top.label, casesAtStage: top.count, casesInProgress: openTotal, sharePct: share },
      angle: 'Many open cases are waiting at this one stage.',
      keyFigures: [share, top.count],
      sides: [],
      score: clamp01(0.3 + (share - 35) / 100),
    },
  ];
}

/** Traits the slowest decided cases share far more often than everyone else. */
function qSlowestProfile(ctx) {
  const decided = ctx.timed.filter((r) => totalDays(r) !== null).sort((a, b) => totalDays(b) - totalDays(a));
  const n = Math.max(10, Math.round(decided.length * 0.1));
  if (decided.length < n * 3) return [];
  const slowest = decided.slice(0, n);
  const threshold = totalDays(slowest[slowest.length - 1]);

  const traits = [
    { label: 'family application', test: (r) => r[F.applicationType] === 'Family', known: (r) => Boolean(r[F.applicationType]) },
    { label: 'had an interview', test: (r) => r[F.interview] === 'Yes' || Boolean(r[F.interviewDate]), known: (r) => Boolean(r[F.interview] || r[F.interviewDate]) },
    { label: 'had a fingerprint request', test: (r) => r[F.fingerprint] === 'Yes' || Boolean(r[F.fingerprintDate]), known: (r) => Boolean(r[F.fingerprint] || r[F.fingerprintDate]) },
  ];

  const found = traits
    .map((t) => {
      const slowKnown = slowest.filter(t.known);
      const allKnown = decided.filter(t.known);
      if (slowKnown.length < MIN_GROUP || allKnown.length < MIN_GROUP * 2) return null;
      const slowPct = pct(slowKnown.filter(t.test).length, slowKnown.length);
      const basePct = pct(allKnown.filter(t.test).length, allKnown.length);
      if (slowPct < 30 || !basePct || slowPct / basePct < 1.75) return null;
      return { trait: t.label, slowestCasesWithTraitPct: slowPct, allDecidedCasesWithTraitPct: basePct, ratio: slowPct / basePct };
    })
    .filter(Boolean)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 2);
  if (!found.length) return [];

  return [
    {
      id: 'slowest-profile',
      chart: CZ_CHART.slowest,
      topic: 'What the slowest cases have in common',
      statement:
        `Among the slowest ${n} decided cases (${threshold} days or more), ` +
        found.map((t) => `${t.slowestCasesWithTraitPct}% ${t.trait}, against ${t.allDecidedCasesWithTraitPct}% of all decided cases`).join('; ') +
        '.',
      facts: {
        slowestCases: n,
        ...dur('slowestThreshold', threshold),
        traits: found.map(({ ratio, ...t }) => t),
      },
      angle: 'The slowest cases tend to share these traits, which may be part of why they took longer.',
      keyFigures: found.map((t) => t.slowestCasesWithTraitPct),
      sides: [],
      score: clamp01(0.45 + (found[0].ratio - 1.75) * 0.15),
    },
  ];
}

/** In the order a reader meets the charts. */
const QUESTIONS = [
  qOutliers,
  qLongestStep,
  qDecisionToOathLetter,
  qBottleneck,
  qProvinceGap,
  qApplicationTypeGap,
  qNationalityGap,
  qOfficeGap,
  qInterview,
  qFingerprint,
  qUrgent,
  qNationalityBothEnds,
  qSlowestProfile,
];

/**
 * @param {object[]} records the report's filtered rows, extreme cases included
 * @param {object} summary analyzeCitizenship() output, run with excludeOutliers
 * @returns {{ findings: object[], asked: number }}
 */
export function buildCitizenshipFindings(records, summary) {
  const o = summary.outliers;
  const outside = (r) => {
    const d = totalDays(r);
    return (
      o?.count > 0 &&
      d !== null &&
      (d > o.upperFenceDays || (o.lowerFenceDays !== null && d < o.lowerFenceDays))
    );
  };
  const ctx = { records, summary, timed: records.filter((r) => !outside(r)) };

  const findings = [];
  for (const q of QUESTIONS) {
    try {
      findings.push(...q(ctx));
    } catch (err) {
      // One broken question must not cost the report the rest.
      console.warn(`[findings] ${q.name} failed: ${err.message}`);
    }
  }

  return {
    findings: findings
      .map((f) => ({ ...f, score: Math.round(f.score * 100) / 100 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FINDINGS),
    asked: QUESTIONS.length,
  };
}
