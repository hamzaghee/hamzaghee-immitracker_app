import AnalysisSections, { SectionCard } from './AnalysisSections.jsx';
import BarChart from './BarChart.jsx';
import LineChart from './LineChart.jsx';
import DonutChart from './DonutChart.jsx';
import StackedBarChart from './StackedBarChart.jsx';
import ChartCard from './ChartCard.jsx';
import StatTile from './StatTile.jsx';
import ProcessLine from './ProcessLine.jsx';
import { fmt, SERIES } from './primitives.jsx';
import { joinNotes } from '@shared/reportData.js';
import {
  CZ_CHART,
  TILE_STEPS,
  BANDS,
  finishNote,
  czOutlierNote,
  groupNote,
  coverageFor,
  czProcessStages,
  CZ_PROCESS_NOTE,
  shareOf,
  stepRows,
  extraCheckRows,
  extraOmitted,
  stepColumns,
  stepTableRows,
} from '@shared/citizenshipReport.js';

const legend = BANDS.map((b) => ({ label: b.label, color: SERIES[b.slot] }));

/**
 * The Citizenship report body — everything below the report bar. Mirrors
 * server/src/report/citizenshipHtml.js; a change to one needs the same change
 * to the other.
 */
export default function CitizenshipReport({ result, overrides, onChange }) {
  const s = result.summary;
  const total = s.totalRecordsAnalyzed;
  const timing = czOutlierNote(s);
  const g = s.byGroup || {};

  // AI notes sit under the chart they explain; most charts have none.
  const notesByChart = new Map((result.sections || []).filter((x) => x.chart).map((x) => [x.chart, x]));
  const insightFor = (chart) => {
    const section = notesByChart.get(chart);
    return section ? <SectionCard inline section={section} overrides={overrides} onChange={onChange} /> : null;
  };

  const pctOf = (n) => `${((n / (total || 1)) * 100).toFixed(1)}% of cases`;
  const byId = Object.fromEntries(s.steps.map((x) => [x.id, x]));

  const statuses = Object.entries(s.statusBreakdown || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
  const monthly = Object.entries(s.monthlyApplications || {}).map(([label, value]) => ({ label, value }));
  const provinces = shareOf(s.provinceShares, total);
  const types = (s.applicationTypeShares || []).map((r, i) => ({ label: r.label, value: r.count, color: SERIES[i] }));
  const nationalities = (s.topNationalities || []).map((r) => ({ label: r.label, value: r.count }));

  const caseCols = [
    { key: 'case', label: 'Case' },
    { key: 'nationality', label: 'Nationality' },
    { key: 'type', label: 'Type' },
    { key: 'province', label: 'Province' },
    { key: 'days', label: 'Days', num: true },
  ];
  const caseRow = (c) => ({
    key: c.caseId,
    case: c.caseId,
    nationality: c.nationality,
    type: c.applicationType,
    province: c.province,
    days: c.days,
  });
  const caseBars = (arr) =>
    arr.map((c) => ({ label: c.label, value: c.days, sub: [c.province, `measured to ${MEASURED[c.measuredTo]}`].filter(Boolean).join(' · ') }));

  const steps = (title, desc, rows, groupLabel, note, chart) => (
    <ChartCard
      title={title}
      desc={desc}
      columns={stepColumns(groupLabel)}
      rows={stepTableRows(rows)}
      legend={legend}
      note={note}
      insight={insightFor(chart)}
    >
      <StackedBarChart data={rows} gutter={170} />
    </ChartCard>
  );

  return (
    <>
      <div className="tile-row">
        <StatTile label="Cases Submitted" value={total} foot="In the selected period" />
        <StatTile
          label="Decision Received"
          value={s.decisionReceivedCount}
          foot={`${pctOf(s.decisionReceivedCount)} · decision or a later step`}
        />
        <StatTile label="In Progress" value={s.inProgressCount} foot={pctOf(s.inProgressCount)} />
      </div>

      <h2 className="section-title">Processing Milestones</h2>
      <div className="milestone-grid tall">
        <StatTile
          featured
          label="Application → Decision"
          value={s.daysToDecision.mean ?? '—'}
          unit={s.daysToDecision.mean === null ? '' : 'days'}
          foot={`Average of all decided cases · ${fmt(s.daysToDecision.count)} cases`}
        />
        {TILE_STEPS.map((id) => byId[id])
          .filter(Boolean)
          .map((st) => (
            <StatTile
              key={st.id}
              label={st.label}
              value={st.mean ?? '—'}
              unit={st.mean === null ? '' : 'days'}
              foot={`Total cases: ${fmt(st.count)}`}
            />
          ))}
      </div>
      <p className="tile-note">
        <span className="tile-note-swatch" aria-hidden="true" />
        {finishNote(s)}
      </p>
      {timing ? <p className="card-note milestone-note">{timing}</p> : null}
      {insightFor(CZ_CHART.milestones) ? <div className="milestone-insight">{insightFor(CZ_CHART.milestones)}</div> : null}

      <ProcessLine
        summary={s}
        data={czProcessStages(s)}
        note={CZ_PROCESS_NOTE}
        insight={insightFor(CZ_CHART.process)}
      />

      <AnalysisSections sections={result.sections} overrides={overrides} onChange={onChange} qa={result.qa} />

      <h2 className="section-title">Step by Step</h2>
      {steps('By province', 'Average days at each step, and in total, for decided cases', stepRows(g.province), 'Province', joinNotes(groupNote(g.province, s.minGroup), timing), CZ_CHART.stepsProvince)}
      <div className="grid" style={{ marginTop: '1.25rem' }}>
        {steps('Single vs family', 'Average days at each step, and in total, for decided cases', stepRows(g.applicationType), 'Application type', joinNotes(groupNote(g.applicationType, s.minGroup), timing), CZ_CHART.stepsApplicationType)}
      </div>
      <div className="grid" style={{ marginTop: '1.25rem' }}>
        {steps('By nationality', 'The 10 nationalities with the most decided cases', stepRows(g.nationality), 'Nationality', joinNotes(groupNote(g.nationality, s.minGroup), coverageFor(s, 'nationality'), timing), CZ_CHART.stepsNationality)}
      </div>
      <div className="grid" style={{ marginTop: '1.25rem' }}>
        {steps('By IRCC office', 'Average days at each step, by the office processing the application', stepRows(g.office), 'IRCC office', joinNotes(groupNote(g.office, s.minGroup), coverageFor(s, 'office'), timing), CZ_CHART.stepsOffice)}
      </div>
      <div className="grid" style={{ marginTop: '1.25rem' }}>
        {steps('Extra checks', 'With and without an interview, a fingerprint request or urgent processing', extraCheckRows(g), 'Group', joinNotes(groupNote(extraOmitted(g), s.minGroup), coverageFor(s, 'extra'), timing), CZ_CHART.stepsExtraChecks)}
      </div>

      <h2 className="section-title">Who Is Applying</h2>
      <div className="grid two">
        <ChartCard
          title="Application status"
          desc="Where cases currently sit in the process"
          columns={[
            { key: 'label', label: 'Status' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={statuses.map((d) => ({ ...d, key: d.label }))}
          insight={insightFor(CZ_CHART.status)}
        >
          <BarChart data={statuses} gutter={150} />
        </ChartCard>

        <ChartCard
          title="Monthly applications"
          desc="Cases by the month the application was sent"
          columns={[
            { key: 'label', label: 'Month' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={monthly.map((d) => ({ ...d, key: d.label }))}
          insight={insightFor(CZ_CHART.monthlyApplications)}
        >
          <LineChart data={monthly} height={220} />
        </ChartCard>
      </div>

      <div className="grid two">
        <ChartCard
          title="Cases by province"
          desc="Share of cases by the province the applicant lives in"
          columns={[
            { key: 'label', label: 'Province' },
            { key: 'count', label: 'Cases', num: true },
            { key: 'value', label: '%', num: true },
          ]}
          rows={provinces.map((d) => ({ ...d, key: d.label }))}
          insight={insightFor(CZ_CHART.provinces)}
        >
          <BarChart data={provinces.map((d) => ({ ...d, sub: `${fmt(d.count)} cases` }))} gutter={170} valueSuffix="%" />
        </ChartCard>

        <ChartCard
          title="Single and family applications"
          desc="Share of cases by application type"
          columns={[
            { key: 'label', label: 'Type' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={types.map((d) => ({ ...d, key: d.label }))}
          legend={types.map((d) => ({ label: `${d.label} — ${fmt(d.value)}`, color: d.color }))}
          insight={insightFor(CZ_CHART.applicationTypes)}
        >
          <DonutChart data={types} size={210} centerLabel="cases" />
        </ChartCard>
      </div>

      <div className="grid" style={{ marginTop: '1.25rem' }}>
        <ChartCard
          title="Top 10 nationalities"
          desc="Applicant nationality"
          columns={[
            { key: 'label', label: 'Nationality' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={nationalities.map((d) => ({ ...d, key: d.label }))}
          note={coverageFor(s, 'nationality')}
          insight={insightFor(CZ_CHART.nationalities)}
        >
          <BarChart data={nationalities} gutter={170} />
        </ChartCard>
      </div>

      <h2 className="section-title">Individual Cases</h2>
      <div className="grid two">
        <ChartCard
          title="5 slowest cases"
          desc="Longest application to decision"
          columns={caseCols}
          rows={s.slowestCases.map(caseRow)}
          note={timing}
          insight={insightFor(CZ_CHART.slowest)}
        >
          <BarChart data={caseBars(s.slowestCases)} gutter={220} valueSuffix="d" />
        </ChartCard>

        <ChartCard
          title="5 quickest cases"
          desc="Shortest application to decision"
          columns={caseCols}
          rows={s.quickestCases.map(caseRow)}
          note={timing}
          insight={insightFor(CZ_CHART.quickest)}
        >
          <BarChart data={caseBars(s.quickestCases)} gutter={220} valueSuffix="d" />
        </ChartCard>
      </div>
    </>
  );
}

const MEASURED = {
  decision: 'decision date',
  oathLetter: 'oath letter',
  oathCeremony: 'oath ceremony',
  certificate: 'certificate',
};
