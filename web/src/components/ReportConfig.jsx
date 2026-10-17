import { useEffect, useState } from 'react';
import DatasetControl from './DatasetControl.jsx';
import { fmt } from './primitives.jsx';

/** ISO yyyy-mm-dd, `monthsAgo` months before today. */
function isoMonthsAgo(monthsAgo) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

/** "an Express Entry", "a Citizenship" */
const withArticle = (label) => `${/^[aeiou]/i.test(label || '') ? 'an' : 'a'} ${label}`;

/** Quick period presets. 18 months matches the original n8n window. */
const PRESETS = [
  { months: 3, label: '3m' },
  { months: 6, label: '6m' },
  { months: 12, label: '12m' },
  { months: 18, label: '18m' },
];

/** The date each report type's period filters on. */
const PERIOD_FIELD = {
  'express-entry': 'Submitted',
  citizenship: 'Application Sent',
};

/**
 * Report Configuration — the app's entry screen.
 *
 * Report type drives what else appears: Express Entry filters by stream,
 * Citizenship by application type and province. The period filters on the
 * Submitted date for Express Entry and the Application Sent date for
 * Citizenship.
 *
 * Each dataset comes from one tracker, and a report type only runs on its own
 * tracker's export. So choosing a report type picks a matching dataset, and a
 * new or newly selected dataset switches the report type to match it.
 */
export default function ReportConfig({
  options,
  datasets,
  dataset,
  onSelectDataset,
  onDatasetsChanged,
  onSubmit,
  busy,
  error,
  readOnly = false,
}) {
  const [reportType, setReportType] = useState('express-entry');
  const [stream, setStream] = useState('all');
  const [applicationType, setApplicationType] = useState('all');
  const [province, setProvince] = useState('all');
  const [from, setFrom] = useState(() => isoMonthsAgo(18));
  const [to, setTo] = useState(() => today());

  /**
   * Which preset the current range corresponds to, derived rather than stored
   * so editing a date manually falls back to Custom on its own.
   */
  const activePreset =
    to === today() ? PRESETS.find((p) => from === isoMonthsAgo(p.months))?.months ?? null : null;

  const applyPreset = (m) => {
    setFrom(isoMonthsAgo(m));
    setTo(today());
  };

  const types = options?.reportTypes || [];
  const streams = options?.streams || [];
  const selectedType = types.find((t) => t.value === reportType);
  const isExpressEntry = reportType === 'express-entry';
  const isCitizenship = reportType === 'citizenship';
  const available = selectedType?.available !== false;
  const activeDataset = datasets.find((d) => d.id === dataset);
  const hasDataset = Boolean(dataset);
  // Datasets from before tracker detection report no tracker; all were Express Entry.
  const trackerOf = (d) => d?.tracker || 'express-entry';
  const mismatch = Boolean(activeDataset && selectedType?.tracker && trackerOf(activeDataset) !== selectedType.tracker);
  const periodValid = !from || !to || from <= to;
  const canSubmit = available && hasDataset && !mismatch && periodValid && !busy;

  // Filters only apply to their own report type; reset them when switching
  // away so a stale selection can't leak into another report.
  useEffect(() => {
    if (!isExpressEntry) setStream('all');
    if (!isCitizenship) {
      setApplicationType('all');
      setProvince('all');
    }
  }, [isExpressEntry, isCitizenship]);

  // A dataset chosen or uploaded switches the report type to the one it can
  // produce. Keyed on the dataset only, so picking a type with no matching
  // dataset leaves that choice alone and shows the mismatch message instead.
  useEffect(() => {
    if (!activeDataset) return;
    const match = types.find((t) => t.available && t.tracker === trackerOf(activeDataset));
    if (match) setReportType(match.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, activeDataset?.tracker, types.length]);

  /** Choosing a report type also picks a dataset it can run on, if there is one. */
  function chooseType(value) {
    setReportType(value);
    const want = types.find((t) => t.value === value)?.tracker;
    if (want && activeDataset && trackerOf(activeDataset) !== want) {
      const match = datasets.find((d) => trackerOf(d) === want);
      if (match) onSelectDataset(match.id);
    }
  }

  const typeLabel = (tracker) => types.find((t) => t.tracker === tracker)?.label || tracker;

  return (
    <div className="config">
      <h2 className="config-title">Report Configuration</h2>

      <div className="config-grid">
        <div className="field">
          <label htmlFor="reportType">Report type</label>
          <select
            id="reportType"
            value={reportType}
            onChange={(e) => chooseType(e.target.value)}
            disabled={busy}
          >
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
                {t.available ? '' : ' — coming soon'}
              </option>
            ))}
          </select>
        </div>

        {isExpressEntry ? (
          <div className="field">
            <label htmlFor="stream">Stream</label>
            <select id="stream" value={stream} onChange={(e) => setStream(e.target.value)} disabled={busy}>
              {streams.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {isCitizenship ? (
          <>
            <div className="field">
              <label htmlFor="applicationType">Application type</label>
              <select
                id="applicationType"
                value={applicationType}
                onChange={(e) => setApplicationType(e.target.value)}
                disabled={busy}
              >
                {(options?.applicationTypes || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="province">Province</label>
              <select id="province" value={province} onChange={(e) => setProvince(e.target.value)} disabled={busy}>
                {(options?.provinces || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
      </div>

      {available ? (
        <>
          <fieldset className="period">
            <legend>Time period</legend>
            <p className="hint">
              Filters on the case&rsquo;s <em>{PERIOD_FIELD[reportType] || 'Submitted'}</em> date.
            </p>

            <div className="presets" role="group" aria-label="Quick period">
              {PRESETS.map((p) => (
                <button
                  key={p.months}
                  type="button"
                  className="preset"
                  aria-pressed={activePreset === p.months}
                  disabled={busy}
                  onClick={() => applyPreset(p.months)}
                >
                  {p.label}
                </button>
              ))}
              <span className="preset-state">
                {activePreset ? `Last ${activePreset} months` : 'Custom range'}
              </span>
            </div>

            <div className="config-grid">
              <div className="field">
                <label htmlFor="from">From</label>
                <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="to">To</label>
                <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
              </div>
            </div>
            {!periodValid ? <p className="dataset-msg error">Start date is after the end date.</p> : null}
          </fieldset>

          <fieldset className="period">
            <legend>Data</legend>
            <DatasetControl
              // The hero (drop-a-file) variant only makes sense when the user
              // can actually upload; a read-only demo always has its sample.
              variant={datasets.length || readOnly ? 'bar' : 'hero'}
              datasets={datasets}
              current={dataset}
              onSelect={onSelectDataset}
              onChanged={onDatasetsChanged}
              readOnly={readOnly}
            />
            {mismatch ? (
              <p className="dataset-msg warn">
                This dataset is {typeLabel(trackerOf(activeDataset))} tracker data, so it cannot produce{' '}
                {withArticle(selectedType?.label)} report. Choose {typeLabel(trackerOf(activeDataset))} as the
                report type, or upload {withArticle(selectedType?.label)} tracker export.
              </p>
            ) : null}
          </fieldset>
        </>
      ) : (
        <p className="coming-soon">
          <strong>{selectedType?.label} reports are not available yet.</strong> This build covers
          Express Entry and Citizenship.
        </p>
      )}

      {error ? <p className="dataset-msg error">{error}</p> : null}

      <div className="config-actions">
        <button
          className="primary"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              reportType,
              ...(isCitizenship ? { applicationType, province } : { stream }),
              from: from || undefined,
              to: to || undefined,
              datasetId: dataset,
            })
          }
        >
          {busy ? 'Starting…' : 'Next'}
        </button>
        {available && !hasDataset ? (
          <span className="hint">Upload an export to continue.</span>
        ) : null}
        {available && activeDataset?.sourceCount ? (
          <span className="hint">
            {fmt(activeDataset.sourceCount)} cases in {activeDataset.name}
          </span>
        ) : null}
      </div>
    </div>
  );
}
