# Immitracker — Express Entry Analytics

A Node backend and Vite/React frontend that replicate the
`Immitracker - Express Entry_Local V.1.0` n8n workflow as a live application.

The n8n workflow read a JSON export from disk, relabeled its opaque field ids,
filtered to the last 18 months, aggregated it, asked an LLM for prose, and
wrote a static `dashboard.html`. Here the same pipeline runs as an HTTP API and
the static HTML is replaced by a React dashboard that queries it.

```
n8n                                    this project
─────────────────────────────────      ─────────────────────────────────────
Read/Write Files from Disk        →    server/src/dataStore.js
Relabel Rows                      →    server/src/pipeline/relabel.js
Filter 18 months                  →    server/src/pipeline/filter.js
Analysis - Code                   →    server/src/pipeline/analyze.js
Analysis - LLM + Output Parser    →    server/src/pipeline/insights.js  (optional — see AI analysis)
Webpage Coder + write dashboard   →    web/  (React, live)
```

## Running it

Two terminals. Node 18+ required (developed on Node 26).

```bash
cd server && npm install && npm start
```

```bash
cd web && npm install && npm run dev
```

Then open <http://localhost:5173>. The API listens on port 3001; Vite proxies
`/api` to it.

> On Windows, if `node` is not on your PATH:
> `$env:Path = "C:\Program Files\nodejs;$env:Path"`

## Deployment modes

One codebase, two deployments, differing only by environment variables.

| | `APP_MODE=demo` | `APP_MODE=production` |
|---|---|---|
| Data | synthetic sample, seeded at boot | empty until the operator uploads |
| Uploads / delete | disabled (**403**) | enabled |
| Password | none | required |

`APP_MODE` defaults to **`production`**: if it is missing or misspelled the app
fails closed rather than open. Production mode refuses to start without
`APP_PASSWORD` and `SESSION_SECRET` — silently falling back to a default
password would look protected while being trivially accessible.

The demo's sample dataset (`server/demo/sample-dataset.json`, ~800 records) is
entirely synthetic — invented usernames, distributions merely shaped like a real
export. Regenerate with `node server/demo/generate-sample.mjs`. It is flagged
non-removable, so a visitor cannot delete it and leave the demo empty for
everyone after.

### Authentication

A single shared password, not user accounts. The gate is **middleware on
`/api/*`**, not just a screen — a login page alone would leave every endpoint
reachable by anyone with the URL. Sessions are signed cookies
(`HttpOnly`, `SameSite=Lax`, `Secure` behind TLS); the password is compared with
`timingSafeEqual`, and sign-in attempts are capped at 8 per 15 minutes.

### Docker

```bash
docker build -t immitracker .
```

The image serves the API and the built frontend from one container and runs as a
**non-root user** (uid 1000). Run it with:

```bash
docker run -p 3001:3001 -e APP_MODE=demo -e PUPPETEER_NO_SANDBOX=1 \
  -e GOOGLE_API_KEY=... immitracker
```

`PUPPETEER_NO_SANDBOX=1` is needed in containers — see the sandbox note under
PDF rendering for what that trades away and why it is acceptable for this
workload.

### Environment

| Variable | Purpose |
|---|---|
| `APP_MODE` | `demo` or `production` (default) |
| `APP_PASSWORD`, `SESSION_SECRET` | required in production |
| `GOOGLE_API_KEY` | Generative Language API key; without it the report still renders, minus the written commentary |
| `GOOGLE_API_KEY_DEMO` | `docker compose` only: becomes the demo service's `GOOGLE_API_KEY`, so the demo never uses the production key. On other hosts, set the demo deployment's own `GOOGLE_API_KEY` instead |
| `LLM_MODEL` | default `gemini-flash-lite-latest`; a `models/` prefix is accepted |
| `LLM_FALLBACK_MODELS` | comma-separated models tried in order when the one before is overloaded; at most three; empty disables — see below |
| `LLM_USE_SCHEMA=0` | escape hatch only; Gemma **requires** the schema — see below |
| `TRUST_PROXY` | set to `1` behind a proxy, or the rate limiter treats every visitor as one client |
| `PUPPETEER_NO_SANDBOX` | set to `1` on Railway and most containers — see the sandbox note below |
| `PORT` | assigned by the host |

## Loading data

**The server starts with no data.** It never reads a file from the project
folder — everything comes from a file you upload. On first run the dashboard
shows an upload prompt and nothing else.

Drop a `.json` export on the prompt, or from the command line:

```bash
curl -F "file=@my-export.json" http://localhost:3001/api/datasets
```

Uploads persist in `server/uploads/` across restarts. Remove one with the
**Remove** link, or wipe them all with **Clear all** (shown once you have two or
more) to get back to the empty state.

## Citizenship reports

Exports from the **Canadian Citizenship Processing Tracker** are recognised on
upload by their field ids (`server/src/pipeline/citizenship/detect.js`), and the
dataset is tagged with its tracker. Each report type runs only on its own
tracker's export: the setup page switches the report type to match the dataset,
and `POST /api/reports` refuses a mismatch with `code: "DATASET_MISMATCH"`.

The report measures the process from start to finish — each step, the total,
and both across province, application type, nationality, IRCC office and the
extra checks (interview, fingerprint request, urgent processing). The rules
behind its figures:

- **The finish line is the decision.** The tracker records no refusals, and
  most applicants leave the decision date blank, so the first later date filled
  in stands in for it: oath letter, then oath ceremony, then certificate. The
  report says how many cases were measured to each.
- **Durations come from the dates**, not the tracker's own "Days from …"
  columns. On the 25 publicly visible cases the two agree on all 76 spans that
  both cover.
- **Groups need 5 decided cases** to appear in a step-by-step chart, and step
  averages need not add up to the total, since each comes from the cases that
  recorded both of its dates.
- **No processing time is broken down by month.** Monthly applications are
  shown as volume only.
- **No comparison with IRCC estimates** — left for a later stage.

The filters are application type and province, and the period is on the
*Application Sent* date. `/api/summary`, `/api/cases` and `/api/insights` remain
Express Entry only. The demo ships a synthetic sample of each tracker;
regenerate the citizenship one with
`node server/demo/generate-citizenship-sample.mjs`.

## Verifying the port

The workflow export carries `pinData` for the "Filter 18 months" node — a real
captured n8n run. The verify script re-runs the ported pipeline over a local
export and diffs the two:

```bash
cd server && npm run verify
```

All 16 checks pass: 1,061 records in both, the same case set by `_slugs`, zero
differing field values, and every aggregate identical.

Two things worth knowing about this check:

- **The clock is pinned.** "Filter 18 months" is a rolling window, while
  `pinData` is frozen, so on the system clock the two drift apart by one case
  per boundary crossing. The script runs the filter against a fixed reference
  instant (`2026-08-11T00:00Z`), derived by sweeping `now` until the pin
  reproduced exactly. A failure is now a real regression, not a calendar
  artifact. It still *reports* the live-clock difference for information.
- **It needs a local export.** Since the server is upload-only, `DATA_PATH`
  exists solely for this offline check. Point it elsewhere with
  `DATA_PATH=... npm run verify`.

## API

| Route | Purpose |
|---|---|
| `GET /api/summary` | The dashboard payload (the "Analysis - Code" output plus a `meta` block) |
| `GET /api/cases` | Paginated case rows — `stream`, `status`, `limit`, `offset`, `sort`, `dir` |
| `GET /api/health` | Mode, dataset registry, LLM and PDF availability |
| `GET /api/insights` | Analysis for an arbitrary slice: the findings, computed sections always, generated ones when a key is set and they pass the fact check |
| `GET /api/datasets` | List uploaded datasets, newest first |
| `POST /api/datasets` | Upload a new export (`multipart/form-data`, field `file`) |
| `DELETE /api/datasets/:id` | Remove one dataset |
| `DELETE /api/datasets` | Remove every dataset (the "Clear all" action) |

`/api/summary`, `/api/cases` and `/api/insights` accept:

- `months` — lookback window. Default `18`; `all` disables the window.
- `dateField` — the anchor date. Default `Submitted`; `AOR Date` also works.
- `dataset` — which dataset to analyse. Defaults to the most recent upload.

With nothing uploaded these return **409** with `code: "NO_DATASET"` — the server
is healthy, there is simply nothing to analyse. The dashboard reads that as
"show the upload prompt".

**With default parameters the analysis reproduces the n8n numbers exactly** for a
given dataset. The dashboard shows an `n8n default` badge whenever the current
slice is that default, and `custom` otherwise.

Further environment: `DATA_PATH`, `UPLOAD_DIR`, `MAX_UPLOAD_MB` (default 250),
`MAX_CACHED_DATASETS` (default 3). See Deployment modes above for the rest.

## AI analysis

The written analysis is built in three steps, so the model explains the data
rather than inventing it:

1. **Find (code).** `pipeline/findings.js` runs a bank of questions over the
   report slice: which months stand apart and why (one extreme case, or a
   cohort from one invitation round), whether recent months only look fast
   because their slow cases are unfinished, which draw categories and
   nationalities differ, what the slowest cases share, whether an additional
   document request goes with a longer wait, and so on. Each question has a
   rule for what counts as notable and a minimum sample. Only the notable
   answers go on, strongest first.
2. **Write (model).** The model turns those findings into an executive summary,
   three to five key takeaways, and at most one short note per chart, placed
   under the chart it explains. It may skip anything the chart already makes
   obvious, so most charts have no note. Figures reach it already rounded the
   way the report prints them, and both model calls get a glossary of the
   report's terms (`pipeline/glossary.js`).
3. **Check.** `pipeline/factCheck.js` checks every generated passage twice and
   removes what fails. First in code: it must cite real findings, sit under one
   of their charts, state each finding's headline number, contain no number
   that is not in its sources, keep every comparison the right way round and
   between the right groups, never give a processing time as a multiple
   ("1.4 times the speed"), never call PPR permanent residence, and offer no
   cause at all for a nationality pattern. The most damaging errors are
   caught here rather than left to a model. Then a
   **separate model call**, with its own reviewer prompt, compares each passage
   with its sources for reversed comparisons, unsupported claims, causes stated
   as fact, and causes suggested for nationality patterns. If the reviewer
   cannot run, nothing generated is published. The report page shows what was
   removed and why; the export does not.

**Extreme cases** are taken out of every processing-time figure rather than
shown alongside: anything more than three interquartile ranges beyond the
middle half of completed cases (`pipeline/outliers.js`, needs at least 20
completed cases). They still count as cases. Each chart they would have changed
says what was excluded, and the analysis can comment on them. `/api/summary`
and `npm run verify` leave them in, so the n8n comparison is unchanged.

## Choosing a model

Measured against this API with the real report prompt and schema, 7 runs each
(October 2026):

| Model | Result |
|---|---|
| `gemini-flash-lite-latest` | 7/7, ~4s — **the default** |
| `gemini-3.5-flash-lite` | 6/7, ~4s — fallback 1 |
| `gemini-3.1-flash-lite` | 4/7, ~2s, otherwise 503 — fallback 2 |
| `gemini-3.7-flash` | 2/7, ~110s, otherwise 503 or timeout — fallback 3 |
| `gemini-flash-latest` | 1/7; 503 or timeout |
| `gemma-4-31b-it`, `gemma-4-26b-a4b-it` | 0/7; 500, 503 or timeout throughout |
| `gemini-pro-latest` | 429 — no free-tier quota |
| `gemini-2.5-flash`, `-flash-lite`, `-pro` | 404 — no longer available to new keys |

When a model is overloaded — 429, 5xx, or no response within 60s — the next
one in the chain is tried without any message to the user; the report's
progress step records which model answered. The writer and the fact check
share a four-minute budget. Other failures (bad key, retired model, malformed output) stop at
once, so a configuration error is not hidden behind the fallbacks.

Three things worth knowing:

- **Gemma requires `responseSchema`.** With `responseMimeType` alone it returns
  its reasoning as prose instead of JSON and the parse fails. This is the
  opposite of what is often assumed, so leave `LLM_USE_SCHEMA` unset.
- **Model ids churn.** Pinned versions get retired and return 404. If generation
  starts failing, list what your key can actually see:
  `curl -H "x-goog-api-key: $KEY" https://generativelanguage.googleapis.com/v1beta/models`
- **`-latest` ids are aliases.** `gemini-flash-lite-latest` follows Google's
  newest Flash-Lite release, so it is not retired the way pinned ids are, but
  its output can shift when Google repoints it. Set `LLM_MODEL` to a pinned id
  such as `gemini-3.5-flash-lite` if consistency matters more.

Whatever happens here, the report still renders — the written commentary is the
only part that depends on the model.

## Rate limiting

Generating a report runs a language model and rendering a PDF drives a browser,
so the endpoints that cost real work are capped at **10 requests per minute and
100 per 24 hours** per client: report creation, both downloads, dataset upload
and delete, and `/api/insights`. Exceeding either returns **429** with
`code: "RATE_LIMITED"` and a `Retry-After` header.

**Job-status polling is on a separate, much larger budget** (300/minute). The
report page polls roughly every 1.5s while the model works, so a single
two-minute report is ~80 status calls on its own — counting those against the
10/minute budget would break normal use within seconds of the first report.

Tunable via `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_DAY`,
`RATE_LIMIT_POLL_PER_MINUTE`.

Two deployment notes:

- Counting is **per-IP and in-memory**, which is correct for a single instance.
  Running several instances multiplies the effective budget; that needs a shared
  store such as Redis.
- `TRUST_PROXY` is **unset by default**, so clients are identified by socket
  address. Set it to the number of proxies in front of the app when deploying
  behind one — a permissive setting with no proxy present lets a caller spoof
  `X-Forwarded-For` and reset their own counter.

## PDF rendering

Puppeteer renders the same HTML the download serves. The browser is reused for
speed but health-checked before every render and relaunched if its connection
has dropped. Each report renders in its own browser context with scripting
disabled and all network requests blocked — the document is self-contained, so
an outbound request would be a bug or an exfiltration attempt.

### The sandbox, and why it is off in containers

Chromium's sandbox is **on by default**, but it needs unprivileged user
namespaces. Most container runtimes do not grant those, and Railway gives no
control over container capabilities at all, so **`PUPPETEER_NO_SANDBOX=1` is
required there**. Without it every PDF fails with `No usable sandbox!`.

That is a real reduction in defence, so it is worth being precise about what it
costs *here*. The sandbox exists to contain a hostile web page escaping the
renderer. This renderer never meets one:

- the HTML is generated by this server, not fetched
- JavaScript is disabled (`setJavaScriptEnabled(false)`)
- every network request is blocked, so nothing external can load
- no user-supplied URL or third-party content is ever rendered

What remains is a parser bug in Chromium triggered by our own markup — far
narrower than the threat the sandbox is designed for. The container also runs as
a **non-root user**, so a renderer compromise still lands unprivileged.

If you deploy somewhere that *can* grant `--cap-add=SYS_ADMIN` or a suitable
seccomp profile, leave the sandbox on and drop the variable.

Concurrent renders are capped (`PDF_MAX_CONCURRENT`, default 2).

On startup the server clears browser processes stranded by a previous forced
shutdown. Matching is by executable path under Puppeteer's own cache directory,
never by process name — a name match would also hit your everyday Chrome.

## Upload validation

A file is rejected if it is not valid JSON, is not an array of objects (an
object wrapping a `data` or `records` array is also accepted), is empty, or
exceeds the size limit — rejected uploads are not persisted. A file that parses
but contains none of the 32 known Immitracker field ids is accepted with a
visible warning, since the charts would otherwise just be silently empty.

Memory, measured rather than estimated: a 46 MB export takes peak RSS from
~60 MB to **~240 MB**. Parsed records are cached for at most
`MAX_CACHED_DATASETS` datasets at a time (least-recently-used dropped first,
then re-read from disk on next use), so peak is roughly
`60 MB + 180 MB × datasets + ~400 MB while a PDF renders`. A 1 GB instance is
enough; 2 GB is comfortable.

## Two deliberate deviations from the workflow

**1. Month bucketing uses UTC.** The n8n code called `getFullYear()` /
`getMonth()` on UTC-midnight timestamps. n8n ran in a UTC container so that was
correct there, but the same code on a machine in `America/Toronto` rolls each
date back into the previous month. `analyze.js` uses the UTC accessors, which
reproduces the numbers n8n actually produced. `npm run verify` prints both
bucketings so you can see the difference in your own timezone.

**2. The three milestone charts are stat tiles.** The workflow rendered AOR→Meds,
AOR→BIL and Meds→PPR as single-bar bar charts. A one-bar bar chart is just a
number wearing a chart costume, so each is a tile showing mean, median and
sample size.

## A caveat about the 18-month window

The n8n default filters on `Submitted`, and many exports populate that field far
less often than `AOR Date`. In the reference export only **3,319 of 14,636**
cases carry a `Submitted` value, so the default view describes about **1,060**
cases — roughly 7% of the file — while `AOR Date` is present on **14,504**. The
filter row lets you switch the anchor. The default is left as the workflow had
it so the app matches n8n out of the box; the header states the reachable count
for whichever anchor is selected.

The window is also *rolling* — measured from today — so the case count drifts
down by one as older submissions age past the 18-month boundary.

## Notes on the dashboard

Charts are hand-rolled SVG — no charting dependency. The categorical palette was
run through a colorblind-safety validator and passes every gate in both light
and dark mode. Because three light-mode series colours fall below 3:1 contrast
against the surface, **every chart has a table-view twin** (the `Chart` /`Table`
toggle on each card), so no value is reachable by colour alone.

Stream colours are fixed per stream, not assigned by rank, so changing the
filter never repaints a stream that survives it.
