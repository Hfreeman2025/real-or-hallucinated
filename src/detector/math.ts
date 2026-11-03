import type { Entailment, PairEvidence } from "./types.ts";

export function semanticEntropy(clusters: readonly (readonly number[])[]): number {
  const all = clusters.flat();
  if (!all.length || new Set(all).size !== all.length || clusters.some((c) => !c.length))
    throw new Error("Clusters must partition nonempty samples");
  return Math.max(
    0,
    -clusters.reduce((sum, c) => {
      const p = c.length / all.length;
      return sum + p * Math.log2(p);
    }, 0),
  );
}
export function entails(value: Entailment, threshold: number): boolean {
  return (
    value.entailment >= threshold &&
    value.entailment > value.contradiction &&
    value.entailment > value.neutral
  );
}
/** Complete-link grouping: an answer must entail every member in both directions. */
export function meaningClusters(
  count: number,
  pairs: readonly PairEvidence[],
  threshold = 0.6,
): number[][] {
  if (!Number.isInteger(count) || count < 1 || threshold < 0 || threshold > 1)
    throw new Error("Invalid clustering input");
  const clusters: number[][] = [];
  for (let i = 0; i < count; i++) {
    const cluster = clusters.find((members) =>
      members.every((j) => {
        const pair = pairs.find((p) => (p.a === i && p.b === j) || (p.a === j && p.b === i));
        return (
          pair !== undefined &&
          entails(pair.forward, threshold) &&
          entails(pair.backward, threshold)
        );
      }),
    );
    if (cluster) cluster.push(i);
    else clusters.push([i]);
  }
  return clusters;
}
/** Pairwise AUROC with half credit for ties. Positive = error/fabrication. */
export function auroc(labels: readonly boolean[], scores: readonly number[]): number | null {
  if (labels.length !== scores.length || !labels.length || scores.some((s) => !Number.isFinite(s)))
    throw new Error("Invalid AUROC input");
  const positives = scores.filter((_, i) => labels[i]);
  const negatives = scores.filter((_, i) => !labels[i]);
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}
export function softmax(logits: readonly number[]): number[] {
  if (!logits.length || logits.some((v) => !Number.isFinite(v))) throw new Error("Invalid logits");
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const denominator = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / denominator);
}
/** NLI support index: 0.5 is neutral. Entropy is a separate uncertainty signal, not falsity. */
export function claimSupport(relations: readonly Entailment[]): number {
  if (!relations.length) throw new Error("No claim relations");
  return (
    0.5 +
    relations.reduce((sum, r) => sum + r.entailment - r.contradiction, 0) / (2 * relations.length)
  );
}

/** Mulberry32: nonlinear mixing avoids correlated first draws from nearby sample seeds. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
