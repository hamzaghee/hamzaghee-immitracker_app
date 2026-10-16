/**
 * Findings — the question bank behind the AI analysis.
 *
 * Code asks the questions; the model only writes up the answers that stand
 * out. Each question below has a rule for what counts as notable and a minimum
 * sample, so an ordinary month is never dressed up as remarkable and a month
 * holding two cases is never read as a trend. The model is then told it may
 * skip any finding the chart already makes obvious.
 *
 * Every finding is self-contained:
 *
 *   { id, chart, topic, statement, facts, angle, keyFigures, score }
 *
 *   chart      the CHART id the note belongs under, or null for an
 *              observation with no chart of its own (key takeaways only)
 *   statement  a plain, computed sentence — always true, used by the fact check
 *   facts      the only figures the model may cite for this finding
 *   angle      what it means for a reader, as guidance for the writer
 *   keyFigures headline numbers; any passage using the finding must state one
 *   sides      for comparisons, which group is slow and which fast
 *   score      0..1, how remarkable; the strongest are sent to the model
 *
 * Durations carry a matching `…Months` figure so the model never divides, and
 * every percentage is precomputed for the same reason.
 */

import { parseLooseDate } from './filter.js';
import { DAYS_PER_MONTH } from './analyze.js';
import { withinFences } from './outliers.js';
import { countryName } from '../../../shared/text.js';
import { CHART } from '../../../shared/reportData.js';

const PPR_FIELD = 'Portal 2 Email / PPR Date';
const DAYS_FIELD = 'Days from Submission to PPR';
const DRAW_FIELD = 'EE Draw Category';
const ADR_FIELD = 'Additional Document Request Date (if any)';
const PROVINCE_FIELD = 'Sponsored by Province (if PNP)';

/** Smallest group whose average is worth commenting on. */
const MIN_GROUP = 5;
/** Most findings handed to the writer, strongest first. */
export const MAX_FINDINGS = 14;

/* ---------------- helpers ---------------- */

/*
 * Figures are rounded here, the way the report should print them, rather than
 * asking the model to round: it copies decimals it is given ("69.7 days")
 * whatever the prompt says. Days are whole, percentages of 10 or more are
 * whole, and small figures keep one decimal so 0.8% does not become 1%.
 */
const round1 = (x) => Math.round(x * 10) / 10;
const toMonths = (days) => round1(days / DAYS_PER_MONTH);
const pct = (n, d) => {
  if (!d) return 0;
  const p = (n / d) * 100;
  return p >= 10 ? Math.round(p) : round1(p);
};
const mean = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const daysOf = (r) => {
  const d = parseFloat(r[DAYS_FIELD]);
  return Number.isFinite(d) ? d : null;
};
const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const monthKeyOf = (v) => {
  const d = parseLooseDate(v);
  return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : null;
};

/** "2025-02" -> "February 2025" */
export function monthLabel(key) {
  if (!key) return null;
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return String(key);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-CA', {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${name} ${y}`;
}

/** { value: count } over rows, skipping empties. */
function tally(rows, valueOf) {
  const out = {};
  for (const r of rows) {
    const v = valueOf(r);
    if (filled(v)) out[v] = (out[v] || 0) + 1;
  }
  return out;
}

/** The most common value and its share of the rows that have one. */
function dominant(rows, valueOf) {
  const counts = tally(rows, valueOf);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  return { value: top[0], count: top[1], of: total, sharePct: pct(top[1], total) };
}

/** Days with their months twin, the pairing every duration fact uses. */
const dur = (prefix, days) =>
  days === null || days === undefined
    ? {}
    : { [`${prefix}Days`]: days, [`${prefix}Months`]: toMonths(days) };

/* ---------------- the questions ---------------- */

/**
 * Which extreme cases were left out, and how far they would have moved the
 * average. Always notable when there are any: the reader is owed the reason a
 * long case is missing from the charts.
 */
function qOutliers(ctx) {
  const { summary, completedAll, completed } = ctx;
  const cases = summary.outliers?.cases || [];
  if (!cases.length) return [];
  const withAll = mean(completedAll.map(daysOf));
  const without = mean(completed.map(daysOf));
  const described = cases.slice(0, 3).map((c) => ({
    ...dur('case', c.days),
    stream: c.stream,
    nationality: c.nationality,
    drawCategory: c.drawCategory,
    submittedMonth: monthLabel(c.submittedMonth),
    itaMonth: monthLabel(c.itaMonth),
  }));
  const chart = cases.some((c) => c.direction === 'slow') ? CHART.slowest : CHART.quickest;
  return [
    {
      id: 'outliers-excluded',
      chart,
      topic: 'Extreme cases excluded',
      statement:
        `${cases.length} extreme case${cases.length === 1 ? ' was' : 's were'} left out of the processing times. ` +
        `With ${cases.length === 1 ? 'it' : 'them'}, the average Submission to PPR would be ${withAll} days instead of ${without}.`,
      facts: {
        excludedCases: cases.length,
        ...dur('averageIncludingExcluded', withAll),
        ...dur('averageExcludingThem', without),
        cases: described,
      },
      score: 0.9,
    },
  ];
}

/**
 * Months whose average stands well apart from the rest — and whether that is
 * one case talking, or a real cohort (a draw category, an invitation round).
 */
function qMonthlyTimes(ctx) {
  const { completed, overallMean } = ctx;
  if (!overallMean) return [];
  const byMonth = {};
  for (const r of completed) {
    const k = monthKeyOf(r['Submitted']);
    if (k) (byMonth[k] ||= []).push(r);
  }

  const candidates = [];
  for (const [month, rows] of Object.entries(byMonth)) {
    if (rows.length < 3) continue;
    const days = rows.map(daysOf);
    const m = mean(days);
    const deviation = (m - overallMean) / overallMean;
    if (Math.abs(deviation) < 0.25) continue;

    const slow = deviation > 0;
    const sorted = [...rows].sort((a, b) => daysOf(a) - daysOf(b));
    const extreme = slow ? sorted[sorted.length - 1] : sorted[0];
    const rest = slow ? sorted.slice(0, -1) : sorted.slice(1);
    const withoutExtreme = mean(rest.map(daysOf));
    const oneCaseDriven =
      rows.length <= 10 && Math.abs((withoutExtreme - overallMean) / overallMean) < 0.15;

    const facts = {
      month: monthLabel(month),
      direction: slow ? 'slower than average' : 'faster than average',
      completedCases: rows.length,
      ...dur('monthAverage', m),
      ...dur('overallAverage', overallMean),
    };

    let statement = `Cases submitted in ${monthLabel(month)} averaged ${m} days to PPR, against ${overallMean} days overall (${rows.length} completed cases).`;
    if (oneCaseDriven) {
      Object.assign(facts, {
        drivenByOneCase: true,
        ...dur('extremeCase', daysOf(extreme)),
        ...dur('monthAverageWithoutIt', withoutExtreme),
      });
      statement += ` One case of ${daysOf(extreme)} days accounts for most of the gap; without it the month averages ${withoutExtreme} days.`;
    } else if (rows.length >= MIN_GROUP) {
      // A genuine fast or slow month: what was it made of?
      const cat = dominant(rows, (r) => r[DRAW_FIELD]);
      const baselineShare = cat
        ? pct(ctx.completed.filter((r) => r[DRAW_FIELD] === cat.value).length, ctx.completedWithCategory)
        : 0;
      if (cat && cat.of >= MIN_GROUP && cat.sharePct - baselineShare >= 15) {
        Object.assign(facts, {
          dominantDrawCategory: cat.value,
          categoryShareThisMonthPct: cat.sharePct,
          categoryShareOverallPct: baselineShare,
          casesSpecifyingCategory: cat.of,
        });
        statement += ` ${cat.sharePct}% of its cases that name a draw category were ${cat.value}, against ${baselineShare}% overall.`;
      }
      const ita = dominant(rows, (r) => monthKeyOf(r['ITA Date']));
      if (ita && ita.of >= MIN_GROUP && ita.sharePct >= 40) {
        Object.assign(facts, {
          commonestItaMonth: monthLabel(ita.value),
          itaMonthSharePct: ita.sharePct,
          casesWithItaDate: ita.of,
        });
        statement += ` ${ita.sharePct}% of those with an ITA date were invited in ${monthLabel(ita.value)}.`;
      }
    }
    if (rows.length < MIN_GROUP) {
      facts.smallSample = true;
      statement += ' The month rests on very few completed cases.';
    }

    candidates.push({
      id: `month-${month}`,
      chart: CHART.monthlyTimes,
      topic: slow ? 'Unusually slow month' : 'Unusually fast month',
      statement,
      facts,
      score: clamp01(0.4 + Math.abs(deviation) * 0.6) * (rows.length < MIN_GROUP ? 0.7 : 1),
    });
  }

  // The two most pronounced: one slow and one fast where both exist.
  candidates.sort((a, b) => b.score - a.score);
  const slow = candidates.find((c) => c.topic.includes('slow'));
  const fast = candidates.find((c) => c.topic.includes('fast'));
  return [slow, fast].filter(Boolean);
}

/**
 * Recent months look fast for a reason the chart cannot show: only cases that
 * have already reached PPR are averaged, and the slow ones are still waiting.
 */
function qRecentMonthsIncomplete(ctx) {
  const { records } = ctx;
  const byMonth = {};
  for (const r of records) {
    const k = monthKeyOf(r['Submitted']);
    if (!k) continue;
    const m = (byMonth[k] ||= { submitted: 0, completed: 0 });
    m.submitted += 1;
    if (parseLooseDate(r[PPR_FIELD])) m.completed += 1;
  }
  const months = Object.keys(byMonth).sort();
  if (months.length < 4) return [];

  // Walk back from the latest month while fewer than half have finished. A
  // near-empty month (the export date cutting one short) neither stops the walk
  // nor counts against it.
  let i = months.length;
  while (i > 0) {
    const m = byMonth[months[i - 1]];
    if (m.submitted >= 3 && m.completed / m.submitted >= 0.5) break;
    i -= 1;
  }
  const recent = months.slice(i);
  const earlier = months.slice(0, i);
  // Only worth saying if those months actually appear on the timing chart.
  const charted = recent.filter((k) => byMonth[k].completed > 0);
  if (!recent.length || !charted.length || !earlier.length) return [];

  const sum = (ks, f) => ks.reduce((s, k) => s + byMonth[k][f], 0);
  const recentSubmitted = sum(recent, 'submitted');
  const recentCompleted = sum(recent, 'completed');
  const earlierRate = pct(sum(earlier, 'completed'), sum(earlier, 'submitted'));
  const recentRate = pct(recentCompleted, recentSubmitted);
  if (earlierRate - recentRate < 25) return [];

  return [
    {
      id: 'recent-months-incomplete',
      chart: CHART.monthlyTimes,
      topic: 'Recent months are not finished yet',
      statement:
        `Of the ${recentSubmitted} cases submitted from ${monthLabel(recent[0])} onward, only ${recentCompleted} (${recentRate}%) have reached PPR, ` +
        `against ${earlierRate}% of earlier cases. Those months' averages reflect only the quickest cases so far.`,
      facts: {
        fromMonth: monthLabel(recent[0]),
        toMonth: monthLabel(recent[recent.length - 1]),
        casesSubmitted: recentSubmitted,
        casesReachedPPR: recentCompleted,
        completedPct: recentRate,
        earlierCompletedPct: earlierRate,
      },
      score: 0.75,
    },
  ];
}

/** A month with far more submissions than usual, and where they came from. */
function qSubmissionPeak(ctx) {
  const { records } = ctx;
  const byMonth = {};
  for (const r of records) {
    const k = monthKeyOf(r['Submitted']);
    if (k) (byMonth[k] ||= []).push(r);
  }
  const counts = Object.entries(byMonth).map(([k, rows]) => [k, rows.length]);
  if (counts.length < 4) return [];
  const sorted = counts.map(([, n]) => n).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const [peak, peakCount] = counts.sort((a, b) => b[1] - a[1])[0];
  if (peakCount < 10 || peakCount < median * 1.6) return [];

  const rows = byMonth[peak];
  const facts = {
    month: monthLabel(peak),
    casesSubmitted: peakCount,
    typicalMonthCases: median,
    timesTypical: round1(peakCount / median),
  };
  let statement = `Submissions peaked in ${monthLabel(peak)} with ${peakCount} cases, ${facts.timesTypical} times a typical month (${median}).`;

  const ita = dominant(rows, (r) => monthKeyOf(r['ITA Date']));
  if (ita && ita.of >= MIN_GROUP && ita.sharePct >= 40) {
    Object.assign(facts, {
      commonestItaMonth: monthLabel(ita.value),
      itaMonthSharePct: ita.sharePct,
      casesWithItaDate: ita.of,
    });
    statement += ` ${ita.sharePct}% of those with an ITA date were invited in ${monthLabel(ita.value)}.`;
  }
  const cat = dominant(rows, (r) => r[DRAW_FIELD]);
  if (cat && cat.of >= MIN_GROUP && cat.sharePct >= 40) {
    Object.assign(facts, {
      dominantDrawCategory: cat.value,
      categorySharePct: cat.sharePct,
      casesSpecifyingCategory: cat.of,
    });
    statement += ` ${cat.sharePct}% of those naming a draw category were ${cat.value}.`;
  }

  return [
    {
      id: 'submission-peak',
      chart: CHART.monthlySubmissions,
      topic: 'Submission peak',
      statement,
      facts,
      score: clamp01(0.35 + (peakCount / median - 1.6) * 0.2) + (facts.commonestItaMonth ? 0.15 : 0),
    },
  ];
}

/** Draw categories that move much faster or slower than the rest. */
function qDrawCategoryTimes(ctx) {
  const { completed } = ctx;
  const withCat = completed.filter((r) => filled(r[DRAW_FIELD]));
  if (withCat.length < MIN_GROUP * 2) return [];
  const baseline = mean(withCat.map(daysOf));
  const groups = {};
  for (const r of withCat) (groups[r[DRAW_FIELD]] ||= []).push(daysOf(r));

  const out = [];
  for (const [cat, days] of Object.entries(groups)) {
    if (days.length < MIN_GROUP) continue;
    const m = mean(days);
    const deviation = (m - baseline) / baseline;
    if (Math.abs(deviation) < 0.2) continue;
    out.push({
      id: `draw-time-${slug(cat)}`,
      chart: CHART.drawTimes,
      topic: deviation < 0 ? 'Faster draw category' : 'Slower draw category',
      statement: `${cat} cases averaged ${m} days to PPR, against ${baseline} days across all cases naming a category (${days.length} completed cases).`,
      facts: {
        drawCategory: cat,
        completedCases: days.length,
        ...dur('categoryAverage', m),
        ...dur('allCategoriesAverage', baseline),
        differencePct: Math.round(Math.abs(deviation) * 100),
        direction: deviation < 0 ? 'faster' : 'slower',
      },
      score: clamp01(0.4 + Math.abs(deviation)),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2);
}

/**
 * Categories whose cases reach PPR far more (or less) often than the rest —
 * a sign of prioritisation the share chart alone does not show.
 */
function qDrawCategoryApprovalRate(ctx) {
  const withCat = ctx.records.filter((r) => filled(r[DRAW_FIELD]));
  if (withCat.length < 20) return [];
  const approved = (r) => Boolean(parseLooseDate(r[PPR_FIELD]));
  const baseline = pct(withCat.filter(approved).length, withCat.length);
  const groups = {};
  for (const r of withCat) (groups[r[DRAW_FIELD]] ||= []).push(r);

  const out = [];
  for (const [cat, rows] of Object.entries(groups)) {
    if (rows.length < 10) continue;
    const rate = pct(rows.filter(approved).length, rows.length);
    if (Math.abs(rate - baseline) < 15) continue;
    out.push({
      id: `draw-rate-${slug(cat)}`,
      chart: CHART.drawShare,
      topic: 'Draw category approval rate',
      statement: `${rate}% of ${cat} cases have reached PPR, against ${baseline}% of all cases naming a category (${rows.length} cases).`,
      facts: {
        drawCategory: cat,
        cases: rows.length,
        reachedPPRPct: rate,
        allCategoriesReachedPPRPct: baseline,
        direction: rate > baseline ? 'higher' : 'lower',
      },
      score: clamp01(0.35 + Math.abs(rate - baseline) / 100),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2);
}

/** Nationalities whose average sits well apart from the overall figure. */
function qNationalityTimes(ctx) {
  const { summary, overallMean } = ctx;
  if (!overallMean) return [];
  const out = [];
  for (const [code, v] of Object.entries(summary.processingByNationality || {})) {
    if (v.count < MIN_GROUP) continue;
    const meanDays = Math.round(v.meanDays);
    const deviation = (meanDays - overallMean) / overallMean;
    if (Math.abs(deviation) < 0.25) continue;
    const name = countryName(code);
    out.push({
      id: `nationality-${slug(code)}`,
      chart: CHART.nationalityTimes,
      topic: deviation > 0 ? 'Slower nationality' : 'Faster nationality',
      statement: `${name} nationals averaged ${meanDays} days to PPR, against ${overallMean} days overall (${v.count} completed cases).`,
      facts: {
        nationality: name,
        completedCases: v.count,
        ...dur('nationalityAverage', meanDays),
        ...dur('overallAverage', overallMean),
        differencePct: Math.round(Math.abs(deviation) * 100),
        direction: deviation > 0 ? 'slower' : 'faster',
        sensitive: true,
      },
      score: clamp01(0.3 + Math.abs(deviation) * 0.8),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2);
}

/**
 * What the slowest tenth of cases have in common: an old invitation, an extra
 * document request, a category, a nationality.
 */
function qSlowestProfile(ctx) {
  const { completed } = ctx;
  if (completed.length < 30) return [];
  const sorted = [...completed].sort((a, b) => daysOf(b) - daysOf(a));
  const slowCount = Math.max(MIN_GROUP, Math.round(completed.length / 10));
  const slow = sorted.slice(0, slowCount);
  const thresholdDays = daysOf(slow[slow.length - 1]);

  const traits = [
    { key: 'adr', label: 'had an additional document request', of: (r) => (filled(r[ADR_FIELD]) ? 'yes' : 'no'), value: 'yes' },
    { key: 'category', label: 'draw category', of: (r) => r[DRAW_FIELD] },
    { key: 'stream', label: 'stream', of: (r) => r['Stream'] },
    { key: 'nationality', label: 'nationality', of: (r) => (r['Nationality'] ? countryName(r['Nationality']) : null), sensitive: true },
    { key: 'itaYear', label: 'ITA year', of: (r) => parseLooseDate(r['ITA Date'])?.getUTCFullYear() },
  ];

  const out = [];
  for (const t of traits) {
    const pick = t.value ?? dominant(slow, t.of)?.value;
    if (pick === undefined || pick === null) continue;
    const inSlow = slow.filter((r) => String(t.of(r)) === String(pick)).length;
    const slowKnown = slow.filter((r) => filled(t.of(r))).length;
    const allKnown = completed.filter((r) => filled(t.of(r)));
    const inAll = allKnown.filter((r) => String(t.of(r)) === String(pick)).length;
    const slowShare = pct(inSlow, slowKnown);
    const allShare = pct(inAll, allKnown.length);
    if (inSlow < 3 || slowShare < 30 || allShare === 0 || slowShare < allShare * 2) continue;
    const what = t.key === 'adr' ? 'had an additional document request' : `${t.label} ${pick}`;
    out.push({
      trait: t.key,
      what,
      sensitive: Boolean(t.sensitive),
      facts: { trait: what, slowestCasesWithTraitPct: slowShare, allCasesWithTraitPct: allShare, slowestCasesWithTrait: inSlow },
      ratio: slowShare / allShare,
    });
  }
  if (!out.length) return [];
  out.sort((a, b) => b.ratio - a.ratio);
  const top = out.slice(0, 2);

  return [
    {
      id: 'slowest-profile',
      chart: CHART.slowest,
      topic: 'What the slowest cases share',
      statement:
        `Among the slowest ${slowCount} completed cases (${thresholdDays} days or more), ` +
        top.map((t) => `${t.facts.slowestCasesWithTraitPct}% ${t.trait === 'adr' ? 'had an additional document request' : `were ${t.what}`}, against ${t.facts.allCasesWithTraitPct}% of all completed cases`).join('; ') +
        '.',
      facts: {
        slowestCases: slowCount,
        ...dur('slowestThreshold', thresholdDays),
        traits: top.map((t) => t.facts),
        sensitive: top.some((t) => t.sensitive),
      },
      score: clamp01(0.45 + (top[0].ratio - 2) * 0.1),
    },
  ];
}

/** Whether an additional document request goes with a longer wait. */
function qAdditionalDocuments(ctx) {
  const { completed } = ctx;
  const withAdr = completed.filter((r) => filled(r[ADR_FIELD]));
  const without = completed.filter((r) => !filled(r[ADR_FIELD]));
  if (withAdr.length < MIN_GROUP || without.length < MIN_GROUP) return [];
  const a = mean(withAdr.map(daysOf));
  const b = mean(without.map(daysOf));
  const diff = (a - b) / b;
  if (Math.abs(diff) < 0.15) return [];
  return [
    {
      id: 'additional-documents',
      chart: CHART.milestones,
      topic: 'Additional document requests',
      statement: `Completed cases that received an additional document request averaged ${a} days to PPR, against ${b} days for those that did not (${withAdr.length} and ${without.length} cases).`,
      facts: {
        casesWithRequest: withAdr.length,
        casesWithoutRequest: without.length,
        ...dur('withRequestAverage', a),
        ...dur('withoutRequestAverage', b),
        differencePct: Math.round(Math.abs(diff) * 100),
        direction: diff > 0 ? 'longer' : 'shorter',
      },
      score: clamp01(0.5 + Math.abs(diff) * 0.5),
    },
  ];
}

/** Where in the process most of the wait sits. */
function qStageShare(ctx) {
  const s = ctx.summary;
  const whole = (x) => (typeof x === 'number' ? Math.round(x) : x);
  const total = whole(s.daysSubmissionToPPR?.mean);
  const afterBil = whole(s.daysBilToPPR?.mean);
  const toAor = whole(s.daysSubmissionToAor?.mean);
  if (!total || !afterBil || s.daysBilToPPR.count < MIN_GROUP) return [];
  const share = pct(afterBil, total);
  const aorShare = toAor ? pct(toAor, total) : 0;
  if (share < 50 && aorShare < 30) return [];
  const facts = {
    ...dur('submissionToPPRAverage', total),
    ...dur('biometricsToPPRAverage', afterBil),
    biometricsToPPRSharePct: share,
  };
  let statement = `On average, ${afterBil} of the ${total} days from submission to PPR (${share}%) come after the biometrics letter.`;
  if (aorShare >= 30) {
    Object.assign(facts, { ...dur('submissionToAORAverage', toAor), submissionToAORSharePct: aorShare });
    statement += ` Waiting for AOR alone takes ${toAor} days (${aorShare}%).`;
  }
  return [
    {
      id: 'stage-share',
      chart: CHART.milestones,
      topic: 'Where the wait sits',
      statement,
      facts,
      score: 0.4,
    },
  ];
}

/** A clear gap between streams, including Inland vs Outland of one programme. */
function qStreamGap(ctx) {
  const groups = {};
  for (const r of ctx.completed) if (r['Stream']) (groups[r['Stream']] ||= []).push(daysOf(r));
  const rows = Object.entries(groups)
    .filter(([, d]) => d.length >= MIN_GROUP)
    .map(([stream, d]) => ({ stream, mean: mean(d), count: d.length }))
    .sort((a, b) => a.mean - b.mean);
  if (rows.length < 2) return [];
  const fast = rows[0];
  const slow = rows[rows.length - 1];
  const ratio = slow.mean / fast.mean;
  if (ratio < 1.3) return [];
  // A days difference, not a ratio: "1.4 times" invited "1.4 times the
  // speed", which says the opposite of the data.
  const daysLonger = slow.mean - fast.mean;
  return [
    {
      id: 'stream-gap',
      chart: CHART.streamTimes,
      topic: 'Gap between streams',
      statement: `${slow.stream} cases averaged ${slow.mean} days to PPR, ${daysLonger} days longer than the ${fast.mean} days of ${fast.stream} (${slow.count} and ${fast.count} completed cases).`,
      facts: {
        slowerStream: slow.stream,
        ...dur('slowerStreamAverage', slow.mean),
        slowerStreamCases: slow.count,
        fasterStream: fast.stream,
        ...dur('fasterStreamAverage', fast.mean),
        fasterStreamCases: fast.count,
        daysLonger,
      },
      score: clamp01(0.3 + (ratio - 1.3) * 0.5),
    },
  ];
}

/** One stage holding most of the cases still in progress. */
function qBottleneck(ctx) {
  const s = ctx.summary;
  const inProgress = (s.stageCounts || []).filter((x) => !['PPR', 'Landed', 'Submitted'].includes(x.status));
  const total = inProgress.reduce((n, x) => n + x.count, 0);
  if (total < 20) return [];
  const top = [...inProgress].sort((a, b) => b.count - a.count)[0];
  const share = pct(top.count, total);
  if (share < 40) return [];
  return [
    {
      id: 'stage-bottleneck',
      chart: CHART.process,
      topic: 'Where open cases are waiting',
      statement: `${top.count} of the ${total} cases past submission but not yet at PPR (${share}%) are at ${top.label}.`,
      facts: { stage: top.label, casesAtStage: top.count, openCasesPastSubmission: total, sharePct: share },
      score: clamp01(0.3 + (share - 40) / 100),
    },
  ];
}

/**
 * Whether applying from inside Canada changes the wait. How many live in
 * Canada is plain from the residence chart; whether they are processed faster
 * is not.
 */
function qResidence(ctx) {
  const inside = ctx.completed.filter((r) => r['Country of Residence'] === 'CA').map(daysOf);
  const outside = ctx.completed
    .filter((r) => filled(r['Country of Residence']) && r['Country of Residence'] !== 'CA')
    .map(daysOf);
  if (inside.length < MIN_GROUP || outside.length < MIN_GROUP) return [];
  const a = mean(inside);
  const b = mean(outside);
  const diff = (a - b) / b;
  if (Math.abs(diff) < 0.15) return [];
  return [
    {
      id: 'residence-canada',
      chart: CHART.countries,
      topic: 'Applying from inside Canada',
      statement: `Completed cases from applicants living in Canada averaged ${a} days to PPR, against ${b} days for those living abroad (${inside.length} and ${outside.length} cases).`,
      facts: {
        casesLivingInCanada: inside.length,
        casesLivingAbroad: outside.length,
        ...dur('livingInCanadaAverage', a),
        ...dur('livingAbroadAverage', b),
        differencePct: Math.round(Math.abs(diff) * 100),
        direction: diff < 0 ? 'faster' : 'slower',
      },
      score: clamp01(0.35 + Math.abs(diff) * 0.6),
    },
  ];
}

/** Which province nominates most PNP applicants — only when one clearly dominates. */
function qProvince(ctx) {
  const pnp = ctx.records.filter((r) => /^PNP/.test(r['Stream'] || ''));
  const top = dominant(pnp, (r) => titleCase(r[PROVINCE_FIELD]));
  if (!top || top.of < 10 || top.sharePct < 40) return [];
  return [
    {
      id: 'pnp-province',
      chart: CHART.streams,
      topic: 'Leading nominating province',
      statement: `${top.value} accounts for ${top.sharePct}% of PNP cases that name a province (${top.count} of ${top.of}).`,
      facts: { province: top.value, cases: top.count, pnpCasesNamingProvince: top.of, sharePct: top.sharePct, pnpCases: pnp.length },
      score: 0.3,
    },
  ];
}

/** Refusals worth a mention: more than a trace, and what they share. */
function qRefusals(ctx) {
  const s = ctx.summary;
  const rate = pct(s.refusalCount, s.totalRecordsAnalyzed);
  if (s.refusalCount < 5 || rate < 3) return [];
  return [
    {
      id: 'refusals',
      chart: CHART.status,
      topic: 'Refusals',
      statement: `${s.refusalCount} cases (${rate}%) were refused.`,
      facts: { refusedCases: s.refusalCount, totalCases: s.totalRecordsAnalyzed, refusedPct: rate },
      score: clamp01(0.3 + rate / 50),
    },
  ];
}

/** "BRITISH COLUMBIA" -> "British Columbia"; the field is free-typed. */
const titleCase = (v) =>
  filled(v) ? String(v).trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : v;

const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The reading a finding suggests — what it means for someone waiting, and the
 * likely why where the data hints at one. Handed to the writer as guidance, so
 * it explains rather than restating the statement. Causes are worded as
 * possibilities here too, since the writer tends to echo this phrasing.
 */
function angleFor(f) {
  const x = f.facts || {};
  if (f.id === 'outliers-excluded')
    return 'A few very long cases were left out so they do not make typical waits look longer than they are. Say what they had in common if the facts show it, such as an old invitation.';
  if (f.id.startsWith('month-')) {
    if (x.drivenByOneCase)
      return 'The month looks unusual mainly because of one case, not because applicants generally waited longer or shorter.';
    if (x.commonestItaMonth || x.dominantDrawCategory)
      return 'Many of these cases share an invitation month or draw category, which may explain the speed: a cohort that was likely processed together.';
    return 'A real difference across many cases, not a single outlier.';
  }
  if (f.id === 'recent-months-incomplete')
    return 'Recent months only look quick because their slower cases have not been approved yet. Their averages will likely rise as those cases finish.';
  if (f.id === 'submission-peak')
    return 'A wave of submissions, likely following a large invitation round if the ITA facts point to one.';
  if (f.id.startsWith('draw-time-'))
    return `Applicants in this category moved noticeably ${x.direction} than the others.`;
  if (f.id.startsWith('draw-rate-'))
    return `A ${x.direction} share of this category has been approved, which may suggest these cases are being finalised ${x.direction === 'higher' ? 'sooner' : 'later'}.`;
  if (f.id.startsWith('nationality-'))
    return 'Describe the gap and the sample size only. Give no reason for it.';
  if (f.id === 'slowest-profile')
    return x.sensitive
      ? 'The slowest cases tend to share these traits. Describe this only; give no reason where nationality is involved.'
      : 'The slowest cases tend to share these traits, which may be part of why they took longer.';
  if (f.id === 'additional-documents')
    return `An extra document request goes with a ${x.direction} wait.`;
  if (f.id === 'stage-share')
    return 'Most of the wait comes in the later checks, after the biometrics letter, rather than at the start.';
  if (f.id === 'stream-gap') return 'One stream is taking noticeably longer than another.';
  if (f.id === 'stage-bottleneck') return 'Many open cases are waiting at this one stage.';
  if (f.id === 'residence-canada')
    return `Applicants already living in Canada were processed ${x.direction} than those applying from abroad.`;
  if (f.id === 'pnp-province') return 'One province accounts for a large share of nominations.';
  if (f.id === 'refusals') return 'Refusals are a small but real share of cases.';
  return '';
}

/**
 * The headline numbers of a finding. Any passage that uses the finding must
 * state at least one of them — a note that says July was fast without saying
 * how fast is not worth printing. Enforced by the fact check.
 */
function keyFiguresFor(f) {
  const x = f.facts || {};
  const pick = (...keys) => keys.map((k) => x[k]).filter((v) => typeof v === 'number');
  if (f.id === 'outliers-excluded')
    return [...pick('averageIncludingExcludedDays', 'averageExcludingThemDays'), ...(x.cases || []).map((c) => c.caseDays)];
  if (f.id.startsWith('month-'))
    return x.drivenByOneCase
      ? pick('extremeCaseDays', 'monthAverageWithoutItDays', 'monthAverageDays')
      : pick('monthAverageDays', 'monthAverageMonths');
  if (f.id === 'recent-months-incomplete') return pick('completedPct', 'casesReachedPPR');
  if (f.id === 'submission-peak') return pick('casesSubmitted', 'timesTypical');
  if (f.id.startsWith('draw-time-')) return pick('categoryAverageDays', 'categoryAverageMonths', 'differencePct');
  if (f.id.startsWith('draw-rate-')) return pick('reachedPPRPct');
  if (f.id.startsWith('nationality-')) return pick('nationalityAverageDays', 'nationalityAverageMonths');
  if (f.id === 'slowest-profile') return (x.traits || []).map((t) => t.slowestCasesWithTraitPct);
  if (f.id === 'additional-documents')
    return pick('withRequestAverageDays', 'withRequestAverageMonths', 'differencePct');
  if (f.id === 'stage-share')
    return pick('biometricsToPPRAverageDays', 'biometricsToPPRAverageMonths', 'biometricsToPPRSharePct');
  if (f.id === 'stream-gap') return pick('slowerStreamAverageDays', 'daysLonger');
  if (f.id === 'stage-bottleneck') return pick('sharePct', 'casesAtStage');
  if (f.id === 'residence-canada')
    return pick('livingInCanadaAverageDays', 'livingAbroadAverageDays', 'differencePct');
  if (f.id === 'pnp-province') return pick('sharePct');
  if (f.id === 'refusals') return pick('refusedPct', 'refusedCases');
  return [];
}

const PROGRAM_NAMES = { CEC: 'Canadian Experience Class', FSW: 'Federal Skilled Worker', PNP: 'Provincial Nominee' };

/** Ways a writer might name a stream: "FSW-Outland", "FSW Outland", "Federal Skilled Worker Outland". */
function streamNames(stream) {
  const [program, where] = String(stream).split('-');
  const full = PROGRAM_NAMES[program];
  const names = [stream, stream.replace('-', ' ')];
  if (full) names.push(where ? `${full} ${where}` : full, where ? `${full} (${where})` : full);
  return [...new Set(names)];
}

/** "French-language proficiency" -> also "French-language"; "Healthcare occupations" -> "Healthcare". */
const categoryNames = (cat) => [...new Set([cat, String(cat).replace(/\s+(occupations|proficiency)$/i, '')])];

/**
 * Who is slow and who is fast in a comparison finding, with the names a
 * writer might use for each. The fact check uses this to catch a comparison
 * written backwards in code — "CEC was faster" when CEC was slower — rather
 * than trusting the reviewer model with an error that bad.
 *
 * @returns {{ names: string[], dir: 'slow'|'fast' }[]}
 */
function sidesFor(f) {
  const x = f.facts || {};
  const dir = (d) => (/slower|longer|lower/.test(String(d)) ? 'slow' : 'fast');
  const flip = (d) => (d === 'slow' ? 'fast' : 'slow');
  if (f.id === 'stream-gap')
    return [
      { names: streamNames(x.slowerStream), dir: 'slow' },
      { names: streamNames(x.fasterStream), dir: 'fast' },
    ];
  if (f.id.startsWith('month-')) return [{ names: [x.month], dir: dir(x.direction) }];
  if (f.id.startsWith('draw-time-')) return [{ names: categoryNames(x.drawCategory), dir: dir(x.direction) }];
  if (f.id.startsWith('nationality-')) return [{ names: [x.nationality], dir: dir(x.direction) }];
  if (f.id === 'residence-canada') {
    const inside = dir(x.direction);
    return [
      { names: ['in Canada', 'inside Canada'], dir: inside },
      { names: ['abroad', 'outside Canada', 'overseas'], dir: flip(inside) },
    ];
  }
  if (f.id === 'additional-documents')
    return [{ names: ['document request', 'additional document', 'ADR'], dir: dir(x.direction) }];
  return [];
}

/** In the order a reader meets the charts. */
const QUESTIONS = [
  qOutliers,
  qStageShare,
  qAdditionalDocuments,
  qBottleneck,
  qRefusals,
  qProvince,
  qResidence,
  qStreamGap,
  qDrawCategoryApprovalRate,
  qDrawCategoryTimes,
  qNationalityTimes,
  qSubmissionPeak,
  qMonthlyTimes,
  qRecentMonthsIncomplete,
  qSlowestProfile,
];

/**
 * Runs every question over the report slice.
 *
 * @param {object[]} records the report's filtered rows
 * @param {object} summary analyze() output, run with excludeOutliers
 * @returns {{ findings: object[], asked: number }}
 *   findings notable answers, strongest first, capped at MAX_FINDINGS
 */
export function buildFindings(records, summary) {
  const fences = summary.outliers || {};
  const completedAll = records.filter((r) => daysOf(r) !== null);
  const completed = withinFences(completedAll, fences);
  const ctx = {
    records,
    summary,
    completedAll,
    completed,
    completedWithCategory: completed.filter((r) => filled(r[DRAW_FIELD])).length,
    overallMean: mean(completed.map(daysOf)),
  };

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
      .map((f) => ({
        ...f,
        angle: angleFor(f),
        keyFigures: keyFiguresFor(f),
        sides: sidesFor(f),
        score: Math.round(f.score * 100) / 100,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FINDINGS),
    asked: QUESTIONS.length,
  };
}
