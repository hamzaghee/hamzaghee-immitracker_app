/**
 * Progress page.
 *
 * The AI step can run for minutes, so each pipeline stage reports its own
 * state. `skipped` is a first-class outcome, not a failure — the report still
 * generates when the local model is unavailable.
 */

const ICONS = {
  pending: '○',
  running: '◐',
  done: '●',
  skipped: '◑',
  failed: '✕',
};

export default function ProgressView({ status, config, onCancel }) {
  const steps = status?.steps || [];
  const failed = status?.status === 'failed';

  return (
    <div className="progress">
      <h2 className="config-title">{failed ? 'Report failed' : 'Building your report'}</h2>
      <p className="hint">
        {[config?.programLabel, config?.streamLabel].filter(Boolean).join(' · ')}
      </p>

      <ol className="steps">
        {steps.map((s) => (
          <li key={s.id} className={`step ${s.state}`}>
            <span className="step-icon" aria-hidden="true">
              {ICONS[s.state] || '○'}
            </span>
            <span className="step-body">
              <span className="step-label">{s.label}</span>
              {s.detail ? <span className="step-detail">{s.detail}</span> : null}
            </span>
            <span className="step-state">{s.state === 'done' ? '' : s.state}</span>
          </li>
        ))}
      </ol>

      {failed ? (
        <>
          <p className="dataset-msg error">{status.error}</p>
          <div className="config-actions">
            <button className="primary" onClick={onCancel}>
              Back to configuration
            </button>
          </div>
        </>
      ) : (
        <p className="hint">
          The written analysis runs on a local model and can take a few minutes. Charts and figures
          are already computed.
        </p>
      )}
    </div>
  );
}
