import { useRef, useState } from 'react';
import { uploadDataset, deleteDataset, clearDatasets } from '../api.js';
import { fmt } from './primitives.jsx';

/**
 * Upload + dataset picker.
 *
 * Two variants share one implementation so the upload path is identical in
 * both places:
 *   "hero" — the empty state, when nothing has been uploaded yet
 *   "bar"  — the compact control that lives in the filter row
 */
export default function DatasetControl({
  datasets = [],
  current,
  onSelect,
  onChanged,
  variant = 'bar',
  // Demo deployments are read-only: the server rejects uploads and deletion, so
  // showing those controls would only produce 403s.
  readOnly = false,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const active = datasets.find((d) => d.id === current);

  async function send(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Only .json exports are supported.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ds = await uploadDataset(file);
      await onChanged();
      onSelect(ds.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const remaining = await deleteDataset(active.id);
      await onChanged();
      onSelect(remaining[0]?.id || '');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    setBusy(true);
    setError(null);
    try {
      await clearDatasets();
      await onChanged();
      onSelect('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  }

  const dropHandlers = {
    onDragOver: (e) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragging(false);
      send(e.dataTransfer.files?.[0]);
    },
    onClick: () => !busy && inputRef.current?.click(),
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && !busy && inputRef.current?.click(),
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".json,application/json"
      hidden
      onChange={(e) => send(e.target.files?.[0])}
    />
  );

  const unrecognised = active?.coverage && active.coverage.matchedFields === 0;

  /* ---------------- hero: nothing uploaded yet ---------------- */

  if (variant === 'hero') {
    return (
      <div className="hero">
        <div className={`dropzone hero-drop${dragging ? ' dragging' : ''}`} {...dropHandlers}>
          <div className="hero-icon" aria-hidden="true">
            ⇪
          </div>
          <div className="hero-title">
            {busy ? 'Processing…' : 'Drop an Immitracker export here'}
          </div>
          <div className="hero-sub">
            or click to choose a <code>.json</code> file
          </div>
        </div>
        <p className="hero-note">
          A JSON array of case objects — an object wrapping a <code>data</code> or{' '}
          <code>records</code> array works too. 32 Immitracker field ids are recognised and
          relabelled; everything else passes through untouched. Nothing is loaded until you upload.
        </p>
        {error ? <p className="dataset-msg error">{error}</p> : null}
        {fileInput}
      </div>
    );
  }

  /* ---------------- bar: filter-row control ---------------- */

  return (
    <div className="dataset-control">
      <div className="field">
        <label htmlFor="dataset">Dataset</label>
        <div className="dataset-row">
          <select
            id="dataset"
            value={current || ''}
            onChange={(e) => onSelect(e.target.value)}
            disabled={busy}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.sourceCount ? ` — ${fmt(d.sourceCount)} rows` : ''}
              </option>
            ))}
          </select>

          {readOnly ? (
            <span className="hint" style={{ margin: 0 }}>
              Sample data — this demo is read-only
            </span>
          ) : (
            <div className={`dropzone${dragging ? ' dragging' : ''}`} {...dropHandlers}>
              {busy ? 'Processing…' : 'Upload .json — drop or click'}
            </div>
          )}

          {active && !readOnly && !active.protected ? (
            <button className="link-btn" onClick={remove} disabled={busy} title="Remove this dataset">
              Remove
            </button>
          ) : null}

          {!readOnly && (datasets.length > 1 || confirmClear) ? (
            confirmClear ? (
              <span className="confirm">
                Remove all {datasets.length}?
                <button className="link-btn danger" onClick={clearAll} disabled={busy}>
                  Yes, clear
                </button>
                <button className="link-btn" onClick={() => setConfirmClear(false)} disabled={busy}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className="link-btn"
                onClick={() => setConfirmClear(true)}
                disabled={busy}
                title="Remove every uploaded dataset"
              >
                Clear all
              </button>
            )
          ) : null}
        </div>

        {readOnly ? null : fileInput}
      </div>

      {error ? <p className="dataset-msg error">{error}</p> : null}
      {unrecognised ? (
        <p className="dataset-msg warn">
          None of the 32 known Immitracker field ids were found in this file, so the charts will be
          empty. It parsed as JSON, but it does not look like a case export.
        </p>
      ) : null}
    </div>
  );
}
