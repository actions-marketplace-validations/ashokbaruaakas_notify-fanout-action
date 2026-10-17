/**
 * A message as a flat list of text runs, each carrying the formatting marks
 * around it (outermost first). Splitting works on visible text, and each
 * chunk is serialized independently, so tags are always balanced: a mark
 * cut by a chunk boundary is closed at the end of one chunk and reopened at
 * the start of the next.
 */
export interface Mark {
  /** Native markup that opens and closes this mark. */
  open: string;
  close: string;
}

export interface Run {
  /** Visible text. Telegram's 4096-character limit counts this, not markup. */
  text: string;
  /** Shared by identity between runs inside the same element. */
  marks: readonly Mark[];
  /** Escapes the text for where it sits (code spans escape differently in MarkdownV2). */
  escape: (text: string) => string;
}

export function serialize(runs: readonly Run[]): string {
  let out = '';
  let open: readonly Mark[] = [];
  for (const run of runs) {
    let common = 0;
    while (common < open.length && open[common] === run.marks[common]) common++;
    for (let k = open.length - 1; k >= common; k--) out += open[k]?.close ?? '';
    for (let k = common; k < run.marks.length; k++) out += run.marks[k]?.open ?? '';
    open = run.marks;
    out += run.escape(run.text);
  }
  for (let k = open.length - 1; k >= 0; k--) out += open[k]?.close ?? '';
  return out;
}

export const visibleLength = (runs: readonly Run[]): number =>
  runs.reduce((sum, run) => sum + run.text.length, 0);

/** The runs covering visible positions [start, end). */
function slice(runs: readonly Run[], start: number, end: number): Run[] {
  const result: Run[] = [];
  let offset = 0;
  for (const run of runs) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + run.text.length);
    if (from < to) result.push({ ...run, text: run.text.slice(from - offset, to - offset) });
    offset += run.text.length;
    if (offset >= end) break;
  }
  return result;
}

const SEPARATORS = ['\n\n', '\n', ' '];
const WHITESPACE = /\s/;

/**
 * Splits runs into chunks of at most `limit` visible characters, preferring
 * paragraph breaks, then line breaks, then spaces. The separator at a cut is
 * dropped, chunk edges are trimmed, and whitespace-only chunks are removed.
 */
export function splitRuns(runs: readonly Run[], limit: number): Run[][] {
  const text = runs.map((run) => run.text).join('');
  const chunks: Run[][] = [];
  let start = 0;
  while (start < text.length) {
    let cut = Math.min(start + limit, text.length);
    let next = cut;
    if (cut < text.length) {
      const window = text.slice(start, cut);
      const found = SEPARATORS.map((sep) => ({ sep, at: window.lastIndexOf(sep) })).find(
        ({ at }) => at >= limit / 2,
      );
      if (found) {
        cut = start + found.at;
        next = cut + found.sep.length;
      } else if (/[\uD800-\uDBFF]/.test(text.charAt(cut - 1))) {
        // Never split a surrogate pair.
        cut--;
        next = cut;
      }
    }
    // Trim whitespace at chunk edges; whitespace-only chunks vanish.
    let from = start;
    while (from < cut && WHITESPACE.test(text.charAt(from))) from++;
    let to = cut;
    while (to > from && WHITESPACE.test(text.charAt(to - 1))) to--;
    if (from < to) chunks.push(slice(runs, from, to));
    start = next;
  }
  return chunks;
}
