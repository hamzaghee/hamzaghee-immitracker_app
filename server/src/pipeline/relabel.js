/**
 * Stage 1 — "Relabel Rows" (n8n code node).
 *
 * Flattens MongoDB extended-JSON wrappers ($date / $oid) to scalars and renames
 * opaque field ids to human labels. Behaviour is a 1:1 port of the n8n node.
 */

import { fieldToLabel, extraLabels } from './fieldMap.js';

/** Collapse a MongoDB extended-JSON value to a plain scalar. */
export function toScalar(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.$date !== undefined) return new Date(v.$date).toISOString();
    if (v.$oid !== undefined) return v.$oid;
    return JSON.stringify(v);
  }
  return v;
}

/**
 * @param {object[]} rawData source records
 * @returns {object[]} records keyed by human-readable labels
 */
export function relabelRows(rawData) {
  return rawData.map((r) => {
    const obj = {};

    // n8n split an array-form username into [Username, Case ID]. The current
    // dataset stores a plain string, so Case ID comes through empty — both
    // shapes are handled to stay faithful to the original node.
    if (Array.isArray(r.username)) {
      obj['Username'] = r.username[0] || '';
      obj['Case ID'] = r.username[1] || '';
    } else if (r.username !== undefined) {
      obj['Username'] = toScalar(r.username);
      obj['Case ID'] = '';
    }

    for (const key of Object.keys(r)) {
      if (key === 'username') continue;

      if (fieldToLabel[key]) {
        obj[fieldToLabel[key]] = toScalar(r[key]);
      } else if (extraLabels[key]) {
        obj[extraLabels[key]] = toScalar(r[key]);
      } else {
        obj[key] = toScalar(r[key]);
      }
    }
    return obj;
  });
}
