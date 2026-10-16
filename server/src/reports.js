/**
 * Report jobs.
 *
 * Generation is asynchronous because the AI step can take minutes. The client
 * posts a configuration, gets a job id back immediately, and polls for step
 * progress — which is what the Progress page renders.
 *
 * Jobs live in memory. They hold a filtered summary (small) rather than the
 * filtered rows (large), so retaining several is cheap; the oldest are dropped
 * past MAX_JOBS.
 */

import crypto from 'node:crypto';
import { getRecords } from './dataStore.js';
import { filterByWindow } from './pipeline/filter.js';
import {
  filterByStream,
  streamGroupLabel,
  isStreamGroup,
  DEFAULT_STREAM_GROUP,
} from './pipeline/streamGroups.js';
import { analyze } from './pipeline/analyze.js';
import { buildFindings } from './pipeline/findings.js';
import {
  computedSections,
  assembleSections,
  generateInsights,
  periodLabel,
} from './pipeline/insights.js';
import { renderReportHtml } from './report/html.js';

const MAX_JOBS = Number(process.env.MAX_REPORT_JOBS) || 20;

export const REPORT_TYPES = {
  'express-entry': { label: 'Express Entry', available: true },
  'spousal-sponsorship': { label: 'Spousal Sponsorship', available: false },
  citizenship: { label: 'Citizenship', available: false },
};

export const listReportTypes = () =>
  Object.entries(REPORT_TYPES).map(([value, v]) => ({ value, ...v }));

const STEP_ORDER = ['filtering', 'analysing', 'ai-analysis', 'fact-check', 'rendering'];
const STEP_LABELS = {
  filtering: 'Applying filters',
  analysing: 'Analysing filtered data',
  // Names the wait explicitly: this is the one step that takes noticeable time,
  // so telling the reader roughly how long beats a bare label.
  'ai-analysis': 'Generating AI Analysis. This might take a minute.',
  'fact-check': 'Fact-checking the AI Analysis',
  rendering: 'Building report',
};

/** id -> job */
const jobs = new Map();

const newSteps = () =>
  STEP_ORDER.map((id) => ({ id, label: STEP_LABELS[id], state: 'pending', detail: null }));

function evict() {
  if (jobs.size <= MAX_JOBS) return;
  [...jobs.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, jobs.size - MAX_JOBS)
    .forEach((j) => jobs.delete(j.id));
}

const setStep = (job, id, state, detail = null) => {
  const s = job.steps.find((x) => x.id === id);
  if (s) {
    s.state = state;
    if (detail !== null) s.detail = detail;
  }
};

/** Validates the posted configuration, throwing 400s with useful messages. */
export function normaliseConfig(body = {}) {
  const reportType = body.reportType || 'express-entry';
  const type = REPORT_TYPES[reportType];
  if (!type) {
    throw Object.assign(new Error(`Unknown report type: ${reportType}`), { status: 400 });
  }
  if (!type.available) {
    throw Object.assign(
      new Error(`${type.label} reports are not available yet.`),
      { status: 400, code: 'REPORT_TYPE_UNAVAILABLE' }
    );
  }

  const stream = body.stream || DEFAULT_STREAM_GROUP;
  if (!isStreamGroup(stream)) {
    throw Object.assign(new Error(`Unknown stream: ${stream}`), { status: 400 });
  }

  return {
    reportType,
    programLabel: type.label,
    stream,
    streamLabel: streamGroupLabel(stream),
    from: body.from || undefined,
    to: body.to || undefined,
    datasetId: body.datasetId || undefined,
  };
}

/**
 * Creates a job and starts it. Returns immediately with the job id.
 */
export function startReport(config) {
  const id = crypto.randomUUID();
  const job = {
    id,
    config,
    createdAt: Date.now(),
    status: 'running',
    steps: newSteps(),
    error: null,
    summary: null,
    sections: null,
    meta: null,
    notice: '',
    qa: null,
  };
  jobs.set(id, job);
  evict();

  // Deliberately not awaited — the caller polls.
  run(job).catch((err) => {
    job.status = 'failed';
    job.error = err.message;
    const current = job.steps.find((s) => s.state === 'running');
    if (current) setStep(job, current.id, 'failed', err.message);
  });

  return job;
}

async function run(job) {
  const { config } = job;

  // 1. filter
  setStep(job, 'filtering', 'running');
  const all = getRecords(config.datasetId);
  // With neither bound set, filterByWindow falls back to the n8n rolling window.
  const byPeriod = filterByWindow(all, { from: config.from, to: config.to });
  const filtered = filterByStream(byPeriod, config.stream);
  setStep(
    job,
    'filtering',
    'done',
    `${filtered.length.toLocaleString('en-CA')} of ${all.length.toLocaleString('en-CA')} cases`
  );

  if (!filtered.length) {
    throw Object.assign(
      new Error('No cases match this configuration. Try widening the period or choosing All Streams.'),
      { status: 400 }
    );
  }

  // 2. analyse
  //
  // The comparison chart is fed the period-filtered rows *before* the stream
  // filter, so it always spans all programmes even when one stream is selected.
  //
  // Extreme processing times are left out of every timing figure; each chart
  // they would have changed says so. The findings are the questions the AI
  // analysis is written from (see pipeline/findings.js).
  setStep(job, 'analysing', 'running');
  const summary = analyze(filtered, { comparisonRecords: byPeriod, excludeOutliers: true });
  job.summary = summary;
  const { findings, asked } = buildFindings(filtered, summary);
  setStep(
    job,
    'analysing',
    'done',
    `${summary.totalRecordsAnalyzed.toLocaleString('en-CA')} cases analysed · ${findings.length} of ${asked} questions notable`
  );

  const labelled = { ...config, periodLabel: periodLabel(config) };

  // 3. written analysis, then its fact check — degrades rather than failing
  // the report
  setStep(job, 'ai-analysis', 'running');
  const computed = computedSections(summary, labelled);
  const generated = await generateInsights(summary, labelled, findings, {
    onStage: (stage) => {
      if (stage === 'checking') {
        setStep(job, 'ai-analysis', 'done');
        setStep(job, 'fact-check', 'running');
      }
    },
  });
  if (generated.available) {
    const { qa } = generated;
    setStep(job, 'ai-analysis', 'done', `via ${generated.model}`);
    setStep(
      job,
      'fact-check',
      'done',
      `${qa.kept} of ${qa.checked} passed${qa.reviewer ? ` · reviewed by ${qa.reviewer}` : ''}`
    );
    job.qa = qa;
  } else if (generated.withheld) {
    setStep(job, 'fact-check', 'failed', generated.reason);
    job.notice =
      'Written commentary was withheld because it could not be fact-checked. ' +
      'Every computed figure in this report is complete.';
  } else {
    setStep(job, 'ai-analysis', 'skipped', generated.reason);
    setStep(job, 'fact-check', 'skipped');
    job.notice =
      'Written commentary was skipped because the analysis model was unavailable. ' +
      'Every computed figure in this report is complete.';
  }
  job.sections = assembleSections(computed, generated);

  // 4. render
  setStep(job, 'rendering', 'running');
  job.meta = {
    sourceRecords: all.length,
    filteredRecords: filtered.length,
    datasetName: config.datasetName,
    generatedAt: new Date().toISOString(),
  };
  job.config = labelled;
  setStep(job, 'rendering', 'done');

  job.status = 'complete';
}

export function getJob(id) {
  const job = jobs.get(id);
  if (!job) throw Object.assign(new Error(`Unknown report: ${id}`), { status: 404 });
  return job;
}

/** Poll shape — never includes the full summary. */
export const jobStatus = (job) => ({
  id: job.id,
  status: job.status,
  steps: job.steps,
  error: job.error,
});

export const jobResult = (job) => {
  if (job.status !== 'complete') {
    throw Object.assign(new Error(`Report is ${job.status}.`), { status: 409 });
  }
  return {
    id: job.id,
    config: job.config,
    meta: job.meta,
    notice: job.notice,
    summary: job.summary,
    sections: job.sections,
    // What the fact check removed and why — shown on the report page so the
    // reader can see the check working; never part of the export.
    qa: job.qa,
  };
};

/**
 * Renders the job to HTML.
 *
 * `overrides` carries the report page's per-section edits — hidden sections and
 * pasted replacement text — so a download matches what is on screen.
 * Shape: { hidden: [id], text: { id: 'replacement' } }
 *
 */
export function renderJobHtml(job, overrides = {}) {
  if (job.status !== 'complete') {
    throw Object.assign(new Error(`Report is ${job.status}.`), { status: 409 });
  }
  const hidden = new Set(overrides.hidden || []);
  const text = overrides.text || {};

  const sections = (job.sections || [])
    .filter((s) => !hidden.has(s.id))
    .map((s) => (text[s.id] ? { ...s, body: text[s.id], source: 'edited' } : s));

  return renderReportHtml({
    summary: job.summary,
    sections,
    config: job.config,
    notice: job.notice,
  });
}

/** Filename stem for downloads, e.g. express-entry-cec-2026-08-12 */
export const reportFilename = (job) =>
  [job.config.reportType, job.config.stream, new Date(job.meta?.generatedAt || Date.now()).toISOString().slice(0, 10)]
    .filter(Boolean)
    .join('-');
