import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
async function fixture(action: (directory: string) => Promise<void>) {
  await mkdir(".cache", { recursive: true });
  const directory = await mkdtemp(resolve(".cache/model-fetch-test-"));
  const inventory = await readFile("data/models.json");
  await mkdir(resolve(directory, "data"));
  await writeFile(resolve(directory, "data/models.json"), inventory);
  try {
    await action(resolve(directory, "models"));
    assert.deepEqual(
      await readFile(resolve(directory, "data/models.json")),
      inventory,
      "Preparing weights preserves benchmark provenance",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function download(directory: string, mode = "valid") {
  return run(
    process.execPath,
    ["--import", resolve("tests/fixtures/model-fetch.mjs"), resolve("scripts/fetch-models.mjs")],
    {
      cwd: resolve(directory, ".."),
      env: { ...process.env, MODEL_DIR: directory, FETCH_FIXTURE: mode },
    },
  );
}

test("model downloads verify files in MODEL_DIR and reuse valid cached weights", async () => {
  await fixture(async (directory) => {
    await download(directory);
    const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
    assert.equal(manifest.models.length, 2);
    for (const model of manifest.models) {
      const file = resolve(directory, model.id, model.revision, model.files[0].file);
      assert.equal(await readFile(file, "utf8"), "model");
      await assert.rejects(stat(`${file}.partial`), { code: "ENOENT" });
    }
    await download(directory, "cached");
  });
});

test("a corrupt model response never becomes a completed weight or manifest", async () => {
  await fixture(async (directory) => {
    await assert.rejects(download(directory, "digest"), /Integrity failure/);
    await assert.rejects(stat(resolve(directory, "manifest.json")), { code: "ENOENT" });
    const model =
      "onnx-community/Qwen2.5-0.5B-Instruct/22942cb7d7ba4cc81bb4673549ca4d4614469b5e/onnx/model_q4.onnx";
    await assert.rejects(stat(resolve(directory, model)), { code: "ENOENT" });
  });
});

test("model metadata must describe the pinned revision", async () => {
  await fixture(async (directory) => {
    await assert.rejects(download(directory, "revision"), /Upstream revision changed/);
    await assert.rejects(stat(resolve(directory, "manifest.json")), { code: "ENOENT" });
  });
});

test("model preparation stops below the free-space floor", async () => {
  await fixture(async (directory) => {
    await assert.rejects(download(directory, "disk"), /less than 10 GiB free/);
    await assert.rejects(stat(resolve(directory, "manifest.json")), { code: "ENOENT" });
  });
});
