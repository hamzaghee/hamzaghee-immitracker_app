import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchDatasets,
  fetchReportOptions,
  fetchSession,
  startReport,
  fetchReportStatus,
  fetchReportResult,
  downloadReport,
  AuthRequiredError,
} from './api.js';
import PasswordGate from './components/PasswordGate.jsx';
import ReportConfig from './components/ReportConfig.jsx';
import ProgressView from './components/ProgressView.jsx';
import AnalysisSections from './components/AnalysisSections.jsx';
import BarChart from './components/BarChart.jsx';
import LineChart from './components/LineChart.jsx';
import DonutChart from './components/DonutChart.jsx';
import GroupedBarChart from './components/GroupedBarChart.jsx';
import ChartCard from './components/ChartCard.jsx';
import StatTile from './components/StatTile.jsx';
import { streamColor, fmt } from './components/primitives.jsx';

const POLL_MS = 1500;

const toSorted = (obj) =>
  Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

/**
 * Same, but swapping ISO country codes for their names.
 *
 * The summary keeps code-keyed maps (the pinned-output comparison depends on
 * that) and ships a `countryNames` lookup alongside for display.
 */
const toSortedNamed = (obj, names) =>
  Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .map(([code, value]) => ({ label: names?.[code] || code, value }));

/**
 * Theme state plus the *resolved* mode.
 *
 * The setting can be 'auto', but an export has to commit to one palette — a
 * PDF has no viewer preference to follow — so 'auto' is resolved against the
 * OS preference at download time.
 */
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'auto');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const resolved = () => {
    if (theme === 'dark' || theme === 'light') return theme;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  return [theme, setTheme, resolved];
}

export default function App() {
  // phase: 'config' | 'progress' | 'report'
  const [phase, setPhase] = useState('config');
  const [options, setOptions] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [dataset, setDataset] = useState('');
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null);
  const [overrides, setOverrides] = useState({ hidden: [], text: {} });
  const [error, setError] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [theme, setTheme, resolvedTheme] = useTheme();
  const pollRef = useRef(null);

  const refreshDatasets = useCallback(async () => {
    const { datasets: list, defaultId } = await fetchDatasets();
    setDatasets(list);
    setDataset((cur) => (cur && list.some((d) => d.id === cur) ? cur : defaultId || list[0]?.id || ''));
  }, []);

  /** Loads everything the app needs once past the gate. */
  const bootstrap = useCallback(async () => {
    try {
      const session = await fetchSession();
      if (!session.authenticated) {
        setNeedsAuth(true);
        return;
      }
      setNeedsAuth(false);
      await Promise.all([fetchReportOptions().then(setOptions), refreshDatasets()]);
    } catch (e) {
      if (e instanceof AuthRequiredError) setNeedsAuth(true);
      else setError(e.message);
    }
  }, [refreshDatasets]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Poll the job while it runs, then pull the result.
  useEffect(() => {
    if (phase !== 'progress' || !job?.id) return undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const status = await fetchReportStatus(job.id);
        if (cancelled) return;
        setJob(status);
        if (status.status === 'complete') {
          const res = await fetchReportResult(job.id);
          if (cancelled) return;
          setResult(res);
          setOverrides({ hidden: [], text: {} });
          setPhase('report');
        } else if (status.status !== 'failed') {
          pollRef.current = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    tick();

    return () => {
      cancelled = true;
      clearTimeout(pollRef.current);
    };
  }, [phase, job?.id]);

  async function submitConfig(config) {
    setBusy(true);
    setError(null);
    try {
      const started = await startReport(config);
      setJob(started);
      setPhase('progress');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function backToConfig() {
    clearTimeout(pollRef.current);
    setJob(null);
    setResult(null);
    setError(null);
    setPhase('config');
  }

  async function download(format) {
    setDownloading(format);
    setError(null);
    try {
      await downloadReport(job.id, format, overrides, resolvedTheme());
    } catch (e) {
      setError(`Download failed: ${e.message}`);
    } finally {
      setDownloading(null);
    }
  }

  const s = result?.summary;
  const meta = result?.meta;
  const config = result?.config;

  const streams = useMemo(
    () => toSorted(s?.streamDistribution).map((d) => ({ ...d, color: streamColor(d.label) })),
    [s]
  );
  const streamAvg = useMemo(
    () => toSorted(s?.streamVsSubmissionToPPR).map((d) => ({ ...d, color: streamColor(d.label) })),
    [s]
  );
  const countries = useMemo(
    () => toSortedNamed(s?.topCountriesOfResidence, s?.countryNames),
    [s]
  );
  const nationalities = useMemo(
    () => toSortedNamed(s?.topNationalities, s?.countryNames),
    [s]
  );
  const comparison = useMemo(
    () =>
      (s?.streamComparison || []).map((c) => ({
        label: c.label,
        highlighted: config?.stream === c.key,
        values: [
          { name: 'Longest case', value: c.longest },
          { name: 'Shortest case', value: c.shortest },
        ],
      })),
    [s, config]
  );

  const header = (
    <header className="masthead">
      <div>
        <h1>Express Entry Processing Insights</h1>
      </div>
      <button
        className="theme-toggle"
        onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')}
      >
        Theme: {theme}
      </button>
    </header>
  );

  if (needsAuth) {
    return <PasswordGate onAuthenticated={bootstrap} />;
  }

  if (error && phase === 'config' && !options) {
    return (
      <div className="app">
        {header}
        <div className="state-msg error">
          <p>
            <strong>Could not reach the API.</strong>
          </p>
          <p>{error}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Start it with <code>npm start</code> in the <code>server</code> folder.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'config') {
    return (
      <div className="app">
        {header}
        <ReportConfig
          options={options}
          datasets={datasets}
          dataset={dataset}
          onSelectDataset={setDataset}
          onDatasetsChanged={refreshDatasets}
          onSubmit={submitConfig}
          busy={busy}
          error={error}
          readOnly={options?.uploadsEnabled === false}
        />
      </div>
    );
  }

  if (phase === 'progress') {
    return (
      <div className="app">
        {header}
        <ProgressView status={job} config={config} onCancel={backToConfig} />
      </div>
    );
  }

  /* ---------------- report ---------------- */

  const caseRow = (c) => ({
    key: c.slug || c.caseId,
    case: c.slug || c.caseId,
    nationality: c.nationality,
    stream: c.stream,
    days: c.days,
  });
  const caseCols = [
    { key: 'case', label: 'Case' },
    { key: 'nationality', label: 'Nationality' },
    { key: 'stream', label: 'Stream' },
    { key: 'days', label: 'Days', num: true },
  ];
  const caseBars = (arr) =>
    arr.map((c) => ({ label: c.label, value: c.days, sub: `${c.caseId} · ${c.stream}` }));

  const milestones = [
    ['Submission → AOR', s.daysSubmissionToAor],
    ['AOR → Medicals passed', s.daysAorToMeds],
    ['AOR → Biometrics letter', s.daysAorToBil],
    ['AOR → PPR', s.daysAorToPPR],
    ['Biometrics → PPR', s.daysBilToPPR],
    ['Medicals → PPR', s.daysMedsToPPR],
  ];

  const monthlySubs = Object.entries(s.monthlySubmissions).map(([label, value]) => ({ label, value }));
  const monthlyTimes = Object.entries(s.monthlyProcessingTimes).map(([label, v]) => ({
    label,
    value: v.meanDays,
  }));

  return (
    <div className="app">
      {header}

      <div className="report-bar">
        <button className="link-btn" onClick={backToConfig}>
          ← New report
        </button>
        <div className="report-downloads">
          <button className="primary" disabled={downloading} onClick={() => download('html')}>
            {downloading === 'html' ? 'Preparing…' : 'Download as HTML'}
          </button>
          <button className="primary" disabled={downloading} onClick={() => download('pdf')}>
            {downloading === 'pdf' ? 'Rendering…' : 'Download as PDF'}
          </button>
        </div>
      </div>

      {error ? <p className="dataset-msg error">{error}</p> : null}
      {result.notice ? <p className="note-banner">{result.notice}</p> : null}

      <div className="tile-row">
        <StatTile label="Cases Submitted" value={s.totalRecordsAnalyzed} foot="In the selected period" />
        <StatTile
          label="Approved"
          value={s.approvedCount}
          foot="Cases that have reached PPR status"
        />
        <StatTile
          label="Refused"
          value={s.refusalCount}
          foot={`${((s.refusalCount / (s.totalRecordsAnalyzed || 1)) * 100).toFixed(1)}% of cases`}
        />
        <StatTile
          label="Submission → PPR"
          value={s.daysSubmissionToPPR.mean}
          unit="days"
          foot={`Total cases: ${fmt(s.daysSubmissionToPPR.count)}`}
        />
      </div>

      <h2 className="section-title">Processing Milestones</h2>
      <div className="tile-row">
        {milestones.map(([label, st]) => (
          <StatTile
            key={label}
            label={label}
            value={st.mean}
            unit="days"
            foot={`Total cases: ${fmt(st.count)}`}
          />
        ))}
      </div>

      <AnalysisSections sections={result.sections} overrides={overrides} onChange={setOverrides} />

      <h2 className="section-title">Charts</h2>

      <div className="grid two">
        <ChartCard
          title="Stream breakdown"
          desc="Share of cases by program category"
          columns={[
            { key: 'label', label: 'Stream' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={streams.map((d) => ({ ...d, key: d.label }))}
          legend={streams.map((d) => ({ label: `${d.label} — ${fmt(d.value)}`, color: d.color }))}
        >
          <DonutChart data={streams} size={210} centerLabel="cases" />
        </ChartCard>

        <ChartCard
          title="Application status"
          desc="Where cases currently sit in the pipeline"
          columns={[
            { key: 'label', label: 'Status' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={toSorted(s.statusBreakdown).map((d) => ({ ...d, key: d.label }))}
        >
          <BarChart data={toSorted(s.statusBreakdown)} gutter={135} />
        </ChartCard>
      </div>

      <div className="grid two">
        <ChartCard
          title="Top 10 countries of residence"
          desc="Where applicants were living when they applied"
          columns={[
            { key: 'label', label: 'Country' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={countries.map((d) => ({ ...d, key: d.label }))}
        >
          <BarChart data={countries} gutter={170} />
        </ChartCard>

        <ChartCard
          title="Top 10 nationalities"
          desc="Applicant nationality"
          columns={[
            { key: 'label', label: 'Nationality' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={nationalities.map((d) => ({ ...d, key: d.label }))}
        >
          <BarChart data={nationalities} gutter={170} />
        </ChartCard>
      </div>

      <ChartCard
        title="Average Submission → PPR by stream"
        desc="Mean elapsed days, coloured by stream"
        columns={[
          { key: 'label', label: 'Stream' },
          { key: 'value', label: 'Avg days', num: true },
        ]}
        rows={streamAvg.map((d) => ({ ...d, key: d.label }))}
      >
        <BarChart data={streamAvg} gutter={130} valueSuffix="d" />
      </ChartCard>

      <div className="grid two" style={{ marginTop: '1.25rem' }}>
        <ChartCard
          title="Monthly submissions"
          desc="Cases by month of submission"
          columns={[
            { key: 'label', label: 'Month' },
            { key: 'value', label: 'Cases', num: true },
          ]}
          rows={monthlySubs.map((d) => ({ ...d, key: d.label }))}
        >
          <LineChart data={monthlySubs} height={220} />
        </ChartCard>

        <ChartCard
          title="Monthly processing times"
          desc="Average Submission → PPR by month of submission"
          columns={[
            { key: 'label', label: 'Month' },
            { key: 'value', label: 'Avg days', num: true },
          ]}
          rows={monthlyTimes.map((d) => ({ ...d, key: d.label }))}
        >
          <LineChart data={monthlyTimes} height={220} valueSuffix="d" />
        </ChartCard>
      </div>

      <ChartCard
        title="Comparison of min & max processing times"
        desc="Longest and shortest Submission → PPR per program, within the selected period"
        columns={[
          { key: 'label', label: 'Program' },
          { key: 'shortest', label: 'Shortest', num: true },
          { key: 'longest', label: 'Longest', num: true },
          { key: 'count', label: 'Cases', num: true },
        ]}
        rows={(s.streamComparison || []).map((c) => ({ ...c, key: c.key })) }
        legend={[
          { label: 'Longest case', color: 'var(--series-2)' },
          { label: 'Shortest case', color: 'var(--series-1)' },
        ]}
      >
        <GroupedBarChart data={comparison} anySelected={config?.stream !== 'all'} />
      </ChartCard>

      <div className="grid two" style={{ marginTop: '1.25rem' }}>
        <ChartCard
          title="5 slowest cases"
          desc="Longest Submission → PPR durations"
          columns={caseCols}
          rows={s.slowestCases.map(caseRow)}
        >
          <BarChart data={caseBars(s.slowestCases)} gutter={190} valueSuffix="d" />
        </ChartCard>

        <ChartCard
          title="5 quickest cases"
          desc="Shortest Submission → PPR durations"
          columns={caseCols}
          rows={s.quickestCases.map(caseRow)}
        >
          <BarChart data={caseBars(s.quickestCases)} gutter={190} valueSuffix="d" />
        </ChartCard>
      </div>

    </div>
  );
}
