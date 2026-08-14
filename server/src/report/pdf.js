/**
 * HTML → PDF via Puppeteer.
 *
 * Renders the same document the HTML download serves, so the two exports cannot
 * disagree.
 *
 * Written for a service that will eventually face the internet:
 *
 *   Reliability — the browser is reused for speed but checked for liveness
 *   before every render and relaunched if the connection has dropped. The
 *   previous version cached the handle forever, so once Chromium died every
 *   export failed permanently with "Connection closed" until a restart.
 *
 *   Isolation — each report renders in its own browser context, with scripting
 *   off and every network request blocked. The report is self-contained, so a
 *   page that tries to reach the network is either a bug or an exfiltration
 *   attempt, and neither should be permitted.
 *
 *   Containment — Chromium's sandbox stays ON. Disabling it removes the main
 *   barrier if a renderer is ever compromised; it is opt-in for container
 *   images that genuinely cannot provide the required namespaces.
 *
 *   Capacity — concurrent renders are capped. Each page costs real memory, and
 *   an uncapped expensive endpoint is a denial-of-service invitation.
 */

import { execFile } from 'node:child_process';

/** Opt-in escape hatch for restricted containers. Off by default, on purpose. */
const NO_SANDBOX = process.env.PUPPETEER_NO_SANDBOX === '1';
const MAX_CONCURRENT = Number(process.env.PDF_MAX_CONCURRENT) || 2;
const IDLE_SHUTDOWN_MS = Number(process.env.PDF_IDLE_MS) || 5 * 60 * 1000;
const RENDER_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS) || 60000;

let browserPromise = null;
let idleTimer = null;
let active = 0;
const waiters = [];

/* ---------------- concurrency ---------------- */

function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  const next = waiters.shift();
  if (next) next();
  else active = Math.max(0, active - 1);
}

/* ---------------- browser lifecycle ---------------- */

function scheduleIdleShutdown() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (active > 0) return;
    const p = browserPromise;
    browserPromise = null;
    Promise.resolve(p)
      .then((b) => b?.close())
      .catch(() => {});
  }, IDLE_SHUTDOWN_MS);
  idleTimer.unref?.();
}

async function launch() {
  const { default: puppeteer } = await import('puppeteer');
  const args = ['--disable-dev-shm-usage', '--disable-gpu'];
  if (NO_SANDBOX) args.push('--no-sandbox', '--disable-setuid-sandbox');

  const browser = await puppeteer.launch({ headless: true, args });

  // A dropped connection must invalidate the cache, or every later render
  // fails against a dead handle — the bug this replaces. Clearing
  // unconditionally is safe: getBrowser() liveness-checks before reuse, so at
  // worst a healthy handle is dropped and immediately relaunched.
  browser.once('disconnected', () => {
    browserPromise = null;
  });
  return browser;
}

/** A live browser, relaunching if the cached one has gone away. */
async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      const alive = typeof existing.connected === 'boolean' ? existing.connected : existing.isConnected?.();
      if (alive) return existing;
    } catch {
      /* fall through and relaunch */
    }
    browserPromise = null;
  }

  browserPromise = launch().catch((err) => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

/* ---------------- rendering ---------------- */

async function renderOnce(html) {
  const browser = await getBrowser();
  // Per-render context: no cookies, storage or cache shared between reports.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    // The document inlines everything it needs, so nothing should go out.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('about:')) req.continue();
      else req.abort();
    });

    await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
    await page.emulateMediaType('print');

    // page.pdf() returns a Uint8Array in Puppeteer 23+. Express serialises a
    // bare Uint8Array as JSON, so wrap it — otherwise the download is a byte map.
    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      timeout: RENDER_TIMEOUT_MS,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      // Page numbers only. The removed report footer was body content; page
      // numbering is print furniture and stays.
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#898781;
        font-family:system-ui,sans-serif;padding:0 12mm;text-align:right">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>`,
    });
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  } finally {
    await context.close().catch(() => {});
  }
}

/** Puppeteer's wording when the browser handle is dead rather than the page. */
const isStaleConnection = (err) =>
  /connection closed|target closed|session closed|browser has disconnected|protocol error/i.test(
    err?.message || ''
  );

/**
 * @param {string} html a complete document
 * @returns {Promise<Buffer>}
 */
export async function htmlToPdf(html) {
  await acquire();
  try {
    try {
      return await renderOnce(html);
    } catch (err) {
      // One retry, but only for a dead browser — a genuine render failure
      // should surface immediately rather than be attempted twice.
      if (!isStaleConnection(err)) throw err;
      browserPromise = null;
      return await renderOnce(html);
    }
  } catch (err) {
    // Chromium's sandbox needs unprivileged user namespaces. Most container
    // runtimes — Railway included — don't grant them, and the raw failure is a
    // wall of stack trace, so name the fix rather than making someone decode it.
    const sandboxFailure = /no usable sandbox|SUID sandbox|user namespace/i.test(err.message || '');
    const hint = sandboxFailure
      ? 'Chromium could not start its sandbox, which containers usually cannot provide. ' +
        'Set PUPPETEER_NO_SANDBOX=1 — see the PDF rendering notes in the README for why that is acceptable here.'
      : 'If this persists, check that Puppeteer\'s browser is installed ("npx puppeteer browsers install chrome").';

    throw Object.assign(new Error(`PDF rendering failed: ${err.message.split('\n')[0]}. ${hint}`), {
      status: 503,
      code: sandboxFailure ? 'PDF_SANDBOX_UNAVAILABLE' : 'PDF_FAILED',
    });
  } finally {
    release();
    scheduleIdleShutdown();
  }
}

/**
 * Terminates browser processes left behind by a previous run.
 *
 * A forced kill (SIGKILL, Stop-Process -Force, a crashed container) bypasses
 * every in-process shutdown hook, so Chromium survives its parent and holds
 * ~200 MB each. Across restarts these accumulate.
 *
 * Matching is by **executable path under Puppeteer's browser cache**, never by
 * process name: "chrome" also matches the user's own browser, and a name-based
 * sweep would close their tabs. Anything outside that directory is left alone.
 *
 * Best effort — failures are logged and ignored, never fatal.
 */
export async function reapOrphanedBrowsers() {
  let browsersPath = process.env.PUPPETEER_CACHE_DIR || null;

  if (!browsersPath) {
    try {
      const { default: puppeteer } = await import('puppeteer');
      // executablePath() resolves to a promise in Puppeteer 23+, and
      // `configuration` is a function rather than an object — awaiting the
      // resolved path is the only reliable source for the install location.
      const exe = await puppeteer.executablePath();
      const marker = `${sep()}puppeteer${sep()}`;
      const at = String(exe || '').indexOf(marker);
      // Trim to the cache root, e.g. C:\Users\me\.cache\puppeteer
      if (at >= 0) browsersPath = String(exe).slice(0, at + marker.length - 1);
    } catch (err) {
      return { killed: 0, reason: `could not resolve browser path (${err.message})` };
    }
  }
  if (!browsersPath) return { killed: 0, reason: 'browser cache path unknown' };

  const ownPid = process.pid;

  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Query by ExecutablePath so only Puppeteer's own browser matches.
      const script = `
        $p = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='chrome-headless-shell.exe'" |
             Where-Object { $_.ExecutablePath -like '${browsersPath.replace(/'/g, "''")}*' }
        if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count } else { 0 }`;
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 15000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve({ killed: 0, reason: err.message });
          resolve({ killed: Number(String(stdout).trim()) || 0 });
        }
      );
    } else {
      execFile('/bin/sh', ['-c', `pgrep -f '^${browsersPath}' || true`], { timeout: 15000 }, (err, stdout) => {
        if (err) return resolve({ killed: 0, reason: err.message });
        const pids = String(stdout)
          .split('\n')
          .map((s) => Number(s.trim()))
          .filter((n) => n && n !== ownPid);
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }
        resolve({ killed: pids.length });
      });
    }
  });
}

const sep = () => (process.platform === 'win32' ? '\\' : '/');

/** True when a PDF render is likely to succeed. */
export async function pdfAvailable() {
  try {
    await import('puppeteer');
    return true;
  } catch {
    return false;
  }
}

/** Closes the browser. Exported so shutdown paths can await it. */
export async function closeRenderer() {
  clearTimeout(idleTimer);
  const p = browserPromise;
  browserPromise = null;
  try {
    await (await p)?.close();
  } catch {
    /* shutting down anyway */
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    closeRenderer().finally(() => process.exit(0));
  });
}
process.once('exit', () => {
  // Best effort — a synchronous hook cannot await, and SIGKILL bypasses this
  // entirely, which is why orphaned Chromium can survive a forced kill.
  browserPromise = null;
});
