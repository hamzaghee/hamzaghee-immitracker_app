/**
 * Immitracker Express Entry — analytics API.
 *
 * Replicates the n8n workflow as an HTTP service:
 *   Read file → Relabel Rows → Filter 18 months → Analysis - Code → JSON
 * (the workflow's final "Webpage Coder" HTML step is replaced by the React
 * frontend, which consumes /api/summary directly).
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import {
  init,
  getRecords,
  listDatasets,
  addUpload,
  removeDataset,
  clearAllDatasets,
  hasDataset,
  defaultDatasetId,
} from './dataStore.js';
import {
  filterByWindow,
  parseLooseDate,
  DEFAULT_MONTHS,
  DEFAULT_DATE_FIELD,
} from './pipeline/filter.js';
import { analyze } from './pipeline/analyze.js';
import {
  generateInsights,
  probeLlm,
  computedSections,
  assembleSections,
} from './pipeline/insights.js';
import { listStreamGroups, filterByStream, streamGroupLabel } from './pipeline/streamGroups.js';
import {
  startReport,
  normaliseConfig,
  getJob,
  jobStatus,
  jobResult,
  renderJobHtml,
  reportFilename,
  listReportTypes,
} from './reports.js';
import { htmlToPdf, pdfAvailable, reapOrphanedBrowsers } from './report/pdf.js';
import { costlyLimiters, pollLimiter, loginLimiter, trustProxySetting } from './rateLimit.js';
import { isDemo, isProduction, publicConfig, APP_MODE } from './config.js';
import {
  assertAuthConfigured,
  requireAuth,
  checkPassword,
  issueSession,
  clearSession,
  isAuthenticated,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 250;

// Off unless TRUST_PROXY is set — see rateLimit.js. A permissive value with no
// proxy in front lets a caller spoof their identity and evade the limiter.
app.set('trust proxy', trustProxySetting());

app.use(cors());
// Replacement text pasted into report sections travels in the download body,
// so the default 100kb limit is too tight.
app.use(express.json({ limit: '2mb' }));

// Uploads land in the OS temp dir first and are only promoted into the registry
// after they parse and validate, so a rejected file never persists.
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

/** Resolves ?dataset=, falling back to the most recent upload. */
function readDataset(query) {
  const id = query.dataset;
  if (!id) {
    const fallback = defaultDatasetId();
    if (!fallback) {
      // 409 rather than 503: the server is healthy, there is just nothing to
      // analyse yet. The dashboard treats this as "show the upload prompt".
      throw Object.assign(new Error('No dataset loaded. Upload an export to begin.'), {
        status: 409,
        code: 'NO_DATASET',
      });
    }
    return fallback;
  }
  if (!hasDataset(id)) throw Object.assign(new Error(`Unknown dataset: ${id}`), { status: 404 });
  return id;
}

/**
 * Reads the window controls off the query string.
 * Defaults reproduce the n8n node: 18 months on "Submitted".
 * `months=all` disables the window.
 */
function readWindow(query) {
  const dateField = query.dateField || DEFAULT_DATE_FIELD;

  let months = DEFAULT_MONTHS;
  if (query.months !== undefined) {
    if (query.months === 'all') {
      months = null;
    } else {
      const parsed = Number(query.months);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        const err = new Error(`Invalid months: ${query.months}. Use a positive number or "all".`);
        err.status = 400;
        throw err;
      }
      months = parsed;
    }
  }
  return { months, dateField };
}

/**
 * Stages 2 + 3 for the requested slice.
 *
 * Kept alongside the report-job flow: the report page reads a finished job,
 * but this is how you inspect an arbitrary slice directly — used by the
 * verification checks and handy for debugging.
 * Accepts `from`/`to` and `stream` in addition to the rolling window.
 */
function computeSummary(query) {
  const { months, dateField } = readWindow(query);
  const datasetId = readDataset(query);
  const all = getRecords(datasetId);
  const byPeriod =
    query.from || query.to
      ? filterByWindow(all, { from: query.from, to: query.to, dateField })
      : filterByWindow(all, { months, dateField });
  const filtered = query.stream ? filterByStream(byPeriod, query.stream) : byPeriod;
  const summary = analyze(filtered);

  // How many records carry a usable date in this field at all, ignoring the
  // window. Surfaces how much of the dataset a given anchor can even reach.
  const datedRecords = all.reduce((n, r) => n + (parseLooseDate(r[dateField]) ? 1 : 0), 0);

  const dataset = listDatasets().find((d) => d.id === datasetId);

  return {
    meta: {
      dataset,
      sourceRecords: all.length,
      datedRecords,
      filteredRecords: filtered.length,
      window: months === null ? 'all' : `${months} months`,
      dateField,
      isN8nDefault: months === DEFAULT_MONTHS && dateField === DEFAULT_DATE_FIELD,
      generatedAt: new Date().toISOString(),
    },
    summary,
  };
}

/* ---------------- auth ---------------- */

// Health and the auth routes stay open; everything else under /api needs a
// session when running in production mode.
const OPEN_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
];

/** Whether to mark the cookie Secure — true behind Railway's TLS proxy. */
const secureCookie = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

app.post('/api/auth/login', loginLimiter, (req, res) => {
  if (!isProduction()) return res.json({ ok: true, authRequired: false });
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect password.', code: 'BAD_PASSWORD' });
  }
  issueSession(res, { secure: secureCookie(req) });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

/** Lets the frontend decide between the password screen and the app. */
app.get('/api/auth/session', (req, res) => {
  res.json({ authRequired: isProduction(), authenticated: !isProduction() || isAuthenticated(req) });
});

app.use('/api', requireAuth(OPEN_PATHS));

/* ---------------- status ---------------- */

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    mode: APP_MODE,
    datasets: listDatasets(),
    llm: probeLlm(),
    pdf: await pdfAvailable(),
  });
});

/** Everything the Report Configuration page needs to build its form. */
app.get('/api/report-options', (_req, res) => {
  res.json({
    reportTypes: listReportTypes(),
    streams: listStreamGroups(),
    ...publicConfig(),
  });
});

/**
 * Rejects mutations in demo mode.
 *
 * The frontend also hides these controls, but that is presentation. This is the
 * actual guard — a public demo must not accept file uploads, or a visitor could
 * put genuinely sensitive data on a public server.
 */
function blockInDemo(_req, _res, next) {
  if (isDemo()) {
    return next(
      Object.assign(new Error('This is a read-only demo — uploads and deletion are disabled.'), {
        status: 403,
        code: 'DEMO_READ_ONLY',
      })
    );
  }
  next();
}

/* ---------------- report jobs ---------------- */

app.post('/api/reports', costlyLimiters, (req, res, next) => {
  try {
    const config = normaliseConfig(req.body);
    const datasetId = readDataset({ dataset: config.datasetId });
    const dataset = listDatasets().find((d) => d.id === datasetId);
    const job = startReport({ ...config, datasetId, datasetName: dataset?.name });
    res.status(202).json(jobStatus(job));
  } catch (err) {
    next(err);
  }
});

// Polling only — generous budget, since the report page calls this every ~1.5s
// while a report builds.
app.get('/api/reports/:id', pollLimiter, (req, res, next) => {
  try {
    res.json(jobStatus(getJob(req.params.id)));
  } catch (err) {
    next(err);
  }
});

app.get('/api/reports/:id/result', (req, res, next) => {
  try {
    res.json(jobResult(getJob(req.params.id)));
  } catch (err) {
    next(err);
  }
});

/**
 * Download endpoints accept section overrides so exports match the screen.
 * POST because the pasted replacement text can be long; GET is kept for the
 * plain, unedited case so the file can be opened directly in a browser.
 */
function overridesFrom(req) {
  if (req.method === 'POST') return req.body?.overrides || {};
  const { hidden } = req.query;
  return hidden ? { hidden: String(hidden).split(',').filter(Boolean) } : {};
}

/** Theme the viewer had active; anything but 'dark' renders light. */
const themeFrom = (req) => ((req.body?.theme ?? req.query.theme) === 'dark' ? 'dark' : 'light');

function sendHtml(req, res) {
  const job = getJob(req.params.id);
  const html = renderJobHtml(job, overridesFrom(req), themeFrom(req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${reportFilename(job)}.html"`);
  res.send(html);
}

async function sendPdf(req, res) {
  const job = getJob(req.params.id);
  const html = renderJobHtml(job, overridesFrom(req), themeFrom(req));
  const pdf = await htmlToPdf(html);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${reportFilename(job)}.pdf"`);
  res.send(pdf);
}

app.get('/api/reports/:id/report.html', costlyLimiters, (req, res, next) => {
  try {
    sendHtml(req, res);
  } catch (err) {
    next(err);
  }
});
app.post('/api/reports/:id/report.html', costlyLimiters, (req, res, next) => {
  try {
    sendHtml(req, res);
  } catch (err) {
    next(err);
  }
});
app.get('/api/reports/:id/report.pdf', costlyLimiters, (req, res, next) => sendPdf(req, res).catch(next));
app.post('/api/reports/:id/report.pdf', costlyLimiters, (req, res, next) => sendPdf(req, res).catch(next));

/* ---------------- datasets ---------------- */

app.get('/api/datasets', (_req, res) => {
  res.json({ datasets: listDatasets(), defaultId: defaultDatasetId() || null });
});

/**
 * Upload a new export and run it through the same pipeline.
 * multipart/form-data, field name "file".
 */
app.post('/api/datasets', blockInDemo, costlyLimiters, upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) {
      throw Object.assign(new Error('No file received. Send multipart/form-data with a "file" field.'), {
        status: 400,
      });
    }
    res.status(201).json({ dataset: addUpload({
      tempPath: req.file.path,
      originalName: req.file.originalname || 'upload.json',
    }) });
  } catch (err) {
    next(err);
  }
});

/** Remove every upload, returning the app to its empty state. */
app.delete('/api/datasets', blockInDemo, (_req, res, next) => {
  try {
    const removed = clearAllDatasets();
    res.json({ ok: true, removed, datasets: listDatasets() });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/datasets/:id', blockInDemo, (req, res, next) => {
  try {
    removeDataset(req.params.id);
    res.json({ ok: true, datasets: listDatasets() });
  } catch (err) {
    next(err);
  }
});

/** The main dashboard payload. */
app.get('/api/summary', (req, res, next) => {
  try {
    res.json(computeSummary(req.query));
  } catch (err) {
    next(err);
  }
});

/**
 * Paginated case rows for the drill-down table.
 * Supports ?stream= &status= &limit= &offset= &sort= &dir=
 */
app.get('/api/cases', (req, res, next) => {
  try {
    const { months, dateField } = readWindow(req.query);
    let rows = filterByWindow(getRecords(readDataset(req.query)), { months, dateField });

    if (req.query.stream) rows = rows.filter((r) => r['Stream'] === req.query.stream);
    if (req.query.status) rows = rows.filter((r) => r['Current Status'] === req.query.status);

    const total = rows.length;
    const sort = req.query.sort;
    if (sort) {
      const dir = req.query.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[sort];
        const bv = b[sort];
        const an = parseFloat(av);
        const bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }

    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Number(req.query.offset) || 0;

    res.json({
      total,
      limit,
      offset,
      rows: rows.slice(offset, offset + limit).map((r) => ({
        slug: r['_slugs'] || '',
        username: r['Username'] || '',
        stream: r['Stream'] || '',
        status: r['Current Status'] || '',
        country: r['Country of Residence'] || '',
        nationality: r['Nationality'] || '',
        crs: r['CRS Score'] || '',
        submitted: r['Submitted'] || '',
        aor: r['AOR Date'] || '',
        subToPpr: r['Days from Submission to PPR'] ?? '',
        aorToPpr: r['Days from AOR to PPR'] ?? '',
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Analysis for an arbitrary slice, outside the report-job flow.
 *
 * The computed sections always come back; the generated ones only when Ollama
 * is reachable, with `generated.available` explaining why not.
 */
app.get('/api/insights', costlyLimiters, async (req, res, next) => {
  try {
    const { summary, meta } = computeSummary(req.query);
    const config = {
      from: req.query.from,
      to: req.query.to,
      programLabel: 'Express Entry',
      streamLabel: req.query.stream ? streamGroupLabel(req.query.stream) : 'All Streams',
    };
    const computed = computedSections(summary, config);
    const generated = await generateInsights(summary, config);
    res.json({
      meta,
      generated: { available: generated.available, reason: generated.reason, model: generated.model },
      sections: assembleSections(computed, generated),
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- frontend ---------------- */

/**
 * Serve the built React app from the same process.
 *
 * One service instead of two: no CORS to configure, and the deployment bill is
 * halved. Registered *after* every /api route so the SPA fallback cannot shadow
 * them — a catch-all placed earlier would swallow API 404s and return HTML.
 */
const WEB_DIST = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
  console.log(`[web] serving built frontend from ${path.relative(process.cwd(), WEB_DIST)}`);
} else {
  console.log('[web] no build found — run "npm run build" in web/ (fine in dev, Vite serves it)');
}

app.use((err, _req, res, _next) => {
  // multer signals an oversized upload with its own code.
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File exceeds the ${MAX_UPLOAD_MB} MB limit.` });
  }
  // Expected states, not server faults — don't fill the log with them.
  const quiet = ['NO_DATASET', 'AUTH_REQUIRED', 'RATE_LIMITED', 'DEMO_READ_ONLY'];
  if (!quiet.includes(err.code)) console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message, code: err.code });
});

// Fail fast rather than starting a "protected" instance with no password.
assertAuthConfigured();

init();

// Clear browsers stranded by a previous forced shutdown. Scoped to Puppeteer's
// own cache directory, so the user's Chrome is never touched.
reapOrphanedBrowsers()
  .then((r) => {
    if (r.killed) console.log(`[pdf] reaped ${r.killed} orphaned browser process(es)`);
    else if (r.reason) console.log(`[pdf] orphan sweep skipped: ${r.reason}`);
  })
  .catch(() => {});

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
