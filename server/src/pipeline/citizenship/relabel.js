/**
 * Relabels a Citizenship tracker export: opaque field ids become the tracker's
 * column headers, MongoDB extended-JSON wrappers become scalars.
 *
 * The same as the Express Entry relabel step (../relabel.js) apart from the
 * dictionary, plus two clean-ups the citizenship charts need: nationality is
 * stored as a two-letter code in some exports and a country name in others,
 * and province names are upper case.
 */

import { toScalar } from '../relabel.js';
import { citizenshipFieldToLabel, F } from './fieldMap.js';
import { countryName } from '../../../../shared/text.js';

const extraLabels = {
  state: 'State',
  updated: 'Last Updated',
  c_at: 'Date Created',
  comments_count: 'Comments',
  watched: 'Watched',
  dashboard: 'Dashboard',
};

/**
 * The tracker's nationality list uses formal names, several of which are too
 * long for a chart axis. Shortened to the names a reader would use.
 */
const SHORT_COUNTRY_NAMES = {
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'United States of America': 'United States',
  'Russian Federation': 'Russia',
  'Viet Nam': 'Vietnam',
  "Lao People's Democratic Republic": 'Laos',
  'Syrian Arab Republic': 'Syria',
  'Tanzania, United Republic of': 'Tanzania',
  'Palestine, State of': 'Palestine',
  'Democratic Republic of the Congo': 'DR Congo',
  'Vatican City / Holy See': 'Vatican City',
};

/** Country code or tracker name -> display name. */
export const nationalityName = (value) => {
  const name = countryName(value);
  return SHORT_COUNTRY_NAMES[name] || name;
};

/** "BRITISH COLUMBIA" -> "British Columbia", "NEWFOUNDLAND and LABRADOR" -> "Newfoundland and Labrador" */
export function provinceName(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w === 'and' ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * @param {object[]} rawData source records
 * @returns {object[]} records keyed by citizenship tracker labels
 */
export function relabelCitizenship(rawData) {
  return rawData.map((r) => {
    const obj = {};

    if (Array.isArray(r.username)) {
      obj['Username'] = r.username[0] || '';
      obj['Case ID'] = r.username[1] || '';
    } else if (r.username !== undefined) {
      obj['Username'] = toScalar(r.username);
      obj['Case ID'] = '';
    }

    for (const key of Object.keys(r)) {
      if (key === 'username') continue;
      const label = citizenshipFieldToLabel[key] || extraLabels[key] || key;
      obj[label] = toScalar(r[key]);
    }

    if (obj[F.nationality]) obj[F.nationality] = nationalityName(obj[F.nationality]);
    if (obj[F.province]) obj[F.province] = provinceName(obj[F.province]);
    return obj;
  });
}
