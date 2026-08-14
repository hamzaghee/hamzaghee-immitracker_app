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
 * The written analysis, with per-section controls.
 *
 * Each section can be hidden or replaced with pasted text. Both are held as
 * `overrides` in the parent and posted with the download request, so the HTML
 * and PDF always match what is on screen.
 *
 * Sections tagged `computed` are filled from the data rather than generated, so
 * they are present even when the local model is unavailable.
 */
export default function AnalysisSections({ sections, overrides, onChange }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  if (!sections?.length) return null;

  const hidden = new Set(overrides.hidden || []);
  const text = overrides.text || {};

  const setHidden = (id, isHidden) => {
    const next = new Set(hidden);
    isHidden ? next.add(id) : next.delete(id);
    onChange({ ...overrides, hidden: [...next] });
  };

  const saveText = (id) => {
    const next = { ...text };
    if (draft.trim()) next[id] = draft.trim();
    else delete next[id];
    onChange({ ...overrides, text: next });
    setEditing(null);
  };

  const restore = (id) => {
    const next = { ...text };
    delete next[id];
    onChange({ ...overrides, text: next });
  };

  return (
    <section className="analysis-block">
      <h2 className="section-title">Analysis</h2>
      {sections.map((s) => {
        const isHidden = hidden.has(s.id);
        const replaced = text[s.id];
        const body = replaced || s.body;

        return (
          <div key={s.id} className={`an-card${isHidden ? ' is-hidden' : ''}`}>
            <div className="an-head">
              <h4>
                {s.title}
                {/* Provenance: which sentences a model wrote vs. which were computed. */}
                {replaced ? (
                  <span className="badge">{sectionTagLabel('edited')}</span>
                ) : (
                  <span className="badge">{sectionTagLabel(s.source)}</span>
                )}
              </h4>
              <div className="an-actions">
                {editing === s.id ? null : (
                  <>
                    <button
                      className="link-btn"
                      onClick={() => {
                        setEditing(s.id);
                        setDraft(replaced || s.body || '');
                      }}
                    >
                      Replace
                    </button>
                    {replaced ? (
                      <button className="link-btn" onClick={() => restore(s.id)}>
                        Restore
                      </button>
                    ) : null}
                    <button className="link-btn" onClick={() => setHidden(s.id, !isHidden)}>
                      {isHidden ? 'Show' : 'Hide'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {editing === s.id ? (
              <div className="an-edit">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={5}
                  aria-label={`Replacement text for ${s.title}`}
                />
                <div className="an-actions">
                  <button className="link-btn" onClick={() => saveText(s.id)}>
                    Save
                  </button>
                  <button className="link-btn" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : isHidden ? (
              <p className="an-muted">Hidden — will not appear in the report or downloads.</p>
            ) : (
              <RichText title={s.title}>{body}</RichText>
            )}
          </div>
        );
      })}
    </section>
  );
}
