/**
 * Report analysis — the "AI Analysis" stage.
 *
 * Split deliberately in two:
 *
 *   Analyses 1-3 are *computed*. The report spec gives exact sentence
 *   templates with numeric slots, so a language model adds nothing but risk;
 *   these are filled from the summary and are always correct and always
 *   present, even with no model running.
 *
 *   The executive summary and the three closing insight points are *generated*,
 *   because they call for actual prose. These degrade: if the model is
 *   unreachable or no API key is configured, the report still renders with every
 *   computed section intact and says the generated commentary was skipped.
 *
 * Every section carries { id, title, body, source } so the report page can hide
 * or replace any of them individually.
 *
 * Generation goes to Google's Generative Language API. The key travels in the
 * x-goog-api-key header rather than the query string, so it cannot end up in
 * request logs, proxy access logs or browser history, and it is never returned
 * to the client.
 */

import { DAYS_PER_MONTH, daysToMonths } from './analyze.js';

const API_BASE =
  process.env.LLM_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.0-flash';

/**
 * Gemma models on this API accept `responseMimeType` but handle `responseSchema`
 * inconsistently. Set LLM_USE_SCHEMA=0 to send the mime type alone and rely on
 * the prompt plus defensive parsing.
 */
const USE_SCHEMA = process.env.LLM_USE_SCHEMA !== '0';

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

  out.push({
    id: 'analysis-1',
    title: 'Submission to final approval',
    source: 'computed',
    body:
      `Over ${period}, on average it took ${months(s.daysSubmissionToPPR.mean)} for applications ` +
      `to go from submission to final approval (Portal 2 / PPR). ` +
      `This is based on ${s.daysSubmissionToPPR.count.toLocaleString('en-CA')} cases that have reached PPR.`,
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

/** Re-keys a { code: count } map to { name: count } for the model's benefit. */
const named = (counts, names) =>
  Object.fromEntries(Object.entries(counts || {}).map(([k, v]) => [names?.[k] || k, v]));

/** Compact, unambiguous figures for the model. Months precomputed so it never divides. */
function factSheet(s, config) {
  return {
    program: config.programLabel || 'Express Entry',
    stream: config.streamLabel || 'All Streams',
    period: periodLabel(config),
    casesSubmitted: s.totalRecordsAnalyzed,
    approvedReachedPPR: s.approvedCount,
    refused: s.refusalCount,
    landed: s.landedCount,
    atPPR: s.pprCount,
    decisionMade: s.decisionMadeCount,
    submissionToPPR: { meanDays: s.daysSubmissionToPPR.mean, meanMonths: daysToMonths(s.daysSubmissionToPPR.mean), cases: s.daysSubmissionToPPR.count },
    milestonesMeanDays: {
      submissionToAor: s.daysSubmissionToAor.mean,
      aorToMedicals: s.daysAorToMeds.mean,
      aorToBiometricsLetter: s.daysAorToBil.mean,
      aorToPPR: s.daysAorToPPR.mean,
      biometricsToPPR: s.daysBilToPPR.mean,
      medicalsToPPR: s.daysMedsToPPR.mean,
    },
    streamDistribution: s.streamDistribution,
    statusBreakdown: s.statusBreakdown,
    // Full country names rather than ISO codes: the model was translating the
    // codes itself, and getting some of them wrong.
    topCountriesOfResidence: named(s.topCountriesOfResidence, s.countryNames),
    topNationalities: named(s.topNationalities, s.countryNames),
    slowestMonth: s.slowestMonth,
    fastestMonth: s.fastestMonth,
    streamComparisonDays: s.streamComparison,
  };
}

const schema = {
  type: 'object',
  properties: {
    executive_summary: {
      type: 'string',
      description:
        'Two to four sentences. State the number of cases, refusals with percentage, and the average submission-to-PPR duration. Then a "big picture" sentence giving the Landed, PPR and Decision Made counts.',
    },
    insight_1_title: { type: 'string' },
    insight_1_text: { type: 'string' },
    insight_2_title: { type: 'string' },
    insight_2_text: { type: 'string' },
    insight_3_title: { type: 'string' },
    insight_3_text: { type: 'string' },
  },
  required: [
    'executive_summary',
    'insight_1_title', 'insight_1_text',
    'insight_2_title', 'insight_2_text',
    'insight_3_title', 'insight_3_text',
  ],
};

export function buildPrompt(s, config) {
  return `${PERSONA}

CRITICAL: use only the figures in the JSON below. Do not invent or extrapolate numbers.
Express any duration in months to one decimal place. Durations are given in days;
one month is ${DAYS_PER_MONTH} days, and monthly equivalents are already provided where relevant.

REPORT DATA:
${JSON.stringify(factSheet(s, config), null, 2)}

FORMAT: write flowing prose in complete sentences. Do not include any heading or
title inside a field — the report supplies those. Do not use bullet points,
numbered lists, tables or any other markdown syntax.

Write:
1. executive_summary — two to four sentences covering total cases, refusals with percentage, average submission-to-PPR in months, and the spread of outcomes.
2. Three further analytical insight points, each a short title and two to three sentences of prose. Draw them from the distributions, the milestone timings and the stream comparison. Be specific and cite the figures given. Do not repeat the executive summary.`;
}

/**
 * Whether generated prose is configured. Reports configuration only — it does
 * not call the API, so it stays cheap enough for the health endpoint. The key
 * itself is never included in the result.
 */
export function probeLlm() {
  return {
    available: Boolean(API_KEY),
    provider: 'google-generative-language',
    model: LLM_MODEL,
    reason: API_KEY ? undefined : 'GOOGLE_API_KEY is not set',
  };
}

/**
 * A model told to emit JSON often wraps it in a fenced block anyway. Strip that
 * before parsing rather than failing the whole report over punctuation.
 */
function parseJsonLoosely(text) {
  const trimmed = String(text || '').trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // Last resort: the outermost object in the response.
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error('response was not JSON');
  }
}

/**
 * Generated prose. Never throws — returns `{ available:false, reason }` so the
 * caller can render the computed sections and note the omission.
 */
export async function generateInsights(summary, config = {}, { timeoutMs = 120000 } = {}) {
  if (!API_KEY) {
    return { available: false, reason: 'No GOOGLE_API_KEY configured' };
  }

  try {
    const generationConfig = {
      temperature: 0,
      responseMimeType: 'application/json',
      ...(USE_SCHEMA ? { responseSchema: schema } : {}),
    };

    const res = await fetch(
      `${API_BASE}/models/${encodeURIComponent(LLM_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header rather than ?key= so the secret stays out of any URL log.
          'x-goog-api-key': API_KEY,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPrompt(summary, config) }] }],
          generationConfig,
        }),
      }
    );

    if (!res.ok) {
      // Surface the API's own message, which distinguishes a bad key from a bad
      // model name from a quota trip — but never echo the key back.
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        detail = errBody?.error?.message || detail;
      } catch {
        /* non-JSON error body */
      }
      return { available: false, reason: `${LLM_MODEL}: ${detail}` };
    }

    const body = await res.json();
    const candidate = body?.candidates?.[0];
    const finish = candidate?.finishReason;

    if (!candidate || (finish && finish !== 'STOP')) {
      return {
        available: false,
        reason: `${LLM_MODEL} returned no usable output (finishReason: ${finish || 'none'})`,
      };
    }

    const text = (candidate.content?.parts || []).map((p) => p.text || '').join('');
    if (!text.trim()) return { available: false, reason: `${LLM_MODEL} returned an empty response` };

    const parsed = parseJsonLoosely(text);
    return {
      available: true,
      model: LLM_MODEL,
      sections: [
        {
          id: 'executive-summary',
          title: 'Executive Summary & Macro Performance',
          body: parsed.executive_summary,
          source: 'ai',
        },
        ...[1, 2, 3].map((i) => ({
          id: `insight-${i}`,
          title: parsed[`insight_${i}_title`],
          body: parsed[`insight_${i}_text`],
          source: 'ai',
        })),
      ],
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/**
 * The full ordered analysis: generated executive summary, the computed
 * analyses, then the generated insight points. Missing generated pieces simply
 * drop out.
 */
export function assembleSections(computed, generated) {
  const ai = generated?.available ? generated.sections : [];
  const exec = ai.filter((x) => x.id === 'executive-summary');
  const points = ai.filter((x) => x.id !== 'executive-summary');
  return [...exec, ...computed, ...points];
}
