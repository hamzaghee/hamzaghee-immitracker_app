/** Thin client for the analytics API. Vite proxies /api to localhost:3001. */

/** Thrown on 401 so callers can show the password screen instead of an error. */
export class AuthRequiredError extends Error {
  constructor(message = 'Authentication required.') {
    super(message);
    this.name = 'AuthRequiredError';
    this.code = 'AUTH_REQUIRED';
  }
}

async function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const res = await fetch(`${path}${qs ? `?${qs}` : ''}`);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    let code;
    try {
      const body = await res.json();
      detail = body.error || detail;
      code = body.code;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 || code === 'AUTH_REQUIRED') throw new AuthRequiredError(detail);
    throw new Error(detail);
  }
  return res.json();
}

/* ---------------- auth ---------------- */

export const fetchSession = () => get('/api/auth/session');

export async function login(password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Sign-in failed (HTTP ${res.status})`);
  return body;
}

export const fetchSummary = (params) => get('/api/summary', params);
export const fetchCases = (params) => get('/api/cases', params);
export const fetchHealth = () => get('/api/health');
export const fetchInsights = (params) => get('/api/insights', params);
export const fetchDatasets = () => get('/api/datasets');

/** Uploads a .json export and returns the registered dataset. */
export async function uploadDataset(file) {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/datasets', { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Upload failed (HTTP ${res.status})`);
  return json.dataset;
}

export async function deleteDataset(id) {
  const res = await fetch(`/api/datasets/${id}`, { method: 'DELETE' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Delete failed (HTTP ${res.status})`);
  return json.datasets;
}

/** Removes every uploaded dataset, returning the app to its empty state. */
export async function clearDatasets() {
  const res = await fetch('/api/datasets', { method: 'DELETE' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Clear failed (HTTP ${res.status})`);
  return json;
}

/* ---------------- reports ---------------- */

export const fetchReportOptions = () => get('/api/report-options');

/** Starts a report job. Resolves with the initial job status. */
export async function startReport(config) {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { code: json.code });
  return json;
}

export const fetchReportStatus = (id) => get(`/api/reports/${id}`);
export const fetchReportResult = (id) => get(`/api/reports/${id}/result`);

/**
 * Downloads the report, posting the current section overrides so the file
 * matches what is on screen.
 */
export async function downloadReport(id, format, overrides = {}, theme = 'light') {
  const res = await fetch(`/api/reports/${id}/report.${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overrides, theme }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      detail = (await res.json()).error || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }

  const blob = await res.blob();
  const name =
    res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `report.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return name;
}
