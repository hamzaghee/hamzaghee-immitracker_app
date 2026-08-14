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

/** Quick period presets. 18 months matches the original n8n window. */
const PRESETS = [
  { months: 3, label: '3m' },
  { months: 6, label: '6m' },
  { months: 12, label: '12m' },
  { months: 18, label: '18m' },
];

/**
 * Report Configuration — the app's entry screen.
 *
 * Report type drives what else appears: the Stream field is Express Entry only.
 * The period filters on the Submitted date, matching the report spec.
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
  const available = selectedType?.available !== false;
  const hasDataset = Boolean(dataset);
  const periodValid = !from || !to || from <= to;
  const canSubmit = available && hasDataset && periodValid && !busy;

  // Stream only applies to Express Entry; reset it when switching away so a
  // stale selection can't leak into a future report type.
  useEffect(() => {
    if (!isExpressEntry) setStream('all');
  }, [isExpressEntry]);

  const activeDataset = datasets.find((d) => d.id === dataset);

  return (
    <div className="config">
      <h2 className="config-title">Report Configuration</h2>

      <div className="config-grid">
        <div className="field">
          <label htmlFor="reportType">Report type</label>
          <select
            id="reportType"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
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
      </div>

      {available ? (
        <>
          <fieldset className="period">
            <legend>Time period</legend>
            <p className="hint">Filters on the case&rsquo;s <em>Submitted</em> date.</p>

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
          </fieldset>
        </>
      ) : (
        <p className="coming-soon">
          <strong>{selectedType?.label} reports are not available yet.</strong> This build covers
          Express Entry only — that programme&rsquo;s tracker is the one this export contains.
        </p>
      )}

      {error ? <p className="dataset-msg error">{error}</p> : null}

      <div className="config-actions">
        <button
          className="primary"
          disabled={!canSubmit}
          onClick={() => onSubmit({ reportType, stream, from: from || undefined, to: to || undefined, datasetId: dataset })}
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
