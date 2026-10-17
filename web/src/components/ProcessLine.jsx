import { processStages, PROCESS_NOTE } from '@shared/reportData.js';
import { fmt } from './primitives.jsx';

const Stage = ({ stage, as: Tag = 'li', className = 'stage' }) => (
  <Tag className={`${className} tone-${stage.tone}`}>
    <span className="stage-track">
      <span className="stage-dot" style={{ width: stage.size, height: stage.size }} />
    </span>
    <span className="stage-count">{fmt(stage.count)}</span>
    <span className="stage-label">{stage.label}</span>
    <span className="stage-pct">{stage.pct}%</span>
  </Tag>
);

/**
 * The whole process as one line, with how many cases sit at each stage now.
 *
 * Marker area scales with the count so the bottlenecks read at a glance; the
 * number underneath carries the exact value. The export draws the same thing
 * from the same `processStages()` data.
 *
 * Express Entry by default; Citizenship passes its own `data` (no Refused
 * marker) and `note`.
 */
export default function ProcessLine({ summary, insight, data, note = PROCESS_NOTE }) {
  const { stages, refused, other } = data || processStages(summary);
  if (!stages.length) return null;

  return (
    <section className="card process-card" aria-label="Applications by stage">
      <h3 className="card-title">Where applications are now</h3>
      <div className="process">
        <ol className="process-line">
          {stages.map((st) => (
            <Stage key={st.status} stage={st} />
          ))}
        </ol>
        {refused ? <Stage stage={refused} as="div" className="stage process-aside" /> : null}
      </div>
      <p className="card-note">
        {note}
        {other ? ` ${fmt(other)} cases have another or no status and are not shown.` : ''}
      </p>
      {insight}
    </section>
  );
}
