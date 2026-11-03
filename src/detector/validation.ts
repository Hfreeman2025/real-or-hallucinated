import { claimSupport, meaningClusters, semanticEntropy } from "./math.ts";
import type {
  AnswerSample,
  DetectorResult,
  EngineEvent,
  Entailment,
  PairEvidence,
  TokenConfidence,
} from "./types.ts";

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid detector record");
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid text");
  return value;
}
function num(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid number");
  return value;
}
function prob(value: unknown): number {
  const n = num(value);
  if (n < 0 || n > 1.000001) throw new Error("Invalid probability");
  return n;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid array");
  return value;
}
function relation(value: unknown): Entailment {
  const r = obj(value);
  const checked = {
    entailment: prob(r.entailment),
    contradiction: prob(r.contradiction),
    neutral: prob(r.neutral),
  };
  if (Math.abs(Object.values(checked).reduce((a, b) => a + b, 0) - 1) > 0.001)
    throw new Error("NLI probabilities do not sum to one");
  return checked;
}
function token(value: unknown): TokenConfidence {
  const t = obj(value);
  const id = num(t.id);
  if (!Number.isInteger(id) || id < 0) throw new Error("Invalid token identifier");
  return { id, text: str(t.text), probability: prob(t.probability) };
}
function sample(value: unknown): AnswerSample {
  const s = obj(value);
  if (typeof s.truncated !== "boolean") throw new Error("Invalid token cap flag");
  const tokens = list(s.tokens).map(token);
  const meanLogProbability = num(s.meanLogProbability);
  const expected =
    tokens.reduce((sum, t) => sum + Math.log(Math.max(t.probability, Number.MIN_VALUE)), 0) /
    tokens.length;
  if (!tokens.length || Math.abs(meanLogProbability - expected) > 1e-9)
    throw new Error("Inconsistent token confidence");
  const milliseconds = num(s.milliseconds);
  if (milliseconds < 0) throw new Error("Invalid sample duration");
  return { truncated: s.truncated, text: str(s.text), tokens, meanLogProbability, milliseconds };
}
export function parseDetectorResult(value: unknown): DetectorResult {
  const r = obj(value);
  const i = obj(r.input);
  const samples = list(r.samples).map(sample);
  if (samples.length !== 5 || samples.some((s) => !s.text || !s.tokens.length))
    throw new Error("Five nonempty samples required");
  const pairs: PairEvidence[] = list(r.pairs).map((value) => {
    const p = obj(value);
    return {
      a: num(p.a),
      b: num(p.b),
      forward: relation(p.forward),
      backward: relation(p.backward),
    };
  });
  if (
    pairs.length !== 10 ||
    new Set(pairs.map((p) => `${p.a}:${p.b}`)).size !== 10 ||
    pairs.some(
      (p) => !Number.isInteger(p.a) || !Number.isInteger(p.b) || p.a < 0 || p.b >= 5 || p.a >= p.b,
    )
  )
    throw new Error("Invalid pair matrix");
  const claimRelations = list(r.claimRelations).map(relation);
  const clusters = list(r.clusters).map((c) => list(c).map(num));
  if (
    claimRelations.length !== 5 ||
    clusters.flat().sort().join() !== "0,1,2,3,4" ||
    clusters.some((c) => !c.length)
  )
    throw new Error("Invalid meaning partition");
  if (typeof r.predictedReal !== "boolean") throw new Error("Invalid verdict");
  const expectedClusters = meaningClusters(5, pairs, prob(r.threshold));
  const expectedEntropy = semanticEntropy(expectedClusters);
  const expectedSupport = claimSupport(claimRelations);
  if (
    JSON.stringify(clusters) !== JSON.stringify(expectedClusters) ||
    Math.abs(num(r.entropyBits) - expectedEntropy) > 0.000001 ||
    Math.abs(prob(r.normalizedEntropy) - expectedEntropy / Math.log2(5)) > 0.000001 ||
    Math.abs(prob(r.support) - expectedSupport) > 0.000001 ||
    r.predictedReal !== expectedSupport >= 0.5
  )
    throw new Error("Inconsistent detector computation");
  return {
    input: { id: str(i.id), question: str(i.question), claim: str(i.claim), seed: num(i.seed) },
    samples,
    pairs,
    claimRelations,
    clusters,
    entropyBits: num(r.entropyBits),
    normalizedEntropy: prob(r.normalizedEntropy),
    support: prob(r.support),
    predictedReal: r.predictedReal,
    threshold: prob(r.threshold),
    milliseconds: num(r.milliseconds),
    backend: str(r.backend),
  };
}

export function parseEngineEvent(value: unknown): EngineEvent {
  const e = obj(value);
  if (e.type === "phase") return { type: "phase", phase: str(e.phase) };
  if (e.type === "sample") return { type: "sample", index: num(e.index), sample: sample(e.sample) };
  if (e.type === "progress") {
    const p = obj(e.progress);
    return {
      type: "progress",
      progress: {
        file: str(p.file),
        loaded: num(p.loaded),
        total: num(p.total),
        stage: str(p.stage),
      },
    };
  }
  if (e.type === "pair") {
    const p = obj(e.pair);
    return {
      type: "pair",
      pair: {
        a: num(p.a),
        b: num(p.b),
        forward: relation(p.forward),
        backward: relation(p.backward),
      },
    };
  }
  throw new Error("Unknown worker event");
}
