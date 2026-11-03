import type { SourceContext } from "./context.ts";
import { dayNumber } from "./core.ts";
import { normalize } from "./matching.ts";
export const topics = [
  "Science",
  "Nature",
  "Space",
  "Energy",
  "Climate",
  "History",
  "Technology",
] as const;
export type Topic = (typeof topics)[number];
export const proofKinds = [
  "number",
  "date",
  "location",
  "definition",
  "attribution",
  "comparison",
  "material",
] as const;
export interface ProofEdit {
  phrase: string;
  replacement: string;
  kind: (typeof proofKinds)[number];
  tell: string;
  reason: string;
}
export interface Claim {
  id: string;
  topic: Topic;
  text: string;
  real: boolean;
  source: { publisher: string; title: string; url: string };
  evidence: {
    quote: string;
    explanation: string;
    checkedOn: string;
    method: "supporting-quote" | "direct-contradiction";
    sourceSha256: string;
    context: SourceContext;
    contextCheckedOn: string;
    proof: ProofEdit | null;
  };
}
export interface Puzzle {
  id: string;
  title: string;
  claims: Claim[];
}
export interface Bank {
  version: 2;
  startDate: string;
  cycleNote: string;
  authorship: string;
  puzzles: Puzzle[];
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error("Expected an object");
  return value;
}
function string(value: unknown, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid text");
  return value;
}
export function sourceUrl(value: unknown): string {
  const url = new URL(string(value));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    ![
      "science.nasa.gov",
      "oceanservice.noaa.gov",
      "gml.noaa.gov",
      "www.eia.gov",
      "www.nps.gov",
      "www.nist.gov",
    ].includes(url.hostname)
  )
    throw new Error("Source must be a public primary-source HTTPS URL");
  return url.href;
}
export function parseBank(value: unknown): Bank {
  const bank = object(value);
  if (bank.version !== 2 || !Array.isArray(bank.puzzles) || bank.puzzles.length < 14)
    throw new Error("Expected fourteen editions");
  const startDate = string(bank.startDate);
  dayNumber(startDate);
  const ids = new Set<string>();
  const texts = new Set<string>();
  const editionIds = new Set<string>();
  const mixes = new Set<number>();
  const covered = new Set<Topic>();
  const puzzles = bank.puzzles.map((entry: unknown): Puzzle => {
    const puzzle = object(entry);
    const id = string(puzzle.id);
    if (editionIds.has(id)) throw new Error("Duplicate edition");
    editionIds.add(id);
    if (!Array.isArray(puzzle.claims) || puzzle.claims.length !== 5)
      throw new Error("Expected five claims");
    const claims = puzzle.claims.map((item: unknown): Claim => {
      const claim = object(item);
      const source = object(claim.source);
      const evidence = object(claim.evidence);
      const id = string(claim.id);
      const text = string(claim.text, 300);
      if (ids.has(id) || texts.has(text.toLowerCase())) throw new Error("Duplicate claim");
      ids.add(id);
      texts.add(text.toLowerCase());
      const topic = topics.find((topic) => topic === claim.topic);
      if (!topic || typeof claim.real !== "boolean") throw new Error("Invalid topic or verdict");
      covered.add(topic);
      const checkedOn = string(evidence.checkedOn);
      dayNumber(checkedOn);
      const method = claim.real ? "supporting-quote" : "direct-contradiction";
      if (evidence.method !== method) throw new Error("Evidence method disagrees with verdict");
      const sourceSha256 = string(evidence.sourceSha256);
      if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error("Invalid source digest");
      const quote = string(evidence.quote, 500);
      const contextValue = object(evidence.context);
      if (
        typeof contextValue.before !== "string" ||
        typeof contextValue.after !== "string" ||
        contextValue.before.length > 2000 ||
        contextValue.after.length > 2000
      )
        throw new Error("Invalid surrounding source context");
      const context = {
        before: contextValue.before,
        match: string(contextValue.match, 500),
        after: contextValue.after,
      };
      if (normalize(context.match) !== normalize(quote))
        throw new Error("Context must contain the exact evidence quote");
      const contextCheckedOn = string(evidence.contextCheckedOn);
      dayNumber(contextCheckedOn);
      let proof: ProofEdit | null = null;
      if (!claim.real) {
        const edit = object(evidence.proof);
        const phrase = string(edit.phrase, 300);
        const kind = proofKinds.find((k) => k === edit.kind);
        if (!kind || text.split(phrase).length !== 2)
          throw new Error("Fabrication phrase must occur exactly once in the claim");
        proof = {
          phrase,
          replacement: string(edit.replacement, 300),
          kind,
          tell: string(edit.tell, 150),
          reason: string(edit.reason, 500),
        };
      } else if (evidence.proof !== null)
        throw new Error("Real claims cannot carry fabrication marks");
      return {
        id,
        text,
        topic,
        real: claim.real,
        source: {
          publisher: string(source.publisher),
          title: string(source.title),
          url: sourceUrl(source.url),
        },
        evidence: {
          quote,
          explanation: string(evidence.explanation),
          checkedOn,
          method,
          sourceSha256,
          context,
          contextCheckedOn,
          proof,
        },
      };
    });
    const count = claims.filter((c) => c.real).length;
    if (new Set(claims.map((c) => c.source.url)).size !== 5)
      throw new Error("Repeated source within an edition could spoil a later answer");
    if (new Set(claims.map((c) => c.topic)).size < 3)
      throw new Error("Each edition needs at least three topics");
    if (count === 0 || count === 5) throw new Error("Each edition must mix verdicts");
    mixes.add(count);
    return { id, title: string(puzzle.title), claims };
  });
  if (mixes.size < 3 || covered.size !== topics.length)
    throw new Error("Bank needs varied ratios and all topics");
  return {
    version: 2,
    startDate,
    cycleNote: string(bank.cycleNote),
    authorship: string(bank.authorship),
    puzzles,
  };
}
