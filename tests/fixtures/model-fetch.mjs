import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

// Small transport fixtures exercise the downloader without transferring model weights.
// Isolate the disk policy from whichever CI runner executes these tiny fixtures.
fs.statfs = async () => ({
  bavail: (process.env.FETCH_FIXTURE === "disk" ? 9 : 20) * 1024 ** 3,
  bsize: 1,
});
syncBuiltinESMExports();
const bytes = new TextEncoder().encode("model");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const models = [
  [
    "onnx-community/Qwen2.5-0.5B-Instruct",
    "22942cb7d7ba4cc81bb4673549ca4d4614469b5e",
    "onnx/model_q4.onnx",
  ],
  [
    "Xenova/nli-deberta-v3-xsmall",
    "2a4f614a701367a02d51389039afc998faeda637",
    "onnx/model_quantized.onnx",
  ],
];
globalThis.fetch = async (input) => {
  const { hostname, pathname } = new URL(input);
  if (hostname !== "huggingface.co") throw new Error("Unexpected fixture host");
  for (const [id, revision, weight] of models) {
    if (pathname === `/api/models/${id}/revision/${revision}`)
      return Response.json({
        sha: process.env.FETCH_FIXTURE === "revision" ? "different" : revision,
        siblings: [{ rfilename: weight, size: bytes.length, lfs: { sha256 } }],
      });
    if (pathname === `/${id}/resolve/${revision}/${weight}`) {
      if (process.env.FETCH_FIXTURE === "cached")
        throw new Error("Valid weights were downloaded twice");
      return new Response(process.env.FETCH_FIXTURE === "digest" ? "wrong" : bytes);
    }
  }
  if (
    pathname === "/api/models/Qwen/Qwen2.5-0.5B-Instruct" ||
    pathname === "/api/models/cross-encoder/nli-deberta-v3-xsmall"
  )
    return Response.json({ cardData: { license: "apache-2.0" } });
  throw new Error(`Unexpected fixture URL: ${pathname}`);
};
