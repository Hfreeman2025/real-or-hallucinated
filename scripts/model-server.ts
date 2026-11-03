import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Connect, Plugin } from "vite";

const shared = join(homedir(), "Personal/.models");
const runtime = join(process.cwd(), "node_modules/onnxruntime-web/dist");
async function allowedModel(path: string): Promise<string | null> {
  const manifest = JSON.parse(await readFile(join(shared, "manifest.json"), "utf8"));
  for (const model of manifest.models)
    for (const file of model.files) {
      if (path === `/__models/${model.id}/resolve/${model.revision}/${file.file}`)
        return join(shared, model.id, model.revision, file.file);
    }
  return null;
}
const serve: Connect.NextHandleFunction = async (req, res, next) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!path.startsWith("/__models/") && !path.startsWith("/runtime/")) return next();
  try {
    const file =
      path.startsWith("/runtime/") &&
      /^\/runtime\/ort-wasm-simd-threaded(?:\.(?:jsep|jspi|asyncify))?\.(?:wasm|mjs)$/.test(path)
        ? join(runtime, path.slice("/runtime/".length))
        : await allowedModel(path);
    if (!file) {
      res.statusCode = 404;
      res.end("File is not in the public model manifest.");
      return;
    }
    const info = await stat(file);
    res.setHeader(
      "Content-Type",
      file.endsWith(".wasm")
        ? "application/wasm"
        : file.endsWith(".mjs")
          ? "text/javascript"
          : file.endsWith(".json")
            ? "application/json"
            : "application/octet-stream",
    );
    const firstByte = req.headers.range === "bytes=0-0" && info.size > 0;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", firstByte ? 1 : info.size);
    if (firstByte) {
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes 0-0/${info.size}`);
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(file, firstByte ? { start: 0, end: 0 } : undefined);
    res.on("close", () => stream.destroy());
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch {
    res.statusCode = 503;
    res.end("Shared model files are not ready. Run npm run models:fetch.");
  }
};
export function modelFiles(): Plugin {
  return {
    name: "public-model-files",
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    async generateBundle(_options, bundle) {
      for (const file of await readdir(runtime))
        if (/^ort-wasm-simd-threaded(?:\.asyncify)?\.(?:wasm|mjs)$/.test(file)) {
          if (bundle[`runtime/${file}`]) continue;
          this.emitFile({
            type: "asset",
            fileName: `runtime/${file}`,
            source: await readFile(join(runtime, file)),
          });
        }
    },
  };
}
