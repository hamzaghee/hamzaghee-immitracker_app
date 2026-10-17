/**
 * Generates a synthetic Citizenship tracker export for the demo and for tests.
 *
 * Every record is invented — usernames come from word lists and the timings
 * are drawn from ranges that merely resemble the real tracker. Nothing here is
 * derived from anyone's data.
 *
 * It uses the genuine field ids from pipeline/citizenship/fieldMap.js, since
 * the pipeline keys off those, and writes dates the way the tracker's own case
 * list does ("Mar 10, 2026", with a double space before single-digit days) so
 * that path through the date parser is exercised too.
 *
 * Regenerate with:  node server/demo/generate-citizenship-sample.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { citizenshipFieldToLabel } from '../src/pipeline/citizenship/fieldMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'citizenship-sample-dataset.json');
const COUNT = Number(process.env.SAMPLE_COUNT) || 800;

const idOf = Object.fromEntries(Object.entries(citizenshipFieldToLabel).map(([id, label]) => [label, id]));

/* ---------------- deterministic RNG ---------------- */
// Seeded so regenerating produces the same file.
let seed = 20261016;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => Math.floor(min + rnd() * (max - min + 1));
const chance = (p) => rnd() < p;

function weighted(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (const [k, w] of Object.entries(weights)) {
    if ((r -= w) <= 0) return k;
  }
  return Object.keys(weights)[0];
}

/* ---------------- shape, loosely mirroring the tracker ---------------- */

const PROVINCES = {
  ONTARIO: 52, 'BRITISH COLUMBIA': 15, ALBERTA: 14, QUEBEC: 6, MANITOBA: 5,
  SASKATCHEWAN: 3, 'NOVA SCOTIA': 3, 'NEW BRUNSWICK': 2,
};
const CITIES = {
  ONTARIO: ['Toronto', 'Mississauga', 'Brampton', 'Ottawa', 'Hamilton', 'Waterloo'],
  'BRITISH COLUMBIA': ['Vancouver', 'Surrey', 'Burnaby', 'Victoria'],
  ALBERTA: ['Calgary', 'Edmonton'],
  QUEBEC: ['Montreal', 'Quebec City'],
  MANITOBA: ['Winnipeg'],
  SASKATCHEWAN: ['Saskatoon', 'Regina'],
  'NOVA SCOTIA': ['Halifax'],
  'NEW BRUNSWICK': ['Moncton', 'Fredericton'],
};
const OFFICES = {
  ONTARIO: ['Mississauga', 'Toronto (Scarborough)', 'Toronto (Etobicoke)', 'Ottawa', 'Hamilton'],
  'BRITISH COLUMBIA': ['Vancouver', 'Surrey'],
  ALBERTA: ['Calgary', 'Edmonton'],
  QUEBEC: ['Montréal'],
  MANITOBA: ['Winnipeg'],
  SASKATCHEWAN: ['Saskatoon'],
  'NOVA SCOTIA': ['Halifax'],
  'NEW BRUNSWICK': ['Fredericton'],
};
const NATIONALITY = {
  India: 30, Philippines: 9, China: 8, Pakistan: 6, Nigeria: 6, Iran: 4, Mexico: 4,
  'United Kingdom of Great Britain and Northern Ireland': 4, Ukraine: 3, Brazil: 3,
  Colombia: 3, 'South Korea': 3, Bangladesh: 3, 'Viet Nam': 2, Jamaica: 2,
};

const ADJ = ['swift', 'quiet', 'bright', 'calm', 'brave', 'sunny', 'lucky', 'eager', 'clever', 'gentle', 'bold', 'merry'];
const NOUN = ['maple', 'river', 'harbour', 'summit', 'meadow', 'compass', 'lantern', 'beacon', 'anchor', 'willow', 'cedar', 'aurora'];

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Jun  2, 2026" — the tracker pads single-digit days with a space. */
const trackerDate = (ms) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')}, ${d.getUTCFullYear()}`;
};

const TODAY = Date.UTC(2026, 9, 16);
const FIRST_SENT = Date.UTC(2025, 0, 6);
const LAST_SENT = Date.UTC(2026, 8, 30);

/**
 * Milestones run forward from the sent date, so every span is consistent.
 * A case only carries the milestones it would have reached by TODAY.
 */
function buildCase(i) {
  const provinceKey = weighted(PROVINCES);
  const family = chance(0.35);
  const interview = chance(0.06);
  const fingerprint = chance(0.08);
  const urgent = chance(0.03);
  // A handful of cases stall for a year or more — the long tail the outlier
  // rule exists for.
  const stalled = chance(0.01);

  // Weighted toward recent months, as an active tracker is: older cases have
  // mostly finished and stopped being updated.
  const u = rnd();
  const sent = FIRST_SENT + Math.floor((1 - u * u) * (LAST_SENT - FIRST_SENT));
  const delivered = sent + int(1, 4) * DAY;
  const aor = sent + (urgent ? int(10, 30) : int(60, 120)) * DAY;
  const inProcess = aor + int(0, 3) * DAY;
  const testInvite = aor + int(4, 25) * DAY;
  // Most take the test within a week or two; a few wait out the window.
  const test = testInvite + (chance(0.85) ? int(1, 14) : int(20, 45)) * DAY;
  const backgroundCheck = aor + int(2, 60) * DAY;

  let toDecision = int(40, 90) + (family ? int(5, 25) : 0);
  if (interview) toDecision += int(60, 150);
  if (fingerprint) toDecision += int(30, 90);
  if (stalled) toDecision += int(365, 600);
  if (urgent) toDecision = int(10, 30);
  const decision = test + toDecision * DAY;
  const oathLetter = decision + int(3, 20) * DAY;
  const oathCeremony = oathLetter + int(10, 35) * DAY;
  const certificate = oathCeremony;

  const reached = (ms) => (ms <= TODAY ? ms : null);
  const at = {
    sent,
    delivered: reached(delivered),
    aor: reached(aor),
    inProcess: reached(inProcess),
    testInvite: reached(testInvite),
    test: reached(test),
    backgroundCheck: reached(backgroundCheck),
    decision: reached(decision),
    oathLetter: reached(oathLetter),
    oathCeremony: reached(oathCeremony),
  };

  const status = at.oathCeremony
    ? 'Oath completed'
    : at.oathLetter
    ? 'Oath Letter received'
    : at.decision
    ? 'Decision Made'
    : at.test
    ? 'Test Completed'
    : at.testInvite
    ? 'Test letter received'
    : at.inProcess
    ? 'In-process'
    : at.aor
    ? 'AOR'
    : at.delivered
    ? 'Delivered'
    : 'Sent';

  const caseId = `case-${910000 + i}`;
  const rec = {
    username: [`${pick(ADJ)}_${pick(NOUN)}${int(10, 99)}`, caseId],
    _slugs: caseId,
    state: 'Active',
    sign_title: 'Sample data — not real applicants',
    c_at: trackerDate(sent),
    comments_count: `${int(0, 3)} comments`,
  };
  const set = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    rec[idOf[label]] = value;
  };
  const setDate = (label, ms, filledRate = 1) => {
    if (ms && chance(filledRate)) set(label, trackerDate(ms));
  };
  const days = (a, b) => (a && b ? Math.round((b - a) / DAY) : null);

  set('Current status', status);
  set('Online/Paper Application', chance(0.97) ? 'Online' : 'Paper');
  set("Applicant's Province", provinceKey);
  set("Applicant's City", pick(CITIES[provinceKey]));
  set('Application type', family ? 'Family' : 'Single');
  set('Physical Presence', int(1095, 1500));
  if (chance(0.88)) set('Nationality', weighted(NATIONALITY));
  set('Application Sent Date', trackerDate(sent));
  if (chance(0.35)) set('Urgent Processing granted', urgent ? 'Yes' : 'No');
  if (chance(0.45)) set('Primary VO', pick(OFFICES[provinceKey]));

  setDate('AOR Date', at.aor, 0.95);
  setDate('In-Process (ECAS) date', at.inProcess, 0.35);
  setDate('Test Invite letter received date', at.testInvite, 0.9);
  if (at.testInvite) set('Testing Team Number', pick(['Team 1', 'Team 2', 'Team 3']));
  setDate('Test date', at.test, 0.85);
  setDate('Background Check Completed', at.backgroundCheck, 0.6);

  if (interview && at.test) {
    set('Interview Scheduled?', 'Yes');
    setDate('Interview Scheduling Date', reached(at.test + int(20, 60) * DAY));
  } else if (chance(0.15)) {
    set('Interview Scheduled?', 'No');
  }
  if (fingerprint && at.aor) {
    set('Fingerprint Request Received?', 'Yes');
    setDate('Fingerprint Request Date', reached(at.aor + int(10, 40) * DAY), 0.7);
  } else if (chance(0.2)) {
    set('Fingerprint Request Received?', 'No');
  }

  // Few applicants record the decision date itself; most next report the oath
  // letter, and many stop updating after that.
  setDate('Decision Made (ECAS) date', at.decision, 0.12);
  setDate('Oath Letter date', at.oathLetter, 0.8);
  setDate('Oath Ceremony Completion date', at.oathCeremony, 0.5);
  if (at.oathCeremony && chance(0.2)) set('Citizenship Certificate Received', trackerDate(certificate));

  // The tracker's precomputed spans, only where it would have both ends.
  const has = (label) => rec[idOf[label]] !== undefined;
  const span = (fromLabel, fromMs, toLabel, toMs) =>
    has(fromLabel) && has(toLabel) ? days(fromMs, toMs) : null;
  set('Days from Sent to AOR', span('Application Sent Date', sent, 'AOR Date', aor));
  set('Days from Submission to Test Invite', span('Application Sent Date', sent, 'Test Invite letter received date', testInvite));
  set('Days from Test invite to Test', span('Test Invite letter received date', testInvite, 'Test date', test));
  set('Days from AOR to Background Check', span('AOR Date', aor, 'Background Check Completed', backgroundCheck));
  set('Days from Test to Decision Made', span('Test date', test, 'Decision Made (ECAS) date', decision));
  set('Days from DM to Oath Letter', span('Decision Made (ECAS) date', decision, 'Oath Letter date', oathLetter));
  set('Days from Submission to Oath Letter', span('Application Sent Date', sent, 'Oath Letter date', oathLetter));
  set('Days from AOR to Oath Letter', span('AOR Date', aor, 'Oath Letter date', oathLetter));
  set('Days from Test to Oath Letter', span('Test date', test, 'Oath Letter date', oathLetter));
  set('Days from Oath Letter to Oath Ceremony', span('Oath Letter date', oathLetter, 'Oath Ceremony Completion date', oathCeremony));

  return rec;
}

const records = Array.from({ length: COUNT }, (_, i) => buildCase(i));
fs.writeFileSync(OUT, JSON.stringify(records));
console.log(`Wrote ${records.length} synthetic citizenship cases to ${path.relative(process.cwd(), OUT)}`);
