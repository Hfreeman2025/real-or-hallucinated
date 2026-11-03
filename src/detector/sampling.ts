export interface SamplingOptions {
  temperature: number;
  topK: number;
  topP: number;
  repetitionPenalty: number;
}
export interface Draw {
  id: number;
  modelProbability: number;
  samplingProbability: number;
  retained: number;
}
interface Candidate {
  id: number;
  score: number;
}
const worse = (a: Candidate, b: Candidate) =>
  a.score < b.score || (a.score === b.score && a.id > b.id);
/** O(vocabulary log k), O(k) memory. Original confidence precedes every sampling transform. */
export function drawToken(
  logits: ArrayLike<number>,
  options: SamplingOptions,
  random: () => number,
  seen: ReadonlySet<number> = new Set(),
): Draw {
  if (
    !logits.length ||
    !Number.isFinite(options.temperature) ||
    options.temperature <= 0 ||
    !Number.isInteger(options.topK) ||
    options.topK < 1 ||
    !(options.topP > 0 && options.topP <= 1) ||
    !(options.repetitionPenalty >= 1 && Number.isFinite(options.repetitionPenalty))
  )
    throw new Error("Invalid sampling configuration");
  const k = Math.min(logits.length, options.topK);
  const heap: Candidate[] = [];
  let rawMax = -Infinity;
  let rawSum = 0;
  for (let id = 0; id < logits.length; id++) {
    const raw = logits[id];
    if (raw === undefined || !Number.isFinite(raw)) throw new Error("Nonfinite model logits");
    if (raw > rawMax) {
      rawSum = rawSum * Math.exp(rawMax - raw) + 1;
      rawMax = raw;
    } else rawSum += Math.exp(raw - rawMax);
    const penalized = seen.has(id)
      ? raw < 0
        ? raw * options.repetitionPenalty
        : raw / options.repetitionPenalty
      : raw;
    const score = penalized / options.temperature;
    if (heap.length < k) {
      heap.push({ id, score });
      let child = heap.length - 1;
      while (child > 0) {
        const parent = (child - 1) >> 1;
        const a = heap[child];
        const b = heap[parent];
        if (!a || !b || !worse(a, b)) break;
        heap[child] = b;
        heap[parent] = a;
        child = parent;
      }
    } else {
      const root = heap[0];
      if (!root || score < root.score || (score === root.score && id > root.id)) continue;
      heap[0] = { id, score };
      let parent = 0;
      while (parent * 2 + 1 < heap.length) {
        let child = parent * 2 + 1;
        const left = heap[child];
        const right = heap[child + 1];
        if (left && right && worse(right, left)) child++;
        const a = heap[parent];
        const b = heap[child];
        if (!a || !b || !worse(b, a)) break;
        heap[parent] = b;
        heap[child] = a;
        parent = child;
      }
    }
  }
  heap.sort((a, b) => b.score - a.score || a.id - b.id);
  const max = heap[0]?.score;
  if (max === undefined) throw new Error("No sampling candidates");
  const weights = heap.map((c) => Math.exp(c.score - max));
  const total = weights.reduce((a, b) => a + b, 0);
  let retainedMass = 0;
  let retained = 0;
  do {
    retainedMass += (weights[retained] ?? 0) / total;
    retained++;
  } while (retained < heap.length && retainedMass + 1e-15 < options.topP);
  const uniform = random();
  if (!(uniform >= 0 && uniform < 1)) throw new Error("Invalid random draw");
  let draw = uniform * retainedMass;
  let selected = retained - 1;
  for (let i = 0; i < retained; i++) {
    draw -= (weights[i] ?? 0) / total;
    if (draw < 0) {
      selected = i;
      break;
    }
  }
  const candidate = heap[selected];
  if (!candidate) throw new Error("Missing sampled token");
  return {
    id: candidate.id,
    modelProbability: Math.exp((logits[candidate.id] ?? -Infinity) - rawMax) / rawSum,
    samplingProbability: (weights[selected] ?? 0) / total / retainedMass,
    retained,
  };
}
