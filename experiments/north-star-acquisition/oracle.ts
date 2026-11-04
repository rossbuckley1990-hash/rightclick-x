// Independent Markdown link-extraction oracle.
//
// Authored from the CommonMark link rules for this experiment. It imports nothing from
// RightClick X and nothing from lychee, and it does not read RightClick X output: it is a
// witness, not a transcription. Its expectations are written to evidence/ BEFORE any product
// run is compared against them (see PREDICTIONS.md for the predeclaration protocol).
//
// Deliberately explicit about what is spec and what is an extension: bare-URL autolinking is
// a GitHub Flavoured Markdown extension, not CommonMark, so those destinations are reported in
// a separate bucket and never counted as a hard expectation.

export interface OracleResult {
  fixture: string;
  /** Every destination the CommonMark rules yield, in document order. */
  links: string[];
  /** Sorted, de-duplicated absolute http(s) destinations. */
  absoluteHttp: string[];
  /** Sorted, de-duplicated mailto destinations. */
  mailto: string[];
  /** Sorted, de-duplicated destinations that are not absolute and not mailto. */
  relative: string[];
  /** Bare URLs, which only the GFM extension autolinks. Reported, never expected. */
  extensionDependentBareUrls: string[];
  /** Destinations that appear only inside code or comments, i.e. must NOT be extracted. */
  excludedByCodeOrComment: string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*$/;
const REF_DEF = /^ {0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.\-]*:/;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Replace every character of code spans, fenced code and HTML comments with a space.
 *  Offsets are preserved so the remaining scan sees the document's real positions. */
function maskNonLinkRegions(src: string): { text: string; masked: string[] } {
  const chars = [...src];
  const mask = chars.map(() => false);
  const masked: string[] = [];
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < mask.length; i++) mask[i] = true;
    masked.push(src.slice(from, to));
  };

  // Fenced code blocks.
  const lines: Array<{ start: number; end: number; text: string }> = [];
  let pos = 0;
  for (const line of src.split("\n")) {
    lines.push({ start: pos, end: pos + line.length, text: line });
    pos += line.length + 1;
  }
  let openFence: { marker: string; from: number } | null = null;
  for (const l of lines) {
    const m = FENCE.exec(l.text);
    if (!openFence) {
      if (m) { openFence = { marker: m[1][0].repeat(3), from: l.start }; }
    } else if (m && m[1][0] === openFence.marker[0] && m[1].length >= openFence.marker.length && l.text.trim() === m[1]) {
      blank(openFence.from, l.end);
      openFence = null;
    }
  }
  if (openFence) blank(openFence.from, src.length);

  // HTML comments (may span lines, and may sit inside regions already masked).
  for (const m of src.matchAll(HTML_COMMENT)) blank(m.index!, m.index! + m[0].length);

  // Inline code spans: a run of N backticks closes at the next run of exactly N.
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "`" || mask[i]) continue;
    let n = 0;
    while (i + n < chars.length && chars[i + n] === "`") n++;
    const openLen = n;
    let j = i + n;
    while (j < chars.length) {
      if (chars[j] === "`") {
        let k = 0;
        while (j + k < chars.length && chars[j + k] === "`") k++;
        if (k === openLen) { blank(i, j + k); i = j + k - 1; break; }
        j += k;
      } else j++;
    }
    if (j >= chars.length) i += openLen;
  }

  let text = "";
  for (let i = 0; i < chars.length; i++) text += mask[i] ? " " : chars[i];
  return { text, masked };
}

/** Find the index just past the delimiter that closes the one at `open`, honouring nesting and backslash escapes. */
function matchDelimiter(s: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

function splitDestination(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("<") && t.endsWith(">")) return t.slice(1, -1);
  return t.split(/\s+/)[0] ?? "";
}

export function extractLinks(fixture: string, src: string): OracleResult {
  const { text, masked } = maskNonLinkRegions(src);
  const lines: Array<{ start: number; text: string }> = [];
  let pos = 0;
  for (const line of text.split("\n")) { lines.push({ start: pos, text: line }); pos += line.length + 1; }

  // 1. Link reference definitions, collected and then removed from inline scanning.
  const defs = new Map<string, string>();
  const defSpans: Array<[number, number]> = [];
  for (const l of lines) {
    const m = REF_DEF.exec(l.text);
    if (!m) continue;
    defs.set(m[1].trim().toLowerCase().replace(/\s+/g, " "), splitDestination(m[2]));
    defSpans.push([l.start, l.start + l.text.length]);
  }
  let body = text;
  for (const [from, to] of defSpans) body = body.slice(0, from) + " ".repeat(to - from) + body.slice(to);

  const links: string[] = [];

  // 2. Autolinks: <scheme:...> and <email>.
  for (const m of body.matchAll(/<([^<>\n]*)>/g)) {
    const inner = m[1];
    if (!inner) continue;
    if (SCHEME.test(inner)) links.push(inner);
    else if (EMAIL.test(inner)) links.push(`mailto:${inner}`);
  }

  // 3. Inline and reference links, including images. Balanced-bracket scan.
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") { i++; continue; }
    if (body[i] !== "[") continue;
    const afterText = matchDelimiter(body, i, "[", "]");
    if (afterText < 0) continue;
    if (body[afterText] === "(") {
      const afterDest = matchDelimiter(body, afterText, "(", ")");
      if (afterDest < 0) continue;
      const dest = splitDestination(body.slice(afterText + 1, afterDest - 1));
      if (dest) links.push(dest);
      i = afterDest - 1;
      continue;
    }
    if (body[afterText] === "[") {
      const afterLabel = matchDelimiter(body, afterText, "[", "]");
      if (afterLabel > 0) {
        const label = body.slice(afterText + 1, afterLabel - 1).trim();
        const key = (label || body.slice(i + 1, afterText - 1)).trim().toLowerCase().replace(/\s+/g, " ");
        const dest = defs.get(key);
        if (dest) { links.push(dest); i = afterLabel - 1; continue; }
      }
    }
    // Shortcut reference: [label] with a matching definition.
    const key = body.slice(i + 1, afterText - 1).trim().toLowerCase().replace(/\s+/g, " ");
    const dest = key ? defs.get(key) : undefined;
    if (dest) { links.push(dest); i = afterText - 1; }
  }

  // 4. Bare URLs: a GFM extension. Reported separately; never a hard expectation.
  const bareUrls: string[] = [];
  for (const m of body.matchAll(/(?<![[(\w"'])\bhttps?:\/\/[^\s<>)\]]+/g)) bareUrls.push(m[0]);

  const absolute = links.filter((l) => /^https?:/i.test(l));
  const mailto = links.filter((l) => /^mailto:/i.test(l));
  const other = links.filter((l) => !/^https?:|^mailto:/i.test(l));
  const excluded = [...masked].flatMap((region) => [...region.matchAll(/\bhttps?:\/\/[^\s<>"'\x60)]+/g)].map((m) => m[0]));

  const sorted = (xs: string[]) => [...new Set(xs)].sort();
  return {
    fixture,
    links,
    absoluteHttp: sorted(absolute),
    mailto: sorted(mailto),
    relative: sorted(other),
    extensionDependentBareUrls: sorted(bareUrls),
    excludedByCodeOrComment: sorted(excluded),
  };
}
