import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import { modelCache } from "./model-cache.ts";
import { NLI } from "./models.ts";
import { parseNliInputs } from "./nli-wire.ts";

// Import only the CPU runtime: importing the SDK here also registers its GPU backend.
// Tokenization remains in the parent; this worker receives validated int64 tensors.
let model: InferenceSession | null = null;
let busy = false;
const controller = new AbortController();
globalThis.addEventListener("message", async (event: MessageEvent<unknown>) => {
  const r = event.data;
  if (!r || typeof r !== "object" || !("type" in r)) return;
  if (r.type === "cancel") {
    controller.abort();
    return;
  }
  if (busy) {
    postMessage({ type: "error", message: "NLI worker is busy" });
    return;
  }
  busy = true;
  try {
    if (r.type === "load") {
      if (
        !("modelHost" in r) ||
        typeof r.modelHost !== "string" ||
        !("cache" in r) ||
        typeof r.cache !== "boolean"
      )
        throw new Error("Invalid NLI load request");
      const host = new URL(r.modelHost);
      if (host.origin !== location.origin && host.origin !== "https://huggingface.co")
        throw new Error("NLI host is not allowed");
      env.logLevel = "error";
      env.wasm.numThreads = 1;
      env.wasm.wasmPaths = {
        mjs: `${location.origin}/runtime/ort-wasm-simd-threaded.mjs`,
        wasm: `${location.origin}/runtime/ort-wasm-simd-threaded.wasm`,
      };
      const url = new URL(`${NLI.id}/resolve/${NLI.revision}/onnx/model_quantized.onnx`, host).href;
      const cache = r.cache
        ? await modelCache(
            typeof caches === "undefined" ? undefined : caches,
            location.origin,
            () =>
              postMessage({
                type: "phase",
                phase: "Cache storage unavailable · models remain in memory only for this session",
              }),
          )
        : null;
      const cached = await cache?.match(url);
      const response =
        cached ??
        (await fetch(url, {
          signal: controller.signal,
          ...(r.cache ? {} : { cache: "no-store" }),
        }));
      if (!response.ok || !response.body)
        throw new Error(`NLI download failed (${response.status})`);
      const cacheWrite = !cached && cache ? cache.put(url, response.clone()) : Promise.resolve();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      while (true) {
        controller.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        if (loaded > NLI.bytes) throw new Error("NLI model exceeds its pinned size");
        chunks.push(value);
        postMessage({
          type: "progress",
          progress: {
            file: `${NLI.id} / onnx/model_quantized.onnx`,
            loaded,
            total: NLI.bytes,
            stage: cached ? "cache" : "progress",
          },
        });
      }
      if (loaded !== NLI.bytes) throw new Error("NLI model size does not match its manifest");
      const bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      await cacheWrite;
      model = await InferenceSession.create(bytes, {
        executionProviders: ["wasm"],
        logSeverityLevel: 3,
      });
      controller.signal.throwIfAborted();
      postMessage({ type: "ready" });
    } else if (r.type === "infer") {
      if (!model || !("inputs" in r)) throw new Error("NLI model is not ready");
      const inputs = parseNliInputs(r.inputs);
      const tensors: Record<string, Tensor> = {};
      for (const name of model.inputNames) {
        const input = inputs.find((input) => input.name === name);
        if (!input) throw new Error(`Missing NLI input: ${name}`);
        tensors[name] = new Tensor("int64", input.data, input.dims);
      }
      const output = await model.run(tensors);
      if (!(output.logits?.data instanceof Float32Array))
        throw new Error("Expected float32 NLI logits");
      postMessage({
        type: "result",
        logits: { data: new Float32Array(output.logits.data), dims: output.logits.dims },
      });
    }
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "CPU NLI failed",
    });
  } finally {
    busy = false;
  }
});
