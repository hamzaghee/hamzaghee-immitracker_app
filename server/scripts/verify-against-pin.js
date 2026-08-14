/**
 * Validates the Node port against the n8n workflow's own pinned output.
 *
 * The workflow JSON carries pinData for the "Filter 18 months" node — a real
 * captured run. This script re-runs the ported pipeline over the same source
 * file and diffs the result, so "it replicates the workflow" is a checked
 * claim rather than an assertion.
 *
 * THE CLOCK IS PINNED. "Filter 18 months" is a *rolling* window measured from
 * now, while pinData is a frozen snapshot. Left to the system clock the two
 * drift apart by one case per boundary crossing and the check fails for a
 * reason that has nothing to do with the code. So the filter runs against a
 * fixed reference instant instead.
 *
 * PIN_REFERENCE_DATE was derived empirically: sweeping `now` hourly, the pin is
 * reproduced exactly (1,061 records, identical case set) for any value in
 * 2026-08-10T00:00Z … 2026-08-11T23:00Z. The midpoint below sits well inside
 * that band. The first case outside it is case-122105 (Submitted 2025-02-12).
 *
 * A failure here is now a real regression in the port, not a calendar artifact.
 *
 * Note: this script needs a local copy of the source export. The server itself
 * no longer auto-loads one — it is upload-only — so DATA_PATH exists purely for
 * this offline check. Override it if your export lives elsewhere.
 *
 * Usage: npm run verify
 */

/** Fixed clock for the rolling-window filter. See header. */
const PIN_REFERENCE_DATE = new Date('2026-08-11T00:00:00.000Z');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relabelRows } from '../src/pipeline/relabel.js';
import { filterByWindow } from '../src/pipeline/filter.js';
import { analyze } from '../src/pipeline/analyze.js';
import { DATA_PATH } from '../src/dataStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function findWorkflow() {
  if (process.env.WORKFLOW_PATH) return process.env.WORKFLOW_PATH;
  const match = fs
    .readdirSync(projectRoot)
    .filter((f) => f.toLowerCase().includes('immitracker') && f.endsWith('.json'))
    .filter((f) => !f.includes('consolidated_eapr'));
  if (!match.length) return null;
  return path.join(projectRoot, match[0]);
}

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const wfPath = findWorkflow();
if (!wfPath) {
  console.error('No workflow JSON found. Set WORKFLOW_PATH to the n8n export.');
  process.exit(1);
}

if (!fs.existsSync(DATA_PATH)) {
  console.error(`Source export not found at ${DATA_PATH}`);
  console.error('This offline check needs a local copy. Set DATA_PATH to point at one.');
  process.exit(1);
}

console.log(`workflow: ${path.basename(wfPath)}`);
console.log(`dataset:  ${path.basename(DATA_PATH)}`);
console.log(`clock:    ${PIN_REFERENCE_DATE.toISOString()} (pinned, not system time)\n`);

const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const pinned = wf.pinData?.['Filter 18 months']?.[0]?.json?.allCases;

if (!pinned) {
  console.error('This workflow export has no pinData on "Filter 18 months" — nothing to verify against.');
  process.exit(1);
}

// --- Re-run the port over the same source ------------------------------------
const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const relabeled = relabelRows(raw);
// Pinned clock — without this the rolling window drifts away from the snapshot.
const filtered = filterByWindow(relabeled, { now: PIN_REFERENCE_DATE });

console.log('Stage 1+2 — Relabel Rows → Filter 18 months');
check('filtered record count matches pinData', filtered.length === pinned.length,
  `port ${filtered.length} vs n8n ${pinned.length}`);

// Identity check by _slugs (stable per-case id).
const slugs = (arr) => new Set(arr.map((r) => r['_slugs']).filter(Boolean));
const mine = slugs(filtered);
const theirs = slugs(pinned);
const missing = [...theirs].filter((s) => !mine.has(s));
const extra = [...mine].filter((s) => !theirs.has(s));
check('same case set (by _slugs)', missing.length === 0 && extra.length === 0,
  `${missing.length} missing, ${extra.length} extra`);

// Field-level equality on a shared sample.
const byslug = new Map(filtered.map((r) => [r['_slugs'], r]));
let fieldDiffs = 0;
const diffExamples = [];
for (const p of pinned) {
  const m = byslug.get(p['_slugs']);
  if (!m) continue;
  for (const k of Object.keys(p)) {
    if (String(p[k]) !== String(m[k])) {
      fieldDiffs++;
      if (diffExamples.length < 5) diffExamples.push(`${p['_slugs']}.${k}: n8n=${JSON.stringify(p[k])} port=${JSON.stringify(m[k])}`);
    }
  }
}
check('all relabeled field values identical', fieldDiffs === 0, `${fieldDiffs} differing values`);
diffExamples.forEach((d) => console.log(`          ${d}`));

// --- Stage 3 on the pinned records -------------------------------------------
// Running analyze() over n8n's own rows isolates the aggregation port from the
// filter port: any mismatch here is purely an analysis bug.
console.log('\nStage 3 — Analysis - Code (run over n8n\'s pinned rows)');
const fromPinned = analyze(pinned);
const fromPort = analyze(filtered);

const compare = (label, a, b) =>
  check(label, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b) ? '' : `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

compare('totalRecordsAnalyzed', fromPinned.totalRecordsAnalyzed, fromPort.totalRecordsAnalyzed);
compare('statusBreakdown', fromPinned.statusBreakdown, fromPort.statusBreakdown);
compare('streamDistribution', fromPinned.streamDistribution, fromPort.streamDistribution);
compare('topCountriesOfResidence', fromPinned.topCountriesOfResidence, fromPort.topCountriesOfResidence);
compare('daysSubmissionToPPR', fromPinned.daysSubmissionToPPR, fromPort.daysSubmissionToPPR);
compare('daysAorToPPR', fromPinned.daysAorToPPR, fromPort.daysAorToPPR);
compare('daysAorToMeds', fromPinned.daysAorToMeds, fromPort.daysAorToMeds);
compare('daysAorToBil', fromPinned.daysAorToBil, fromPort.daysAorToBil);
compare('daysMedsToPPR', fromPinned.daysMedsToPPR, fromPort.daysMedsToPPR);
compare('streamVsSubmissionToPPR', fromPinned.streamVsSubmissionToPPR, fromPort.streamVsSubmissionToPPR);
compare('monthlySubmissions', fromPinned.monthlySubmissions, fromPort.monthlySubmissions);
compare('slowestCases', fromPinned.slowestCases, fromPort.slowestCases);
compare('quickestCases', fromPinned.quickestCases, fromPort.quickestCases);

// --- Live-clock drift (informational, never a failure) -----------------------
// The running app uses the real clock, so its numbers legitimately diverge from
// the snapshot as the window rolls. Report the gap rather than hide it.
const live = filterByWindow(relabeled);
const drift = pinned.length - live.length;
console.log('\nLive-clock window (what the running app shows today)');
console.log(`  pinned ${pinned.length} vs live ${live.length}` + (drift ? `  — ${Math.abs(drift)} case(s) ${drift > 0 ? 'aged out' : 'added'} since the snapshot` : '  — identical'));
if (drift > 0) {
  const liveSlugs = new Set(live.map((r) => r['_slugs']));
  const aged = pinned.filter((r) => !liveSlugs.has(r['_slugs'])).slice(0, 3);
  aged.forEach((r) => console.log(`    ${r['_slugs']}  Submitted ${String(r['Submitted']).slice(0, 10)}  ${r['Stream']} / ${r['Current Status']}`));
}

// --- UTC vs local month bucketing --------------------------------------------
// Documented deviation: analyze() buckets months in UTC. Show what local-time
// bucketing (the literal n8n code, run in this machine's timezone) would give.
const localBuckets = {};
for (const r of pinned) {
  const d = new Date(String(r['Submitted']).replace(/\s+/g, ' ').trim());
  if (isNaN(d.getTime())) continue;
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  localBuckets[k] = (localBuckets[k] || 0) + 1;
}
const utcKeys = Object.keys(fromPinned.monthlySubmissions);
const localKeys = Object.keys(localBuckets).sort();
const sameBuckets = JSON.stringify(fromPinned.monthlySubmissions) === JSON.stringify(
  localKeys.reduce((a, k) => { a[k] = localBuckets[k]; return a; }, {})
);
console.log(`\nMonth bucketing — timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`  UTC   (used): ${utcKeys.length} buckets, ${utcKeys[0]} … ${utcKeys[utcKeys.length - 1]}`);
console.log(`  local (n8n literal): ${localKeys.length} buckets, ${localKeys[0]} … ${localKeys[localKeys.length - 1]}`);
console.log(`  ${sameBuckets ? 'identical in this timezone' : 'DIFFER in this timezone — UTC is used, see analyze.js header'}`);

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
