import assert from "node:assert/strict";
import test from "node:test";
import { drawToken } from "../src/detector/sampling.ts";

const config = { temperature: 1, topK: 3, topP: 1, repetitionPenalty: 1 };
test("a categorical draw follows normalized probabilities and retains original model confidence", () => {
  const logits = [Math.log(0.6), Math.log(0.3), Math.log(0.1)];
  assert.equal(drawToken(logits, config, () => 0.1).id, 0);
  const middle = drawToken(logits, config, () => 0.7);
  assert.equal(middle.id, 1);
  assert.ok(Math.abs(middle.modelProbability - 0.3) < 1e-12);
  assert.equal(drawToken(logits, config, () => 0.99).id, 2);
});
test("nucleus and top-k discard the tail before sampling, without relabelling model confidence", () => {
  const logits = [Math.log(0.6), Math.log(0.3), Math.log(0.1)];
  const nucleus = drawToken(logits, { ...config, topP: 0.5 }, () => 0.999);
  assert.equal(nucleus.id, 0);
  assert.equal(nucleus.retained, 1);
  assert.ok(Math.abs(nucleus.modelProbability - 0.6) < 1e-12);
  assert.equal(nucleus.samplingProbability, 1);
  const topK = drawToken(logits, { ...config, topK: 2 }, () => 0.999);
  assert.equal(topK.id, 1);
  assert.equal(topK.retained, 2);
});
test("temperature and repetition change the draw distribution while the raw model probability stays honest", () => {
  const logits = [2, 1, 0];
  const raw = drawToken(logits, config, () => 0.1);
  const altered = drawToken(
    logits,
    { ...config, temperature: 0.5, repetitionPenalty: 1.1 },
    () => 0.1,
    new Set([0]),
  );
  assert.equal(altered.modelProbability, raw.modelProbability);
  assert.ok(altered.samplingProbability > raw.samplingProbability);
});
test("sampling rejects invalid settings and nonfinite logits, and breaks ties deterministically", () => {
  assert.throws(() => drawToken([], config, () => 0));
  assert.throws(() => drawToken([0, NaN], config, () => 0));
  assert.throws(() => drawToken([0], { ...config, temperature: 0 }, () => 0));
  assert.throws(() => drawToken([0], { ...config, topP: 0 }, () => 0));
  assert.equal(drawToken([0, 0, 0], { ...config, topK: 1 }, () => 0.9).id, 0);
});

test("bounded-heap sampling agrees with a full-sort oracle across changing vocabularies", async () => {
  const { seededRandom } = await import("../src/detector/math.ts");
  const rng = seededRandom(123456);
  for (let run = 0; run < 100; run++) {
    const logits = Array.from({ length: 127 }, () => rng() * 20 - 10);
    const seen = new Set([0, 3, 15, 67]);
    const options = { temperature: 0.9, topK: 40, topP: 0.95, repetitionPenalty: 1.1 };
    const uniform = rng();
    const sorted = logits
      .map((raw, id) => ({
        id,
        score: (seen.has(id) ? (raw < 0 ? raw * 1.1 : raw / 1.1) : raw) / 0.9,
      }))
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .slice(0, 40);
    const max = sorted[0]?.score ?? 0;
    const weights = sorted.map((c) => Math.exp(c.score - max));
    const total = weights.reduce((a, b) => a + b, 0);
    let count = 0,
      mass = 0;
    do {
      mass += (weights[count] ?? 0) / total;
      count++;
    } while (count < 40 && mass + 1e-15 < 0.95);
    let draw = uniform * mass,
      index = count - 1;
    for (let i = 0; i < count; i++) {
      draw -= (weights[i] ?? 0) / total;
      if (draw < 0) {
        index = i;
        break;
      }
    }
    const actual = drawToken(logits, options, () => uniform, seen);
    assert.equal(actual.id, sorted[index]?.id);
    assert.equal(actual.retained, count);
    const rawMax = Math.max(...logits);
    const rawSum = logits.reduce((sum, v) => sum + Math.exp(v - rawMax), 0);
    assert.ok(
      Math.abs(actual.modelProbability - Math.exp((logits[actual.id] ?? 0) - rawMax) / rawSum) <
        1e-12,
    );
  }
});
