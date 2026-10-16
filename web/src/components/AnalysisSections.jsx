import { useState } from 'react';
import { parseRichText, sectionTagLabel } from '@shared/text.js';

const Runs = ({ runs }) =>
  runs.map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>));

/**
 * Renders a section body as real paragraphs, lists and emphasis.
 *
 * The model writes markdown regardless of the prompt — a repeated heading, `-`
 * bullets, `**bold**` — and printing that raw put the markers on screen. The
 * same parser drives the export, so the two cannot format differently. React
 * escapes text nodes by construction, so nothing the model wrote can execute.
 */
function RichText({ children, title }) {
  const blocks = parseRichText(children, { title });
  return blocks.map((b, i) =>
    b.type === 'ul' ? (
      <ul key={i} className="an-list">
        {b.items.map((it, j) => (
          <li key={j}>
            <Runs runs={it} />
          </li>
        ))}
      </ul>
    ) : (
      <p key={i}>
        <Runs runs={b.runs} />
      </p>
    )
  );
}

/**
 * One analysis section with its Edit / Exclude controls.
 *
 * Both are held as `overrides` in the parent and posted with the download
 * request, so the HTML and PDF always match what is on screen. Used for the
 * Analysis block and, with `inline`, for the notes that sit under a chart.
 */
export function SectionCard({ section: s, overrides, onChange, inline = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const hidden = new Set(overrides.hidden || []);
  const text = overrides.text || {};
  const isHidden = hidden.has(s.id);
  const replaced = text[s.id];
  const body = replaced || s.body;

  const setHidden = (isNowHidden) => {
    const next = new Set(hidden);
    isNowHidden ? next.add(s.id) : next.delete(s.id);
    onChange({ ...overrides, hidden: [...next] });
  };

  const saveText = () => {
    const next = { ...text };
    if (draft.trim()) next[s.id] = draft.trim();
    else delete next[s.id];
    onChange({ ...overrides, text: next });
    setEditing(false);
  };

  const restore = () => {
    const next = { ...text };
    delete next[s.id];
    onChange({ ...overrides, text: next });
  };

  return (
    <div className={`an-card${inline ? ' inline' : ''}${isHidden ? ' is-hidden' : ''}`}>
      <div className="an-head">
        <h4>
          {s.title}
          {/* Provenance: which sentences a model wrote vs. which were computed. */}
          <span className="badge">{sectionTagLabel(replaced ? 'edited' : s.source)}</span>
        </h4>
        <div className="an-actions">
          {editing ? null : (
            <>
              <button
                className="link-btn"
                onClick={() => {
                  setEditing(true);
                  setDraft(replaced || s.body || '');
                }}
              >
                Edit
              </button>
              {replaced ? (
                <button className="link-btn" onClick={restore}>
                  Restore
                </button>
              ) : null}
              <button className="link-btn" onClick={() => setHidden(!isHidden)}>
                {isHidden ? 'Undo Exclude' : 'Exclude'}
              </button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="an-edit">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            aria-label={`Edit text for ${s.title}`}
          />
          <div className="an-actions">
            <button className="link-btn" onClick={saveText}>
              Save
            </button>
            <button className="link-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : isHidden ? (
        <p className="an-muted">Excluded — will not appear in the report or downloads.</p>
      ) : (
        <RichText title={s.title}>{body}</RichText>
      )}
    </div>
  );
}

/**
 * What the fact check did, for the person preparing the report. Shown on
 * screen only — it is about the process, not the data, so it stays out of the
 * export.
 */
function FactCheckSummary({ qa }) {
  if (!qa) return null;
  const removed = qa.removed || [];
  return (
    <details className="qa-summary">
      <summary>
        Fact check: {qa.kept} of {qa.checked} AI passages passed
        {removed.length ? `, ${removed.length} removed` : ''}
        {qa.reviewer ? ` · reviewed by ${qa.reviewer}` : ''}
      </summary>
      {removed.length ? (
        <ul>
          {removed.map((r) => (
            <li key={r.id}>
              <strong>{r.label}</strong> — {r.reason}
              {r.text ? <span className="qa-text">“{r.text}”</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>Every passage was supported by the data.</p>
      )}
    </details>
  );
}

/**
 * The written analysis block. Sections tagged `computed` are filled from the
 * data rather than generated, so they are present even when the language
 * model is unavailable. Chart notes are rendered under their charts instead.
 */
export default function AnalysisSections({ sections, overrides, onChange, qa }) {
  const own = (sections || []).filter((s) => !s.chart);
  if (!own.length && !qa) return null;

  return (
    <section className="analysis-block">
      <h2 className="section-title">Analysis</h2>
      <FactCheckSummary qa={qa} />
      {own.map((s) => (
        <SectionCard key={s.id} section={s} overrides={overrides} onChange={onChange} />
      ))}
    </section>
  );
}
