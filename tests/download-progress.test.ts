import assert from "node:assert/strict";
import { test } from "node:test";
import { progressFileKey, updateDownloads } from "../src/detector/download-progress.ts";

test("download totals count each model artifact once across SDK event spellings", () => {
  const qwen = "onnx-community/Qwen2.5-0.5B-Instruct";
  const events = [
    `${qwen} / onnx/model_q4.onnx`,
    `${qwen} / model_q4.onnx`,
    `http://127.0.0.1:5177/__models/${qwen}/resolve/revision/onnx/model_q4.onnx`,
  ];
  assert.equal(new Set(events.map(progressFileKey)).size, 1);
  assert.notEqual(
    progressFileKey(`${qwen} / config.json`),
    progressFileKey("Xenova/nli-deberta-v3-xsmall / config.json"),
  );
});

test("SDK aggregate progress does not double-count the generator bytes", () => {
  const files = new Map();
  const generator = {
    file: "onnx-community/Qwen2.5-0.5B-Instruct / onnx/model_q4.onnx",
    loaded: 786156820,
    total: 786156820,
    stage: "progress",
  };
  updateDownloads(files, generator);
  updateDownloads(files, {
    ...generator,
    file: "onnx-community/Qwen2.5-0.5B-Instruct / files",
    stage: "progress_total",
  });
  const result = updateDownloads(files, {
    file: "Xenova/nli-deberta-v3-xsmall / onnx/model_quantized.onnx",
    loaded: 87246587,
    total: 87246587,
    stage: "cache",
  });
  assert.equal(result.loaded, 873403407);
  assert.equal(result.total, 873403407);
});
