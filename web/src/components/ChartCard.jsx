import { useState } from 'react';
import { fmt } from './primitives.jsx';

/**
 * Card wrapper providing every chart with a table-view twin. The table is not
 * optional polish: three light-mode series colours sit below 3:1 contrast, and
 * the relief rule requires a WCAG-clean way to read the same values.
 *
 * `insight` is the AI note for this chart, when the analysis found something
 * worth saying about it; most charts have none.
 */
export default function ChartCard({ title, desc, note, columns, rows, legend, insight, children }) {
  const [view, setView] = useState('chart');

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h3 className="card-title">{title}</h3>
          {desc ? <div className="card-desc">{desc}</div> : null}
        </div>
        {rows ? (
          <div className="view-toggle" role="group" aria-label={`${title} view`}>
            <button aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
              Chart
            </button>
            <button aria-pressed={view === 'table'} onClick={() => setView('table')}>
              Table
            </button>
          </div>
        ) : null}
      </header>

      {view === 'chart' ? (
        <>
          {children}
          {legend?.length ? (
            <div className="legend">
              {legend.map((l) => (
                <span className="legend-item" key={l.label}>
                  <span className="legend-swatch" style={{ background: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.num ? 'num' : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key ?? i}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? 'num' : 'name'}>
                      {c.num ? fmt(r[c.key]) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Shown in both views: it qualifies the figures, not the drawing. */}
      {note ? <p className="card-note">{note}</p> : null}
      {insight}
    </section>
  );
}
