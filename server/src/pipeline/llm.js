/**
 * Calls to Google's Generative Language API.
 *
 * Shared by the two model calls in a report — the writer and the separate fact
 * check — so both get the same fallback chain, timeouts and error handling.
 *
 * The key travels in the x-goog-api-key header rather than the query string, so
 * it cannot end up in request logs, proxy access logs or browser history, and it
 * is never returned to the client.
 */

const API_BASE =
  process.env.LLM_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';

/**
 * The API lists models as "models/<id>", and the URL this builds already
 * includes that segment — so strip the prefix rather than producing
 * ".../models/models%2F<id>", which 404s. Copying an id straight from the
 * models listing is the obvious thing to do, so it should just work.
 */
const normaliseModel = (m) => String(m || '').replace(/^models\//, '').trim();

/**
 * Measured on this API against the real report prompt and schema, 7 runs each
 * (October 2026):
 *
 *   gemini-flash-lite-latest  7/7, ~4s                     <- default
 *   gemini-3.5-flash-lite     6/7, ~4s                     <- fallback 1
 *   gemini-3.1-flash-lite     4/7, ~2s, otherwise 503      <- fallback 2
 *   gemini-3.7-flash          2/7, ~110s, otherwise 503    <- fallback 3
 *   gemma-4-31b-it            0/7, 500 / 503 throughout
 *   gemini-flash-latest       1/7, 503 or timeout
 *   gemini-2.5-*              404, no longer available to new keys
 *   gemini-pro-latest         429, no free-tier quota
 *
 * Override with LLM_MODEL; a "models/" prefix is accepted.
 */
export const LLM_MODEL = normaliseModel(process.env.LLM_MODEL) || 'gemini-flash-lite-latest';

/**
 * Models tried in order when the one before is overloaded. Override with a
 * comma-separated LLM_FALLBACK_MODELS; set it empty to disable fallback. The
 * primary is never repeated, and at most three fallbacks are used.
 */
const MAX_FALLBACKS = 3;
export const FALLBACK_MODELS = [
  ...new Set(
    (process.env.LLM_FALLBACK_MODELS ?? 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.7-flash')
      .split(',')
      .map(normaliseModel)
      .filter((m) => m && m !== LLM_MODEL)
  ),
].slice(0, MAX_FALLBACKS);
const MODEL_CHAIN = [LLM_MODEL, ...FALLBACK_MODELS];

/**
 * Overload signals — the only failures worth moving to the next model on. A
 * bad key (400/403) or retired model (404) fails the same way everywhere, so
 * those return at once rather than hiding a configuration error behind the
 * fallbacks.
 */
const OVERLOAD_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Per-attempt limit. Healthy responses arrive in seconds; an overloaded model
 * tends to hang until the timeout, so a full two minutes per attempt across
 * four models would stall the report for eight.
 */
export const ATTEMPT_TIMEOUT_MS = 60000;

/**
 * Send `responseSchema` alongside the JSON mime type.
 *
 * Measured against this API: Gemma **requires** the schema. With the mime type
 * alone it returns its reasoning as prose rather than JSON, and the parse
 * fails. LLM_USE_SCHEMA=0 remains as an escape hatch for a model that rejects
 * the schema outright, but it should not be needed for Gemma or Gemini.
 */
const USE_SCHEMA = process.env.LLM_USE_SCHEMA !== '0';

export const llmConfigured = () => Boolean(API_KEY);

/**
 * Whether generated prose is configured. Reports configuration only — it does
 * not call the API, so it stays cheap enough for the health endpoint. The key
 * itself is never included in the result.
 */
export function probeLlm() {
  return {
    available: Boolean(API_KEY),
    provider: 'google-generative-language',
    model: LLM_MODEL,
    fallbackModels: FALLBACK_MODELS,
    reason: API_KEY ? undefined : 'GOOGLE_API_KEY is not set',
  };
}

/**
 * A model told to emit JSON often wraps it in a fenced block anyway. Strip that
 * before parsing rather than failing the whole report over punctuation.
 */
export function parseJsonLoosely(text) {
  const trimmed = String(text || '').trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // Last resort: the outermost object in the response.
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error('response was not JSON');
  }
}

/**
 * One generateContent call. Never throws. `overloaded` marks the failures that
 * justify trying the next model.
 */
async function callModel(model, prompt, schema, timeoutMs) {
  try {
    const res = await fetch(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header rather than ?key= so the secret stays out of any URL log.
        'x-goog-api-key': API_KEY,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          ...(USE_SCHEMA && schema ? { responseSchema: schema } : {}),
        },
      }),
    });

    if (!res.ok) {
      // Surface the API's own message, which distinguishes a bad key from a bad
      // model name from a quota trip — but never echo the key back.
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        detail = errBody?.error?.message || detail;
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, overloaded: OVERLOAD_STATUSES.has(res.status), reason: `${model}: ${detail}` };
    }

    const body = await res.json();
    const candidate = body?.candidates?.[0];
    const finish = candidate?.finishReason;

    if (!candidate || (finish && finish !== 'STOP')) {
      return {
        ok: false,
        reason: `${model} returned no usable output (finishReason: ${finish || 'none'})`,
      };
    }

    const text = (candidate.content?.parts || []).map((p) => p.text || '').join('');
    if (!text.trim()) return { ok: false, reason: `${model} returned an empty response` };
    return { ok: true, text };
  } catch (err) {
    // A timeout is how an overloaded model usually fails; a dropped connection
    // ("fetch failed") is treated the same.
    const overloaded = err.name === 'TimeoutError' || err.name === 'TypeError';
    const reason = err.name === 'TimeoutError' ? 'no response before the timeout' : err.message;
    return { ok: false, overloaded, reason: `${model}: ${reason}` };
  }
}

/**
 * Runs a prompt down the model chain until one answers with parseable JSON.
 * Never throws.
 *
 * When a model is overloaded the next one is tried, silently: the caller only
 * learns which model answered.
 *
 * @param {object} args
 * @param {string} args.prompt
 * @param {object} args.schema responseSchema for the call
 * @param {number} args.deadline epoch ms after which no new attempt starts
 * @param {number} [args.timeoutMs] per-attempt cap
 * @returns {Promise<{ok:true, json:object, model:string} | {ok:false, reason:string}>}
 */
export async function generateJson({ prompt, schema, deadline, timeoutMs = ATTEMPT_TIMEOUT_MS }) {
  if (!API_KEY) return { ok: false, reason: 'No GOOGLE_API_KEY configured' };

  let result;
  const tried = [];
  for (const [i, model] of MODEL_CHAIN.entries()) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) {
      if (!result) result = { ok: false, reason: 'no time left for the model call' };
      break;
    }

    tried.push(model);
    result = await callModel(model, prompt, schema, Math.min(timeoutMs, remaining));
    if (result.ok) {
      try {
        return { ok: true, json: parseJsonLoosely(result.text), model };
      } catch (err) {
        return { ok: false, reason: `${model}: ${err.message}` };
      }
    }
    if (!result.overloaded) break;

    const next = MODEL_CHAIN[i + 1];
    if (next) console.warn(`[llm] ${result.reason} — trying ${next}`);
  }

  const reason =
    result.overloaded && tried.length > 1
      ? `All ${tried.length} models were busy (${tried.join(', ')}). Last error: ${result.reason}`
      : result.reason;
  return { ok: false, reason };
}
