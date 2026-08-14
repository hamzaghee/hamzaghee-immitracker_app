/**
 * Stream groups for the Report Configuration page.
 *
 * The consolidated options are groupings, not values in the data. Both exports
 * contain exactly five discrete Stream values:
 *
 *   FSW-Outland, CEC, PNP-Outland, PNP-Inland, FSW-Inland
 *
 * so "PNP (Consolidated)" and "FSW (Consolidated)" have to be constructed from
 * their two variants. CEC has no Inland/Outland split.
 *
 * The group decides which rows enter the analysis; it does not collapse the
 * charts. `streamDistribution` still breaks out the underlying values, so a PNP
 * report shows PNP-Inland and PNP-Outland separately.
 */

export const STREAM_FIELD = 'Stream';

/** key -> { label, values }. `values: null` means "no filter". */
export const STREAM_GROUPS = {
  all: { label: 'All Streams', values: null },
  pnp: { label: 'PNP (Consolidated)', values: ['PNP-Inland', 'PNP-Outland'] },
  fsw: { label: 'FSW (Consolidated)', values: ['FSW-Inland', 'FSW-Outland'] },
  cec: { label: 'CEC', values: ['CEC'] },
};

export const DEFAULT_STREAM_GROUP = 'all';

/** Groups that name a real programme — the comparison chart's x-axis. */
export const COMPARISON_GROUPS = ['pnp', 'fsw', 'cec'];

export const isStreamGroup = (key) => Object.hasOwn(STREAM_GROUPS, key);

export const streamGroupLabel = (key) => STREAM_GROUPS[key]?.label ?? key;

/** [{ value, label }] for the config dropdown. */
export const listStreamGroups = () =>
  Object.entries(STREAM_GROUPS).map(([value, { label }]) => ({ value, label }));

/**
 * @param {object[]} records relabeled records
 * @param {string} [group] key from STREAM_GROUPS; defaults to no filtering
 */
export function filterByStream(records, group = DEFAULT_STREAM_GROUP) {
  if (!isStreamGroup(group)) {
    throw Object.assign(
      new Error(
        `Unknown stream: ${group}. Expected one of ${Object.keys(STREAM_GROUPS).join(', ')}.`
      ),
      { status: 400 }
    );
  }
  const { values } = STREAM_GROUPS[group];
  if (!values) return records;

  const allowed = new Set(values);
  return records.filter((r) => allowed.has(r[STREAM_FIELD]));
}
