/**
 * Report Configuration filters for Citizenship.
 *
 * Citizenship has no streams, so the setup page filters by application type
 * and by province instead. Both match on values as relabel.js leaves them
 * (province already title-cased).
 */

import { F } from './fieldMap.js';
import { provinceName } from './relabel.js';

export const APPLICATION_TYPES = {
  all: { label: 'All application types', value: null },
  single: { label: 'Single', value: 'Single' },
  family: { label: 'Family', value: 'Family' },
};

/** The tracker's own province list, in its order. */
const PROVINCE_VALUES = [
  'ALBERTA', 'BRITISH COLUMBIA', 'MANITOBA', 'NEW BRUNSWICK', 'NEWFOUNDLAND and LABRADOR',
  'NORTHWEST TERRITORIES', 'NOVA SCOTIA', 'NUNAVUT', 'ONTARIO', 'QUEBEC',
  'PRINCE EDWARD ISLAND', 'SASKATCHEWAN', 'YUKON',
].map(provinceName);

export const ALL_PROVINCES = 'all';

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/** [{ value, label }] for the two setup-page dropdowns. */
export const listApplicationTypes = () =>
  Object.entries(APPLICATION_TYPES).map(([value, { label }]) => ({ value, label }));

export const listProvinces = () => [
  { value: ALL_PROVINCES, label: 'All provinces' },
  ...PROVINCE_VALUES.map((p) => ({ value: p, label: p })),
];

/** Validates the two filter values, returning them with display labels. */
export function normaliseCitizenshipFilters({ applicationType = 'all', province = ALL_PROVINCES } = {}) {
  if (!Object.hasOwn(APPLICATION_TYPES, applicationType)) {
    throw badRequest(
      `Unknown application type: ${applicationType}. Expected one of ${Object.keys(APPLICATION_TYPES).join(', ')}.`
    );
  }
  if (province !== ALL_PROVINCES && !PROVINCE_VALUES.includes(province)) {
    throw badRequest(`Unknown province: ${province}.`);
  }
  return {
    applicationType,
    applicationTypeLabel: APPLICATION_TYPES[applicationType].label,
    province,
    provinceLabel: province === ALL_PROVINCES ? 'All provinces' : province,
  };
}

/**
 * @param {object[]} records relabelled citizenship records
 * @param {{ applicationType?: string, province?: string }} filters
 */
export function filterCitizenship(records, filters = {}) {
  const { applicationType, province } = normaliseCitizenshipFilters(filters);
  const type = APPLICATION_TYPES[applicationType].value;
  return records.filter(
    (r) =>
      (!type || r[F.applicationType] === type) &&
      (province === ALL_PROVINCES || r[F.province] === province)
  );
}
