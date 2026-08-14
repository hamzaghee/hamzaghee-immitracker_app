/**
 * Text helpers shared by the React dashboard and the server's report renderer.
 *
 * Both surfaces must format identically — the asterisks bug came from the two
 * treating the same string differently — so the logic lives here once.
 */

/* ---------------- country codes ---------------- */

/**
 * Intl.DisplayNames is comparatively expensive to construct, so build it once
 * and reuse. Wrapped because a runtime without full ICU throws on construction.
 */
let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  regionNames = null;
}

const overrides = {
  // Intl renders these with an administrative suffix that adds nothing on a
  // chart axis and costs a lot of width.
  HK: 'Hong Kong',
  MO: 'Macao',
};

/**
 * "IN" -> "India". Returns the input unchanged when it is not a resolvable
 * two-letter region code, so unexpected values pass through rather than
 * becoming blank labels.
 */
export function countryName(code) {
  const raw = String(code ?? '').trim();
  if (!/^[A-Za-z]{2}$/.test(raw)) return raw;
  const upper = raw.toUpperCase();
  if (overrides[upper]) return overrides[upper];
  try {
    return regionNames?.of(upper) || raw;
  } catch {
    return raw;
  }
}

/** Builds a { code: name } lookup for the codes present in the given maps. */
export function countryNameMap(...objects) {
  const out = {};
  for (const obj of objects) {
    for (const code of Object.keys(obj || {})) {
      out[code] = countryName(code);
    }
  }
  return out;
}

/* ---------------- section provenance ---------------- */

/**
 * Label for the tag on an analysis section, so a reader can tell at a glance
 * which sentences a model wrote and which were computed from the data.
 *
 * Shared by the dashboard and the exported report — the two rendered the same
 * text differently once before, and this keeps the wording in one place.
 * CSS uppercases it, so these are written in sentence case.
 */
export function sectionTagLabel(source) {
  switch (source) {
    case 'ai':
      return 'AI Analysis';
    case 'computed':
      return 'Computed';
    case 'edited':
      return 'Edited';
    default:
      return null;
  }
}

/* ---------------- inline emphasis ---------------- */

/**
 * Splits markdown-style `**bold**` into runs.
 *
 * The local model emits these markers whether or not it is asked to. The HTML
 * export converted them; the React view did not, so the asterisks were visible
 * on screen but not in the download. Both now use this.
 *
 * @param {string} text
 * @returns {{text: string, bold: boolean}[]}
 */
/** Loose comparison for "is this line just a repeat of the heading?" */
const normaliseHeading = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&(amp;)?/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Parses a section body into renderable blocks.
 *
 * The local model returns markdown whatever the prompt says: it repeats the
 * section heading as the first line and writes `-` / `*` bullet lists. Rendered
 * as raw text those markers are visible on screen and in the export, which is
 * the "code showing in the report" defect. Rather than printing the syntax, or
 * stripping it and losing the structure, parse it and render real paragraphs
 * and lists.
 *
 * @param {string} text
 * @param {{title?: string}} [options] drops a leading line repeating the title
 * @returns {({type:'p', runs:object[]}|{type:'ul', items:object[][]})[]}
 */
export function parseRichText(text, { title } = {}) {
  const lines = String(text ?? '').split(/\r?\n/);
  const wantedTitle = title ? normaliseHeading(title) : null;

  // Drop leading blanks, then a heading line echoing the section title.
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (wantedTitle && i < lines.length) {
    const candidate = normaliseHeading(lines[i].replace(/^#+\s*/, ''));
    if (candidate && candidate === wantedTitle) i += 1;
  }

  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    const joined = paragraph.join(' ').trim();
    if (joined) blocks.push({ type: 'p', runs: splitBold(joined) });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ type: 'ul', items: list });
    list = null;
  };

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const bullet = line.match(/^\s*[-*•·]\s+(.*)$/);

    if (bullet) {
      flushParagraph();
      (list ||= []).push(splitBold(bullet[1].trim()));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    // Markdown headings inside a body are noise; keep the words, drop the hashes.
    paragraph.push(line.replace(/^#+\s*/, '').trim());
  }
  flushParagraph();
  flushList();

  return blocks;
}

export function splitBold(text) {
  const s = String(text ?? '');
  const runs = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;

  while ((m = re.exec(s)) !== null) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ text: s.slice(last), bold: false });

  return runs.length ? runs : [{ text: s, bold: false }];
}
