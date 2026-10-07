/**
 * Brand assets inlined into the exported report.
 *
 * The HTML export is self-contained by design, and the PDF renderer blocks
 * every network request, so a font or logo referenced by URL would silently
 * fail in both — the report would quietly fall back to a system sans and show
 * a broken image. Both are read once at startup and embedded as data URIs.
 *
 * Only the latin subset of Mulish is embedded (~30KB, and one variable file
 * covers 400 through 900). The dashboard also serves latin-ext; it is left out
 * here to keep every download smaller, so the handful of extended-latin
 * characters that can appear in country names fall back to the system sans.
 *
 * Read eagerly: a missing asset should fail loudly at boot, not silently
 * degrade every report thereafter.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.resolve(here, '../../../shared');

const dataUri = (file, mime) =>
  `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

export const LOGO_SVG = dataUri(path.join(sharedDir, 'brand/immitracker-logo.svg'), 'image/svg+xml');

const MULISH_WOFF2 = dataUri(path.join(sharedDir, 'fonts/mulish-latin.woff2'), 'font/woff2');

/**
 * `@font-face` for the embedded variable font, ready to concatenate into a
 * style block.
 *
 * Deliberately no `font-display: swap`, which the dashboard does use. Swap
 * paints fallback text immediately and substitutes the real face when it
 * arrives — right for a page someone is waiting on, pointless for a render
 * nobody watches, and a risk when Puppeteer captures as soon as `load` fires.
 * The default (`auto`, which Chrome treats as `block`) holds the text until
 * the face is ready. The font is a data URI with no fetch behind it, so the
 * block period costs nothing.
 *
 * Note that U+2192 (the arrow in "Submission -> PPR") is outside Google's
 * latin subset, so that one glyph falls back to the system sans in both the
 * dashboard and the export. Everything else renders in Mulish.
 */
export const FONT_FACE =
  `@font-face{font-family:'Mulish';font-style:normal;font-weight:400 900;` +
  `src:url(${MULISH_WOFF2}) format('woff2')}`;
