import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = resolve(process.env.MODEL_DIR ?? ".cache/models");
const models = [
  {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    revision: "22942cb7d7ba4cc81bb4673549ca4d4614469b5e",
    upstream: "Qwen/Qwen2.5-0.5B-Instruct",
    dtype: "q4",
    weight: "onnx/model_q4.onnx",
  },
  {
    id: "Xenova/nli-deberta-v3-xsmall",
    revision: "2a4f614a701367a02d51389039afc998faeda637",
    upstream: "cross-encoder/nli-deberta-v3-xsmall",
    dtype: "q8",
    weight: "onnx/model_quantized.onnx",
  },
];
let inventory = [];
try {
  inventory = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")).models.map((m) => ({
    ...m,
    status: "diagnostic / not selected for the current engine",
  }));
} catch {}
for (const model of models) {
  const infoResponse = await fetch(
    `https://huggingface.co/api/models/${model.id}/revision/${model.revision}?blobs=true`,
  );
  if (!infoResponse.ok) throw new Error(`Model metadata failed: ${infoResponse.status}`);
  const info = await infoResponse.json();
  if (info.sha !== model.revision)
    throw new Error("Upstream revision changed; review before fetching");
  const licenseResponse = await fetch(`https://huggingface.co/api/models/${model.upstream}`);
  const upstream = await licenseResponse.json();
  if (upstream.cardData?.license !== "apache-2.0") throw new Error("Unapproved model license");
  const files = info.siblings.filter(
    (f) =>
      f.rfilename === model.weight ||
      [
        "config.json",
        "generation_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "added_tokens.json",
        "README.md",
      ].includes(f.rfilename),
  );
  const size = files.reduce((sum, f) => sum + f.size, 0);
  const disk = await statfs("/");
  const free = disk.bavail * disk.bsize;
  if (free - size < 10 * 1024 ** 3)
    throw new Error(`STOP: ${model.id} would leave less than 10 GiB free`);
  console.log(
    `${model.id}: ${(size / 1e6).toFixed(1)} MB; ${(free / 1024 ** 3).toFixed(1)} GiB free before download.`,
  );
  const saved = [];
  for (const file of files) {
    const path = join(root, model.id, model.revision, file.rfilename);
    await mkdir(join(path, ".."), { recursive: true });
    const expected = file.lfs?.sha256;
    let valid = false;
    try {
      const bytes = await readFile(path);
      valid =
        bytes.length === file.size &&
        (!expected || createHash("sha256").update(bytes).digest("hex") === expected);
    } catch {}
    const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${file.rfilename}`;
    if (!valid) {
      const current = await statfs("/");
      if (current.bavail * current.bsize - file.size < 10 * 1024 ** 3)
        throw new Error("STOP: disk reserve reached");
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(`${path}.partial`));
      const bytes = await readFile(`${path}.partial`);
      if (
        bytes.length !== file.size ||
        (expected && createHash("sha256").update(bytes).digest("hex") !== expected)
      )
        throw new Error(`Integrity failure: ${file.rfilename}`);
      await rename(`${path}.partial`, path);
    }
    const bytes = await readFile(path);
    saved.push({
      file: file.rfilename,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url,
    });
    console.log(`  ${valid ? "reused" : "saved"} ${file.rfilename}: ${bytes.length} bytes`);
  }
  inventory = inventory.filter((m) => m.id !== model.id || m.dtype !== model.dtype);
  inventory.push({
    status: "selected for current engine",
    ...model,
    license: "Apache-2.0",
    licenseSource: `https://huggingface.co/${model.upstream}`,
    bytes: size,
    files: saved,
  });
}
const manifest = { fetchedAt: new Date().toISOString(), models: inventory };
await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(root, "README.md"),
  `# Local model files

Pinned ONNX conversions of Apache-2.0 upstream weights. Inference runs in the browser, without a hosted model API.

${inventory.map((m) => `- **${m.id}**, revision \`${m.revision}\`, ${m.dtype}, **${m.bytes.toLocaleString()} bytes**. Apache-2.0 ([upstream](${m.licenseSource})); [conversion](https://huggingface.co/${m.id}).`).join("\n")}

The manifest records exact files, sizes, immutable URLs and SHA-256 digests. Files are laid out as \`<model-id>/<revision>/<file>\`. Configure MODEL_DIR to reuse this directory across projects. Partial files are never model inputs. The fetcher preserves at least 10 GiB free and commits each verified file by atomic rename.
`,
);
console.log("Model cache manifest and README complete.");
