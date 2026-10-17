/**
 * Dataset registry.
 *
 * Upload-only: the server starts with no datasets and never auto-loads a file
 * from the project folder. Everything the dashboard shows comes from a file the
 * user uploaded. Uploads persist in UPLOAD_DIR across restarts and are cleared
 * explicitly (removeDataset / clearAllDatasets).
 *
 * Memory: measured, a 46 MB export takes peak RSS from ~60 MB to ~240 MB —
 * about 180 MB of relabeled objects. (An earlier comment here claimed ~1 GB;
 * that was an estimate, never measured, and wrong by roughly 4x.) Even so,
 * parsed records are cached for at most MAX_CACHED datasets (least-recently-used
 * evicted first). Eviction only drops the in-memory records — the file stays on
 * disk and is re-read on next use.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { relabelRows } from './pipeline/relabel.js';
import { fieldToLabel } from './pipeline/fieldMap.js';
import { relabelCitizenship } from './pipeline/citizenship/relabel.js';
import { citizenshipFieldToLabel } from './pipeline/citizenship/fieldMap.js';
import { detectTracker } from './pipeline/citizenship/detect.js';
import { isDemo } from './config.js';

/**
 * What differs per tracker: its field dictionary, its relabel step, and the
 * one field the pipeline cannot work without. The tracker is detected from the
 * field ids on upload and stored with the dataset, and each report type only
 * runs on datasets of its own tracker.
 */
const TRACKERS = {
  'express-entry': {
    fields: fieldToLabel,
    relabel: relabelRows,
    statusField: 'xopos-kybed-picys-supot-gukab-tetyl-luzyd-lekez-gixex',
  },
  citizenship: {
    fields: citizenshipFieldToLabel,
    relabel: relabelCitizenship,
    statusField: 'xekim-tabom-koguk-liven-mepis-fegyc-fufyt-kanac-foxex',
  },
};

/**
 * Uploads from before tracker detection carry no tracker in their metadata;
 * every one of them was an Express Entry export.
 */
const DEFAULT_TRACKER = 'express-entry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../uploads');

/**
 * Reference export path. The server does NOT load this — it exists so the
 * offline verification script (scripts/verify-against-pin.js) can find a local
 * export to re-run the pipeline over. Override with DATA_PATH.
 */
export const DATA_PATH =
  process.env.DATA_PATH || path.resolve(projectRoot, 'consolidated_eapr_active_cases.json');

const MAX_CACHED = Number(process.env.MAX_CACHED_DATASETS) || 3;

/** id -> { id, name, filePath, uploadedAt, sourceCount, coverage, records|null, lastUsed } */
const datasets = new Map();

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Validates that a parsed payload looks like an Immitracker export, works out
 * which tracker it came from, and reports how many of that tracker's known
 * field ids it actually contains. Low coverage means the labels — and
 * therefore every chart — will be mostly empty, which is worth telling the
 * user before they wonder why the dashboard is blank.
 */
export function inspectPayload(parsed) {
  const rows = Array.isArray(parsed) ? parsed : parsed?.data || parsed?.records;

  if (!Array.isArray(rows)) {
    throw Object.assign(
      new Error('Expected a JSON array of case objects (or an object with a "data"/"records" array).'),
      { status: 400 }
    );
  }
  if (rows.length === 0) {
    throw Object.assign(new Error('The file contains no records.'), { status: 400 });
  }
  if (typeof rows[0] !== 'object' || rows[0] === null || Array.isArray(rows[0])) {
    throw Object.assign(new Error('Records must be JSON objects.'), { status: 400 });
  }

  // Sample across the whole file rather than the head: exports are roughly
  // chronological and older records carry fewer fields, so sampling the first
  // N rows understates coverage badly.
  const target = 500;
  const stride = Math.max(1, Math.floor(rows.length / target));
  const seen = new Set();
  const sample = [];
  for (let i = 0; i < rows.length; i += stride) {
    const r = rows[i];
    if (r && typeof r === 'object') {
      sample.push(r);
      for (const k of Object.keys(r)) seen.add(k);
    }
  }

  // A file with no known field id at all is still accepted (with a warning),
  // and read as Express Entry, as it always was.
  const tracker = detectTracker(sample).tracker || DEFAULT_TRACKER;
  const known = Object.keys(TRACKERS[tracker].fields);
  const matched = known.filter((k) => seen.has(k));

  return {
    rows,
    coverage: {
      tracker,
      knownFields: known.length,
      matchedFields: matched.length,
      // The pipeline keys everything off these; without them nothing works.
      // Citizenship has no streams.
      hasStream:
        tracker === 'express-entry' ? seen.has('xidar-kiboc-feruv-vazum-dazul-noror-kemip-pagit-fixix') : null,
      hasStatus: seen.has(TRACKERS[tracker].statusField),
    },
  };
}

/** Which tracker a dataset came from. */
const trackerOf = (entry) => entry.coverage?.tracker || DEFAULT_TRACKER;

/** Drops cached records from the least-recently-used datasets. */
function evictIfNeeded() {
  const cached = [...datasets.values()].filter((d) => d.records);
  if (cached.length <= MAX_CACHED) return;
  cached
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, cached.length - MAX_CACHED)
    .forEach((d) => {
      d.records = null;
      console.log(`[data] evicted cached records for "${d.name}"`);
    });
}

function readAndRelabel(entry) {
  const started = Date.now();
  const parsed = JSON.parse(fs.readFileSync(entry.filePath, 'utf8'));
  const { rows, coverage } = inspectPayload(parsed);
  entry.sourceCount = rows.length;
  entry.coverage = coverage;
  entry.records = TRACKERS[coverage.tracker].relabel(rows);
  entry.loadMs = Date.now() - started;
  console.log(`[data] loaded "${entry.name}" — ${rows.length} records in ${entry.loadMs}ms`);
  return entry;
}

/**
 * Re-attaches uploads that survived a restart. Nothing else is registered —
 * a fresh install starts with an empty registry and the dashboard shows its
 * upload prompt until a file arrives.
 *
 * Records are not parsed here; metadata comes from each upload's sidecar
 * `.meta` file so startup stays fast regardless of how many uploads exist.
 */
export function init() {
  if (isDemo()) {
    seedDemoDataset();
    return;
  }

  for (const file of fs.readdirSync(UPLOAD_DIR).filter((f) => f.endsWith('.json'))) {
    const id = path.basename(file, '.json');
    if (datasets.has(id)) continue;
    const metaPath = path.join(UPLOAD_DIR, `${id}.meta`);
    let meta = {};
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        /* fall back to defaults below */
      }
    }
    datasets.set(id, {
      id,
      name: meta.name || file,
      filePath: path.join(UPLOAD_DIR, file),
      uploadedAt: meta.uploadedAt || fs.statSync(path.join(UPLOAD_DIR, file)).mtime.toISOString(),
      sourceCount: meta.sourceCount,
      coverage: meta.coverage,
      records: null,
      lastUsed: 0,
    });
  }

  console.log(
    datasets.size
      ? `[data] ${datasets.size} dataset(s) restored from ${path.basename(UPLOAD_DIR)}/`
      : '[data] no datasets — upload one via the dashboard or POST /api/datasets'
  );
}

export const DEMO_DATASET_ID = 'demo-sample';
export const DEMO_CITIZENSHIP_DATASET_ID = 'demo-citizenship-sample';

/**
 * Loads the synthetic datasets the demo runs on, one per tracker.
 *
 * Marked `protected` so they cannot be deleted: without that, the first visitor
 * to press Remove would leave the demo permanently empty for everyone after
 * them. The files are committed to the repo and contain no real applicant data.
 */
function seedDemoDataset() {
  const samples = [
    { id: DEMO_DATASET_ID, file: 'sample-dataset.json', name: 'Sample dataset (synthetic)' },
    { id: DEMO_CITIZENSHIP_DATASET_ID, file: 'citizenship-sample-dataset.json', name: 'Sample dataset (synthetic)' },
  ];
  for (const { id, file, name } of samples) {
    const filePath = path.resolve(__dirname, '../demo', file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[data] demo mode, but no sample dataset at ${filePath}`);
      continue;
    }
    datasets.set(id, { id, name, filePath, uploadedAt: null, protected: true, records: null, lastUsed: 0 });
    getRecords(id); // warm it so the first visitor waits on nothing
  }
  console.log('[data] demo mode — synthetic sample datasets loaded, uploads disabled');
}

/**
 * Moves a validated upload out of the staging directory.
 *
 * rename() is the fast path but only works within one filesystem. When
 * UPLOAD_DIR is a mounted volume — any container run with persistent storage —
 * the OS temp dir is a different device and rename() fails with EXDEV, so fall
 * back to a copy. Only EXDEV is caught; a permissions or space error still
 * surfaces rather than being silently retried.
 */
function promote(tempPath, filePath) {
  try {
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(tempPath, filePath);
    fs.rmSync(tempPath, { force: true });
  }
}

/**
 * Adds an uploaded file to the registry. Throws (with .status) if it does not
 * parse or does not look like a case export; the temp file is removed on
 * failure so a bad upload leaves nothing behind.
 */
export function addUpload({ tempPath, originalName }) {
  const id = crypto.randomUUID();
  // The client's filename is never used as a path — only as a display label.
  const filePath = path.join(UPLOAD_DIR, `${id}.json`);

  try {
    const parsed = JSON.parse(fs.readFileSync(tempPath, 'utf8'));
    const { rows, coverage } = inspectPayload(parsed);

    promote(tempPath, filePath);
    const uploadedAt = new Date().toISOString();
    // Persist the summary metadata so a restart can list the dataset without
    // re-parsing the file.
    fs.writeFileSync(
      path.join(UPLOAD_DIR, `${id}.meta`),
      JSON.stringify({ name: originalName, uploadedAt, sourceCount: rows.length, coverage })
    );

    const entry = {
      id,
      name: originalName,
      filePath,
      uploadedAt,
      sourceCount: rows.length,
      coverage,
      records: TRACKERS[coverage.tracker].relabel(rows),
      lastUsed: Date.now(),
    };
    datasets.set(id, entry);
    evictIfNeeded();
    console.log(`[data] uploaded "${originalName}" as ${id} — ${rows.length} ${coverage.tracker} records`);
    return describe(entry);
  } catch (err) {
    fs.rmSync(tempPath, { force: true });
    if (err instanceof SyntaxError) {
      throw Object.assign(new Error(`Not valid JSON: ${err.message}`), { status: 400 });
    }
    throw err;
  }
}

/** Deletes an upload and its sidecar metadata. */
export function removeDataset(id) {
  const entry = datasets.get(id);
  if (!entry) throw Object.assign(new Error(`Unknown dataset: ${id}`), { status: 404 });
  if (entry.protected) {
    throw Object.assign(new Error('The sample dataset cannot be removed.'), { status: 403 });
  }
  fs.rmSync(entry.filePath, { force: true });
  fs.rmSync(path.join(UPLOAD_DIR, `${id}.meta`), { force: true });
  datasets.delete(id);
  console.log(`[data] removed "${entry.name}"`);
}

/** Deletes every removable upload. Protected entries survive. */
export function clearAllDatasets() {
  const removable = [...datasets.values()].filter((d) => !d.protected);
  for (const d of removable) removeDataset(d.id);
  return removable.length;
}

/** Relabeled records for a dataset, loading from disk if not cached. */
export function getRecords(id) {
  const entry = datasets.get(id);
  if (!entry) throw Object.assign(new Error(`Unknown dataset: ${id}`), { status: 404 });
  entry.lastUsed = Date.now();
  if (!entry.records) {
    readAndRelabel(entry);
    evictIfNeeded();
  }
  return entry.records;
}

const describe = (d) => ({
  id: d.id,
  name: d.name,
  protected: Boolean(d.protected),
  uploadedAt: d.uploadedAt,
  sourceCount: d.sourceCount ?? null,
  coverage: d.coverage ?? null,
  tracker: trackerOf(d),
  cached: !!d.records,
});

/** The tracker a dataset came from: 'express-entry' or 'citizenship'. */
export function datasetTracker(id) {
  const entry = datasets.get(id);
  if (!entry) throw Object.assign(new Error(`Unknown dataset: ${id}`), { status: 404 });
  return trackerOf(entry);
}

/** Newest upload first, so the most recent is the natural default. */
export const listDatasets = () =>
  [...datasets.values()]
    .sort((a, b) => String(b.uploadedAt ?? '').localeCompare(String(a.uploadedAt ?? '')))
    .map(describe);

export const hasDataset = (id) => datasets.has(id);

/** The most recent upload, or undefined when nothing is loaded. */
export const defaultDatasetId = () => listDatasets()[0]?.id;
