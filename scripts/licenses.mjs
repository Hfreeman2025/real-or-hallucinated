import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
if (!lock || typeof lock !== "object" || !lock.packages)
  throw new Error("Missing lockfile packages");
const allowed = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT OR Apache-2.0",
  "(MIT OR Apache-2.0)",
]);
const dependencies = Object.entries(lock.packages)
  .filter(([path]) => path)
  .map(([path, pkg]) => {
    if (
      !pkg ||
      typeof pkg.version !== "string" ||
      typeof pkg.license !== "string" ||
      !allowed.has(pkg.license)
    )
      throw new Error(`Dependency license not allowed: ${path}: ${pkg?.license}`);
    return { path, version: pkg.version, license: pkg.license };
  });
const counts = {};
for (const pkg of dependencies) counts[pkg.license] = (counts[pkg.license] ?? 0) + 1;
await writeFile(
  new URL("../docs/dependency-licenses.json", import.meta.url),
  `${JSON.stringify({ allowlist: [...allowed], counts, dependencies }, null, 2)}\n`,
);
console.log(
  `${dependencies.length} locked dependency entries (including optional platform packages): all licenses allowed.`,
);
console.log(JSON.stringify(counts));

// Browser-only vendored SDK and model artifacts have a separate, explicit inventory.
const vendor = JSON.parse(
  await readFile(new URL("../vendor/transformers/PROVENANCE.json", import.meta.url), "utf8"),
);
const modelManifest = JSON.parse(
  await readFile(new URL("../data/models.json", import.meta.url), "utf8"),
);
if (
  !allowed.has(vendor.license) ||
  modelManifest.models.some((model) => !allowed.has(model.license))
)
  throw new Error("Unapproved browser SDK or model licence");
async function diskBytes(path) {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.isSymbolicLink()) continue;
    const file = join(path, entry.name);
    bytes += entry.isDirectory() ? await diskBytes(file) : (await stat(file)).size;
  }
  return bytes;
}
const runtimeLibraries = [];
for (const name of ["onnxruntime-web", "onnxruntime-common"]) {
  const path = `node_modules/${name}`;
  const manifest = JSON.parse(await readFile(`${path}/package.json`, "utf8"));
  if (manifest.license !== "MIT" || manifest.version !== lock.packages[path].version)
    throw new Error("Runtime licence/version mismatch");
  runtimeLibraries.push({
    name,
    version: manifest.version,
    license: manifest.license,
    installedPackageBytes: await diskBytes(path),
    sourceUrl: lock.packages[path].resolved,
    notices: "/licenses/onnxruntime-ThirdPartyNotices.txt",
    licenceText: "/licenses/onnxruntime-LICENSE.txt",
  });
}
const runtimeFiles = [];
for (const file of [
  "ort.webgpu.bundle.min.mjs",
  "ort.wasm.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
])
  runtimeFiles.push({
    file,
    bytes: (await stat(`node_modules/onnxruntime-web/dist/${file}`)).size,
  });
await writeFile(
  new URL("../docs/model-licenses.json", import.meta.url),
  `${JSON.stringify({ vendor, models: modelManifest.models, runtimeLibraries, runtimeFiles, runtimeNoticeSource: "https://raw.githubusercontent.com/microsoft/onnxruntime/8d85527a010e294a26b274749f74294b2a32cec5/ThirdPartyNotices.txt" }, null, 2)}\n`,
);
console.log(
  `Vendored Transformers.js ${vendor.version} and ${modelManifest.models.length} shared model variants: all licences allowed.`,
);
