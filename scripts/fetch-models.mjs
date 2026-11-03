import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = join(homedir(), "Personal/.models");
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
  const infoResponse = await fetch(`https://huggingface.co/api/models/${model.id}?blobs=true`);
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
await writeFile("data/models.json", `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(root, "README.md"),
  `# Shared browser models\n\nDownloaded for Real or Hallucinated? v3; reusable by ask-the-record in wave 2. No inference API, key or private data. These are public ONNX conversions of Apache-2.0 upstream weights. Conversion model cards identify their upstream models; upstream model cards declare Apache-2.0.\n\n${inventory.map((m) => `- **${m.id}**, revision \`${m.revision}\`, ${m.dtype}, ${m.status}, **${m.bytes.toLocaleString()} bytes**. License: Apache-2.0 ([upstream declaration](${m.licenseSource})); [conversion source](https://huggingface.co/${m.id}).`).join("\n")}\n\nExact files, sizes, immutable source URLs and SHA-256 values: [manifest.json](manifest.json). Files are laid out as \`<model-id>/<revision>/<file>\`; do not duplicate weights into repositories.\n\n## Reuse\n\nThe MIT TypeScript engine is in \`~/Personal/lab/real-or-hallucinated/src/detector/engine.ts\`. Its \`loadEngine\` and \`runDetector\` APIs have no UI dependency. The Vite model middleware serves only the manifest's allowlisted paths from this directory; inference runs in a browser worker. See that project's \`docs/ENGINE.md\` for the protocol and cache strategy. Do not start wave 2 until authorised.\n\nCheck \`df -h /\` before downloads. Preserve at least 10 GiB free. Fetches are sequential, size-checked and hash-checked, with atomic rename after success. Temporary partial files are never model inputs. Browser caches are per-origin; headless evaluation streams this shared copy without caching another weight copy.\n`,
);
console.log("Shared model manifest and README complete.");
