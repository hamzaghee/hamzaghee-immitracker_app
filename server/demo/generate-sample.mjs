/**
 * Generates the synthetic dataset the demo environment ships with.
 *
 * Every record is invented. There are no real applicants here — usernames are
 * assembled from word lists, and the distributions merely *resemble* a real
 * export so the charts look plausible. Nothing in this file is derived from
 * anyone's data.
 *
 * It has to use the genuine field ids from pipeline/fieldMap.js, because the
 * pipeline keys off those; a file with invented ids parses fine and then every
 * chart comes out empty.
 *
 * Regenerate with:  node server/demo/generate-sample.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldToLabel } from '../src/pipeline/fieldMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'sample-dataset.json');
const COUNT = Number(process.env.SAMPLE_COUNT) || 800;

/** Reverse the dictionary so we can write by human label and emit real ids. */
const idOf = Object.fromEntries(Object.entries(fieldToLabel).map(([id, label]) => [label, id]));

/* ---------------- deterministic RNG ---------------- */
// Seeded so regenerating produces the same file and the diff stays empty unless
// the shape is deliberately changed.
let seed = 20260813;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => Math.floor(min + rnd() * (max - min + 1));

/** Picks a key from { key: weight }. */
function weighted(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (const [k, w] of Object.entries(weights)) {
    if ((r -= w) <= 0) return k;
  }
  return Object.keys(weights)[0];
}

/* ---------------- shape, mirroring a real export ---------------- */

const STREAMS = { CEC: 40, 'FSW-Outland': 34, 'PNP-Outland': 12, 'PNP-Inland': 9, 'FSW-Inland': 5 };
const STATUSES = {
  PPR: 30, 'e-APR AOR': 18, Landed: 17, 'Background Check': 14,
  'Medicals Passed': 8, Biometrics: 7, 'Decision Made': 3, Submitted: 2, Refused: 1,
};
const RESIDENCE = { CA: 62, IN: 10, US: 5, NG: 4, AE: 3, GB: 3, CN: 3, PK: 2, BR: 2, ZA: 2, PH: 2, DE: 1, FR: 1 };
const NATIONALITY = { IN: 30, CN: 12, NG: 8, PK: 6, PH: 6, BR: 4, IR: 4, GB: 4, UA: 3, EG: 3, KR: 3, MX: 3, CO: 3, VN: 3, TR: 2, ZA: 2 };
const PROVINCES = ['ONTARIO', 'BRITISH COLUMBIA', 'ALBERTA', 'MANITOBA', 'SASKATCHEWAN', 'NOVA SCOTIA'];
const DRAW_CATEGORIES = ['All-program / General', 'Canadian Experience Class', 'Healthcare occupations', 'STEM occupations', 'French language proficiency', 'Trade occupations'];
const VOS = ['Ottawa', 'Sydney', 'Etobicoke', 'Mississauga', 'Edmonton', 'Vegreville', 'New Delhi', 'Manila'];

// Obviously-invented usernames.
const ADJ = ['swift', 'quiet', 'bright', 'calm', 'brave', 'sunny', 'lucky', 'eager', 'clever', 'gentle', 'bold', 'merry'];
const NOUN = ['maple', 'river', 'harbour', 'summit', 'meadow', 'compass', 'lantern', 'beacon', 'anchor', 'willow', 'cedar', 'aurora'];

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
/** MongoDB extended-JSON, exactly as the real export encodes dates. */
const dateVal = (ms) => ({ $date: ms });

const PERIOD_END = Date.UTC(2026, 7, 1);
const PERIOD_START = Date.UTC(2025, 0, 15);

/**
 * Milestones are generated forward from Submitted so every derived duration is
 * internally consistent — an AOR can never precede its own submission, and
 * Submission→PPR always equals the sum of the legs.
 */
function buildCase(i) {
  const stream = weighted(STREAMS);
  const status = weighted(STATUSES);
  const submitted = PERIOD_START + Math.floor(rnd() * (PERIOD_END - PERIOD_START));

  const aor = submitted + int(0, 5) * DAY;
  const bil = aor + int(20, 80) * DAY;
  const meds = aor + int(25, 95) * DAY;
  const rprf = aor + int(0, 20) * DAY;

  // Only cases that actually reached PPR carry a PPR date and durations.
  const reachedPPR = ['PPR', 'Landed', 'Decision Made'].includes(status);
  const ppr = reachedPPR ? Math.max(bil, meds) + int(10, 150) * DAY : null;
  const landed = status === 'Landed' && ppr ? ppr + int(20, 120) * DAY : null;

  const days = (a, b) => (a && b ? Math.round((b - a) / DAY) : null);

  const rec = {
    // Array form, which the relabeler splits into Username + Case ID.
    username: [`${pick(ADJ)}_${pick(NOUN)}${int(10, 99)}`, `case-${900000 + i}`],
    _slugs: `case-${900000 + i}`,
    state: 'active',
    sign_title: 'Sample data — not real applicants',
    c_at: dateVal(submitted),
    updated: dateVal(ppr || meds),
    comments_count: int(0, 4),
  };

  const set = (label, value) => {
    if (value === null || value === undefined) return;
    const id = idOf[label];
    if (id) rec[id] = value;
  };

  set('Stream', stream);
  set('Current Status', status);
  set('Country of Residence', weighted(RESIDENCE));
  set('Nationality', weighted(NATIONALITY));
  set('Submitted', dateVal(submitted));
  set('AOR Date', dateVal(aor));
  set('Biometrics Invitation Letter', dateVal(bil));
  set('Medical Passed', dateVal(meds));
  set('RPRF paid date', dateVal(rprf));
  set('CRS Score', String(int(430, 520)));
  set('NOC Code', String(int(10000, 79999)));
  set('EE Draw Category', pick(DRAW_CATEGORIES));
  set('Primary VO', pick(VOS));
  set('Applicant & Dependents', String(int(1, 4)));
  set('Number of days from AOR to BIL', days(aor, bil));
  set('Number of Days after AOR to Meds passed', days(aor, meds));

  if (stream.startsWith('PNP')) set('Sponsored by Province (if PNP)', pick(PROVINCES));
  if (status === 'Refused') set('Refused', dateVal(meds + int(10, 60) * DAY));

  if (ppr) {
    set('Portal 2 Email / PPR Date', dateVal(ppr));
    set('Days from Submission to PPR', days(submitted, ppr));
    set('Days from AOR to PPR', days(aor, ppr));
    set('Number of Days after Meds passed to PPR', days(meds, ppr));
    set('Decision Made', dateVal(ppr - int(1, 15) * DAY));
  }
  if (landed) {
    set('Landing Date (Outland)', dateVal(landed));
    set('eCoPR Date (Inland Landing)', dateVal(landed));
  }

  return rec;
}

const records = Array.from({ length: COUNT }, (_, i) => buildCase(i));
fs.writeFileSync(OUT, JSON.stringify(records));

/* ---------------- report what was produced ---------------- */
const tally = (fn) =>
  records.reduce((a, r) => {
    const v = fn(r);
    if (v) a[v] = (a[v] || 0) + 1;
    return a;
  }, {});

const withPpr = records.filter((r) => r[idOf['Days from Submission to PPR']] != null);
const durations = withPpr.map((r) => r[idOf['Days from Submission to PPR']]).sort((a, b) => a - b);

console.log(`wrote ${OUT}`);
console.log(`  records        ${records.length}`);
console.log(`  size           ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB`);
console.log(`  streams        ${JSON.stringify(tally((r) => r[idOf.Stream]))}`);
console.log(`  statuses       ${JSON.stringify(tally((r) => r[idOf['Current Status']]))}`);
console.log(`  reached PPR    ${withPpr.length}`);
console.log(`  sub→PPR days   min ${durations[0]} / max ${durations[durations.length - 1]}`);
console.log(`  submitted span ${iso(Math.min(...records.map((r) => r[idOf.Submitted].$date))).slice(0, 10)} … ${iso(Math.max(...records.map((r) => r[idOf.Submitted].$date))).slice(0, 10)}`);
