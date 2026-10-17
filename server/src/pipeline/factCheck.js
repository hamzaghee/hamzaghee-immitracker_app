/**
 * Fact check for the generated analysis.
 *
 * The writer is told to use only the figures it is given, but a prompt is a
 * request, not a guarantee. Every piece of generated text therefore passes two
 * checks before it reaches the report, and anything that fails either is
 * removed rather than shown:
 *
 *   1. Mechanical, in code. Each piece must cite the findings it is based on,
 *      sit under the chart those findings belong to, state each finding's
 *      headline number, contain no number that is absent from its sources
 *      (rounding allowed), keep every comparison the right way round and
 *      between the right groups, never give a duration as a multiple, and —
 *      where a finding involves nationality — offer no cause at all.
 *
 *   2. A separate model call, with its own prompt, acting as a reviewer. It
 *      sees each piece next to its sources and judges what code cannot: a
 *      reversed comparison, a claim the facts do not support, a guessed cause
 *      stated as fact.
 *
 * The check fails closed. If the reviewer cannot be reached, nothing generated
 * is published — an unchecked note is exactly what this exists to prevent.
 */

import { generateJson } from './llm.js';
import { glossaryText } from './glossary.js';

/** Longest piece of generated text accepted, in characters. */
const MAX_LENGTH = 900;

/**
 * Wording that offers a cause. Not allowed at all in a passage about a
 * nationality pattern — not even hedged, since "may reflect additional
 * screening" still points at the applicants' origin as the reason. The
 * reviewer was seen letting the hedged form through, so code enforces it.
 */
const CAUSE_WORDING =
  /\b(because|due to|owing to|result of|caused|reflect\w*|explain\w*|suggest\w*|likely|attribut\w*|screening|security|scrutiny|backlog|polic\w*|prioriti\w*)\b/i;

const isSensitive = (sources) => sources.some((s) => s?.facts?.sensitive === true);

/*
 * Comparisons written backwards ("CEC was faster" when it was slower) are too
 * damaging to leave to the reviewer alone, so code checks them as well.
 */
const SLOW_WORDS = /(?<!\bno )\b(slower|longer|lengthier|more slowly)\b/gi;
const FAST_WORDS = /\b(faster|quicker|shorter|sooner|more quickly)\b/gi;

/** Durations as multiples of speed — "1.4 times the speed", "twice as fast". Easy to get backwards, so never allowed. */
const SPEED_MULTIPLE =
  /\b\d+(?:\.\d+)?\s*(?:x|times)\s+(?:the\s+)?(?:speed|pace|as\s+(?:fast|quick|slow|long)|faster|quicker|slower|longer|shorter)\b|\b(?:twice|half|three times)\s+as\s+(?:fast|quick|quickly|slow|slowly|long)\b/i;

/** A two-group comparison widened to everyone: "slower than other streams". */
const WIDENED =
  /\b(?:all|every|any)\s+other\b|\bother\s+(?:streams?|programs?|programmes?|groups?|applicants|cases)\b|\bthe rest\b|\beveryone else\b/i;

/** PPR described as permanent residence: "from submission to permanent residence". */
const PPR_AS_PR = /\b(?:submission|application|applying|submitted)\s+(?:to|until)\s+(?:permanent\s+residen\w*|PR)\b/i;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Checks each direction word against the group it describes — taken to be the
 * group named last before the word in the same sentence ("CEC took longer than
 * FSW-Outland": "longer" describes CEC). Returns the first contradiction.
 *
 * Errs towards removing: an unusual sentence order can flag a correct
 * sentence, which costs a note, never a wrong one published.
 */
function directionError(text, sides) {
  if (!sides?.length) return null;
  const patterns = sides.map((side) => ({
    side,
    re: new RegExp(`(?<![\\w-])(?:${side.names.filter(Boolean).map(escapeRe).join('|')})(?![\\w-])`, 'gi'),
  }));
  for (const sentence of String(text).split(/(?<=[.!?])\s+/)) {
    const words = [
      ...[...sentence.matchAll(SLOW_WORDS)].map((m) => ({ at: m.index, word: m[0], dir: 'slow' })),
      ...[...sentence.matchAll(FAST_WORDS)].map((m) => ({ at: m.index, word: m[0], dir: 'fast' })),
    ];
    for (const w of words) {
      let subject = null;
      for (const { side, re } of patterns) {
        for (const m of sentence.matchAll(re)) {
          if (m.index < w.at && (!subject || m.index > subject.at)) subject = { at: m.index, name: m[0], side };
        }
      }
      if (subject && subject.side.dir !== w.dir) {
        return `says ${subject.name} is "${w.word}", but the data shows it is ${subject.side.dir === 'slow' ? 'slower' : 'faster'}`;
      }
    }
  }
  return null;
}

/* ---------------- 1. mechanical checks ---------------- */

/** Numbers written in the text, as values: "1,021" -> 1021, "45%" -> 45. */
export function numbersIn(text) {
  const out = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(String(text ?? ''))) !== null) {
    // "1,021" is one number; "3,5" in a list is two, but that is not how
    // figures are written in this report.
    const v = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Every number a source contains, including those inside labels ("July 2025"). */
function collectNumbers(value, into = new Set()) {
  if (value === null || value === undefined) return into;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.add(value);
  } else if (typeof value === 'string') {
    for (const n of numbersIn(value)) into.add(n);
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, into);
  } else if (typeof value === 'object') {
    for (const v of Object.values(value)) collectNumbers(v, into);
  }
  return into;
}

/**
 * Whether a number in the text is one of the source's, allowing the roundings
 * a writer naturally makes: 115.4 days as "115 days", 45.2% as "45%", 5.1
 * months as "5 months".
 *
 * Small figures get a tighter allowance than a whole-number round. Rounding
 * 2.7 times to "3 times", or 0.8% to "1%", changes what the sentence says.
 */
function matches(x, allowed) {
  for (const a of allowed) {
    if (Math.abs(x - a) < 0.051) return true;
    if (Math.abs(a) >= 10 ? Number.isInteger(x) && x === Math.round(a) : Math.abs(x - a) <= 0.15) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} text
 * @param {object[]} sources fact objects the text may draw on
 * @returns {string[]} numbers in the text with no source, as written
 */
export function unsupportedNumbers(text, sources) {
  const allowed = new Set();
  for (const s of sources) collectNumbers(s, allowed);
  return [...new Set(numbersIn(text))].filter((x) => !matches(x, allowed)).map(String);
}

/**
 * Runs the code checks over every generated piece.
 *
 * @param {object[]} items { id, label, text, chart?, findingIds?, sources }
 * @param {Map<string, object>} findingsById
 * @returns {{ passed: object[], removed: object[] }}
 */
export function mechanicalCheck(items, findingsById) {
  const passed = [];
  const removed = [];
  const reject = (item, reason) =>
    removed.push({ id: item.id, label: item.label, text: item.text, stage: 'code', reason });

  for (const item of items) {
    const text = String(item.text ?? '').trim();
    if (!text) {
      reject(item, 'empty');
      continue;
    }
    if (text.length > MAX_LENGTH) {
      reject(item, `longer than ${MAX_LENGTH} characters`);
      continue;
    }
    if (item.findingIds) {
      const cited = item.findingIds.filter((id) => findingsById.has(id));
      if (!cited.length) {
        reject(item, 'cites no known finding');
        continue;
      }
      if (item.chart && !cited.some((id) => findingsById.get(id).chart === item.chart)) {
        reject(item, `placed under ${item.chart}, which none of its findings belong to`);
        continue;
      }
      // Each finding used must keep its headline number, so a note cannot
      // say a month was fast without saying how fast.
      const written = numbersIn(text);
      const missing = cited.find((id) => {
        const key = findingsById.get(id).keyFigures || [];
        return key.length && !written.some((x) => matches(x, key));
      });
      if (missing) {
        reject(item, `leaves out the key figure for ${missing}`);
        continue;
      }
      const backwards = cited
        .map((id) => directionError(text, findingsById.get(id).sides))
        .find(Boolean);
      if (backwards) {
        reject(item, `comparison is backwards: ${backwards}`);
        continue;
      }
      const twoGroup = cited.some((id) => (findingsById.get(id).sides || []).length === 2);
      const widened = twoGroup && text.match(WIDENED);
      if (widened) {
        reject(item, `widens a two-group comparison ("${widened[0]}")`);
        continue;
      }
      item.findingIds = cited;
    }
    const stray = unsupportedNumbers(text, item.sources);
    if (stray.length) {
      reject(item, `figures not in the data: ${stray.join(', ')}`);
      continue;
    }
    const asPr = text.match(PPR_AS_PR);
    if (asPr) {
      reject(item, `describes PPR as permanent residence ("${asPr[0]}")`);
      continue;
    }
    const multiple = text.match(SPEED_MULTIPLE);
    if (multiple) {
      reject(item, `expresses a duration as a multiple ("${multiple[0]}")`);
      continue;
    }
    const cause = isSensitive(item.sources) && text.match(CAUSE_WORDING);
    if (cause) {
      reject(item, `suggests a cause for a nationality pattern ("${cause[0]}")`);
      continue;
    }
    passed.push({ ...item, text });
  }
  return { passed, removed };
}

/* ---------------- 2. reviewer call ---------------- */

const reviewSchema = {
  type: 'object',
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reason: { type: 'string' },
          verdict: { type: 'string', enum: ['pass', 'fail'] },
        },
        required: ['id', 'reason', 'verdict'],
        // Reason before verdict: deciding first and justifying after produced
        // fails whose own reason said the text was correct.
        propertyOrdering: ['id', 'reason', 'verdict'],
      },
    },
  },
  required: ['reviews'],
};

/** `glossary` is the report's own term list as prompt text; Express Entry's by default. */
export function buildReviewPrompt(items, glossary = glossaryText()) {
  const payload = items.map((i) => ({ id: i.id, text: i.text, source: i.sources }));
  return `You are a strict fact-checker for a report on Canadian immigration processing times.
You did not write the text below. Your only job is to decide whether each item is supported by its source.

Mark an item "pass" only if ALL of these hold:
1. Every number, date, month, name and category in the text appears in its source. Rounding is fine (115.4 days written as 115 days, 5.1 months as 5 months).
2. Every comparison points the right way: faster or slower, more or fewer, higher or lower, longer or shorter.
3. The text claims nothing the source does not support. An explanation that goes beyond the source is allowed only when it is clearly worded as a possibility ("may", "might", "could", "likely", "suggests", "consistent with"). Causal wording without such a hedge — "because", "due to", "driven by", "aided by", "thanks to", "caused by" — fails unless the source itself states that cause.
4. It does not state IRCC's intentions, priorities or policy as fact. A hedged possibility such as "which may suggest these cases are being prioritised" is allowed.
5. Where a nationality is involved, it describes the pattern only and suggests no cause — not even a hedged one. This overrides point 3: "may reflect additional screening" fails.
6. It is not misleading, for example by presenting a handful of cases as a firm trend.
7. Every term is used as the GLOSSARY defines it. For example, calling PPR "permanent residence" fails.
8. A comparison names exactly the groups the source compares. Widening it — "other streams", "everyone else", "all applicants" when the source compares two specific groups — fails.
9. Processing times are not expressed as multiples of speed ("1.4 times the speed", "twice as fast"). These are easy to get backwards, so they fail. This applies to durations only: a count given as a multiple of a typical month ("2.7 times a typical month") is fine when the source gives that figure.

Otherwise mark it "fail". Write the reason first: check each point above against the source, then name the specific problem, or say "supported". The verdict must follow from the reason.
Review every item, and use each item's id exactly as given.

GLOSSARY:
${glossary}

ITEMS:
${JSON.stringify(payload, null, 2)}`;
}

/**
 * Sends the items that survived the code checks to the reviewer.
 *
 * @returns {Promise<{ok:true, model:string, passed:object[], removed:object[]} | {ok:false, reason:string}>}
 */
export async function reviewWithModel(items, { deadline, glossary } = {}) {
  if (!items.length) return { ok: true, model: null, passed: [], removed: [] };

  const res = await generateJson({ prompt: buildReviewPrompt(items, glossary), schema: reviewSchema, deadline });
  if (!res.ok) return { ok: false, reason: res.reason };

  const verdicts = new Map((res.json?.reviews || []).map((r) => [r.id, r]));
  const passed = [];
  const removed = [];
  for (const item of items) {
    const v = verdicts.get(item.id);
    if (v?.verdict === 'pass') {
      passed.push(item);
    } else {
      // An item the reviewer skipped is treated as failed: fail closed.
      removed.push({
        id: item.id,
        label: item.label,
        text: item.text,
        stage: 'review',
        reason: v ? v.reason || 'failed review' : 'not reviewed',
      });
    }
  }
  return { ok: true, model: res.model, passed, removed };
}
