/**
 * Which tracker an uploaded export came from.
 *
 * Express Entry and Citizenship exports share a shape (an array of case
 * objects keyed by opaque field ids) but no field ids, so counting known ids
 * is enough to tell them apart. Only the first rows are inspected: a case has
 * most of its fields blank, so one row can miss, but a few hundred cannot.
 */

import { fieldToLabel as expressEntryFields } from '../fieldMap.js';
import { citizenshipFieldToLabel } from './fieldMap.js';

const SAMPLE_ROWS = 200;

const TRACKERS = {
  'express-entry': new Set(Object.keys(expressEntryFields)),
  citizenship: new Set(Object.keys(citizenshipFieldToLabel)),
};

/**
 * @param {object[]} rawRecords records as uploaded, before relabelling
 * @returns {{ tracker: 'express-entry'|'citizenship'|null, matches: object }}
 *   `tracker` is null when no known field id appears at all. `matches` is the
 *   number of distinct known ids seen per tracker, for the upload warning.
 */
export function detectTracker(rawRecords) {
  const seen = { 'express-entry': new Set(), citizenship: new Set() };
  for (const row of (rawRecords || []).slice(0, SAMPLE_ROWS)) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      for (const [tracker, ids] of Object.entries(TRACKERS)) {
        if (ids.has(key)) seen[tracker].add(key);
      }
    }
  }

  const matches = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size]));
  const [best, count] = Object.entries(matches).sort((a, b) => b[1] - a[1])[0];
  return { tracker: count ? best : null, matches };
}
