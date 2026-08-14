import { fmt } from './primitives.jsx';

/**
 * A single number is a stat tile, not a one-bar bar chart. The n8n dashboard
 * rendered the three milestone means as single-bar charts; each is one value,
 * so it reads better as a tile with its median and sample size alongside.
 */
export default function StatTile({ label, value, unit, foot }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">
        {fmt(value)}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}
