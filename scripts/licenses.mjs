import { createHash } from "node:crypto";
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

// Harry explicitly approved OFL 1.1 for these self-hosted Plex font assets.
const fonts = JSON.parse(await readFile("data/fonts.json", "utf8"));
const expectedFonts = new Set([
  "ibm-plex-sans-latin-400-normal.woff2",
  "ibm-plex-sans-latin-400-italic.woff2",
  "ibm-plex-sans-latin-500-normal.woff2",
  "ibm-plex-sans-latin-600-normal.woff2",
  "ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-600-normal.woff2",
  "ibm-plex-sans-condensed-latin-500-normal.woff2",
  "ibm-plex-sans-condensed-latin-600-normal.woff2",
]);
if (fonts.license !== "OFL-1.1" || fonts.files.length !== 8 || fonts.licenses.length !== 3)
  throw new Error("Unexpected font inventory");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const faceCss = await readFile("public/fonts/plex.css", "utf8");
const declarations = [...faceCss.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]);
if (declarations.length !== 8) throw new Error("Expected eight font-face declarations");
for (const face of fonts.files) {
  if (!expectedFonts.delete(face.file) || face.version !== "5.3.0" || face.license !== "OFL-1.1")
    throw new Error("Unapproved font face");
  const match =
    /^(ibm-plex-(?:sans|mono|sans-condensed))-latin-(400|500|600)-(normal|italic)\.woff2$/.exec(
      face.file,
    );
  if (
    !match ||
    face.package !== `@fontsource/${match[1]}` ||
    face.weight !== Number(match[2]) ||
    face.style !== match[3] ||
    face.subset !== "latin" ||
    face.licenseFile !== `OFL-${match[1]}.txt` ||
    face.sourceUrl !==
      `https://cdn.jsdelivr.net/npm/@fontsource/${match[1]}@5.3.0/files/${face.file}`
  )
    throw new Error("Font provenance does not match its face");
  const declaration = declarations.find((block) => block.includes(`url("${face.file}")`));
  if (
    !declaration ||
    !declaration.includes("font-display: swap;") ||
    !declaration.includes(`font-weight: ${face.weight};`) ||
    !declaration.includes(`font-style: ${face.style};`)
  )
    throw new Error(`Font registration mismatch: ${face.file}`);
  const bytes = await readFile(`public/fonts/${face.file}`);
  if (
    bytes.subarray(0, 4).toString() !== "wOF2" ||
    bytes.length !== face.bytes ||
    digest(bytes) !== face.sha256
  )
    throw new Error(`Font digest/size mismatch: ${face.file}`);
}
const expectedLicences = new Set([
  "OFL-ibm-plex-sans.txt",
  "OFL-ibm-plex-mono.txt",
  "OFL-ibm-plex-sans-condensed.txt",
]);
for (const licence of fonts.licenses) {
  if (!expectedLicences.delete(licence.file) || licence.license !== "OFL-1.1")
    throw new Error("Unapproved font licence");
  const bytes = await readFile(`public/fonts/${licence.file}`);
  if (
    !bytes.toString().includes("SIL OPEN FONT LICENSE Version 1.1") ||
    bytes.length !== licence.bytes ||
    digest(bytes) !== licence.sha256
  )
    throw new Error(`Font licence mismatch: ${licence.file}`);
}
await writeFile("docs/font-licenses.json", `${JSON.stringify(fonts, null, 2)}\n`);
console.log(
  "8 self-hosted IBM Plex latin WOFF2 faces: @fontsource 5.3.0, OFL-1.1; sizes, SHA-256 and original notices verified.",
);
