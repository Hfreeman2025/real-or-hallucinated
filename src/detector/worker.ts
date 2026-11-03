import type { DetectorInput, EngineEvent } from "./types.ts";

let controller = new AbortController();
let engine: Awaited<ReturnType<typeof import("./engine.ts").loadEngine>> | null = null;
let busy = false;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
globalThis.addEventListener("message", async (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!object(request) || typeof request.type !== "string") return;
  if (request.type === "cancel") {
    controller.abort();
    return;
  }
  if (busy) {
    postMessage({ type: "error", message: "An inference is already running." });
    return;
  }
  busy = true;
  const emit = (event: EngineEvent) => postMessage(event);
  try {
    if (request.type === "load") {
      if (typeof request.modelHost !== "string" || typeof request.cache !== "boolean")
        throw new Error("Invalid model request");
      const host = new URL(request.modelHost);
      if (host.origin !== location.origin && host.origin !== "https://huggingface.co")
        throw new Error("Model host is not allowed");
      controller = new AbortController();
      emit({ type: "phase", phase: "Worker ready · importing local inference runtime" });
      const { loadEngine } = await import("./engine.ts");
      engine = await loadEngine({
        modelHost: request.modelHost,
        cache: request.cache,
        signal: controller.signal,
        emit,
      });
      postMessage({ type: "ready", backend: engine.backend });
    } else if (request.type === "run") {
      const input = request.input;
      if (
        !engine ||
        !object(input) ||
        typeof input.id !== "string" ||
        typeof input.question !== "string" ||
        typeof input.claim !== "string" ||
        typeof input.seed !== "number" ||
        !Number.isSafeInteger(input.seed)
      )
        throw new Error("Invalid detector input");
      const checked: DetectorInput = {
        id: input.id,
        question: input.question,
        claim: input.claim,
        seed: input.seed,
      };
      controller = new AbortController();
      const { runDetector } = await import("./engine.ts");
      const result = await runDetector(engine, checked, emit, controller.signal);
      postMessage({ type: "result", result });
    }
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Local inference failed",
    });
  } finally {
    busy = false;
  }
});
