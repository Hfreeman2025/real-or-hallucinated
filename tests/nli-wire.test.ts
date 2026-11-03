import assert from "node:assert/strict";
import test from "node:test";
import { encodeNliInputs, parseNliInputs, parseNliLogits } from "../src/detector/nli-wire.ts";

const ids = { name: "input_ids", data: new BigInt64Array([1n, 2n, 3n, 4n]), dims: [2, 2] };
const mask = { name: "attention_mask", data: new BigInt64Array([1n, 1n, 1n, 1n]), dims: [2, 2] };
test("isolated NLI preserves exact token tensors and float32 output shape", () => {
  const encoded = encodeNliInputs({
    input_ids: { type: "int64", data: ids.data, dims: ids.dims },
    attention_mask: { type: "int64", data: mask.data, dims: mask.dims },
  });
  assert.deepEqual(encoded, [ids, mask]);
  assert.deepEqual(parseNliInputs(structuredClone(encoded)), encoded);
  const output = { data: new Float32Array([1, -2, 3, 4, 5, -6]), dims: [2, 3] };
  assert.deepEqual(parseNliLogits(structuredClone(output), 2), output);
});
test("NLI transport rejects missing, duplicate, malformed and oversized inputs before WASM", () => {
  for (const input of [
    [],
    [ids],
    [ids, ids],
    [ids, { ...mask, name: "private_path" }],
    [ids, { ...mask, data: new Float64Array(4) }],
    [ids, { ...mask, dims: [1, 4] }],
    [ids, { ...mask, dims: [2, 3] }],
    [{ ...ids, dims: [6, 2] }, mask],
    [{ ...ids, dims: [2, 193] }, mask],
  ])
    assert.throws(() => parseNliInputs(input));
  assert.throws(() =>
    encodeNliInputs({
      input_ids: { type: "float32", data: ids.data, dims: ids.dims },
      attention_mask: mask,
    }),
  );
});
test("NLI output never accepts a wrong label count, mismatched batch or nonfinite score", () => {
  for (const output of [
    { data: new Float32Array(4), dims: [2, 2] },
    { data: new Float32Array(6), dims: [1, 3] },
    { data: new Float32Array([1, 2, NaN, 3, 4, 5]), dims: [2, 3] },
    { data: [1, 2, 3, 4, 5, 6], dims: [2, 3] },
  ])
    assert.throws(() => parseNliLogits(output, 2));
});
