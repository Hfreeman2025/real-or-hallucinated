import type { env } from "../../vendor/transformers/transformers.web.js";
import { modelCache } from "./model-cache.ts";
import { pinModelRequest } from "./model-request.ts";
import type { EngineEvent } from "./types.ts";
export interface WebKitLoad {
  modelHost: string;
  cache: boolean;
  signal: AbortSignal;
  emit: (event: EngineEvent) => void;
}
export async function configureWebKitRuntime(
  environment: typeof env,
  options: WebKitLoad,
  cpuOnly: boolean,
) {
  environment.allowLocalModels = false;
  environment.allowRemoteModels = true;
  environment.remoteHost = options.modelHost;
  environment.useBrowserCache = false;
  environment.useFSCache = false;
  environment.useWasmCache = false;
  environment.useCustomCache = false;
  if (options.cache) {
    const cache = await modelCache(
      typeof caches === "undefined" ? undefined : caches,
      location.origin,
      () =>
        options.emit({
          type: "phase",
          phase: "Cache storage unavailable · models remain in memory only for this session",
        }),
    );
    if (cache) {
      environment.customCache = cache;
      environment.useCustomCache = true;
    }
  }
  environment.backends.onnx.logLevel = "error";
  const wasm = environment.backends.onnx.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    const suffix = cpuOnly ? "" : ".asyncify";
    wasm.wasmPaths = {
      mjs: `${location.origin}/runtime/ort-wasm-simd-threaded${suffix}.mjs`,
      wasm: `${location.origin}/runtime/ort-wasm-simd-threaded${suffix}.wasm`,
    };
  }
  const nativeFetch = globalThis.fetch.bind(globalThis);
  environment.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return nativeFetch(url.includes("/resolve/") ? pinModelRequest(url) : input, {
      ...init,
      signal: options.signal,
      ...(options.cache ? {} : { cache: "no-store" as const }),
    });
  };
  return (p: { status: string; name?: string; file?: string; loaded?: number; total?: number }) =>
    options.emit({
      type: "progress",
      progress: {
        file: `${p.name ?? "Model"} / ${p.file ?? "files"}`,
        loaded: p.loaded ?? 0,
        total: p.total ?? 0,
        stage: p.status,
      },
    });
}
