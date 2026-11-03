import { decodeEntities, normalize } from "./matching.ts";
export interface SourceContext {
  before: string;
  match: string;
  after: string;
}
export function extractContext(page: string, quote: string): SourceContext {
  const text = decodeEntities(page).normalize("NFKC");
  const target = normalize(quote);
  if (!target) throw new Error("Empty evidence quote");
  let folded = "";
  const offsets: number[] = [];
  const ends: number[] = [];
  for (let offset = 0; offset < text.length; ) {
    const cp = text.codePointAt(offset);
    if (cp === undefined) break;
    const char = String.fromCodePoint(cp);
    const value = /\s/u.test(char) ? " " : normalize(char);
    if (value !== " " || (folded && !folded.endsWith(" "))) {
      for (let i = 0; i < value.length; i++) {
        folded += value[i];
        offsets.push(offset);
        ends.push(offset + char.length);
      }
    }
    offset += char.length;
  }
  const found = folded.indexOf(target);
  const start = offsets[found];
  const end = ends[found + target.length - 1];
  if (found < 0 || start === undefined || end === undefined)
    throw new Error("Evidence quote is absent");
  const segments = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)];
  const first = segments.findIndex((s) => s.index + s.segment.length > start);
  let last = segments.findIndex((s) => s.index + s.segment.length >= end);
  if (last < 0) last = segments.length - 1;
  const beforeStart = segments[Math.max(0, first - 1)]?.index ?? start;
  const lastSegment = segments[Math.min(segments.length - 1, last + 1)];
  const afterEnd = lastSegment ? lastSegment.index + lastSegment.segment.length : end;
  return {
    before: text.slice(beforeStart, start),
    match: text.slice(start, end),
    after: text.slice(end, afterEnd),
  };
}
