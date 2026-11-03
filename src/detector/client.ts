import type { DetectorInput, EngineEvent } from "./types.ts";
import { parseDetectorResult, parseEngineEvent } from "./validation.ts";
export class DetectorClient {
  constructor(
    private createWorker: () => Worker = () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  ) {}
  worker: Worker | null = null;
  private running = false;
  private reject: ((reason: Error) => void) | null = null;
  async load(
    emit: (event: EngineEvent) => void,
    options: { modelHost?: string; cache?: boolean } = {},
  ): Promise<string> {
    this.cancel();
    this.worker = this.createWorker();
    return this.request(
      "ready",
      {
        type: "load",
        modelHost:
          options.modelHost ??
          (location.hostname === "127.0.0.1" || location.hostname === "localhost"
            ? `${location.origin}/__models/`
            : "https://huggingface.co/"),
        cache: options.cache ?? true,
      },
      emit,
    );
  }
  async run(input: DetectorInput, emit: (event: EngineEvent) => void = () => {}) {
    if (this.running) throw new Error("A detector run is already active");
    this.running = true;
    try {
      const raw = await this.request("result", { type: "run", input }, emit);
      const result = parseDetectorResult(raw);
      return result;
    } finally {
      this.running = false;
    }
  }
  private request(
    expected: "ready",
    message: object,
    emit: (event: EngineEvent) => void,
  ): Promise<string>;
  private request(
    expected: "result",
    message: object,
    emit: (event: EngineEvent) => void,
  ): Promise<unknown>;
  private request(
    expected: "ready" | "result",
    message: object,
    emit: (event: EngineEvent) => void,
  ): Promise<unknown> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("Models are not loaded"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.cancel();
          reject(new Error("Local inference timed out. Recorded analysis remains available."));
        },
        expected === "ready" ? 120000 : 600000,
      );
      const finish = () => {
        clearTimeout(timer);
        this.reject = null;
      };
      this.reject = (error) => {
        finish();
        reject(error);
      };
      worker.onerror = () => {
        if (worker !== this.worker) return;
        finish();
        reject(new Error("The model worker could not start. Recorded analysis remains available."));
      };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (worker !== this.worker) return;
        const value = event.data;
        if (!value || typeof value !== "object" || !("type" in value)) return;
        if (value.type === "error" && "message" in value && typeof value.message === "string") {
          finish();
          reject(new Error(value.message));
        } else if (value.type === expected) {
          finish();
          if (expected === "ready" && "backend" in value && typeof value.backend === "string")
            resolve(value.backend);
          else if ("result" in value) resolve(value.result);
          else reject(new Error("Malformed worker response"));
        } else {
          try {
            emit(parseEngineEvent(value));
          } catch {
            finish();
            reject(new Error("Malformed worker event"));
          }
        }
      };
      worker.postMessage(message);
    });
  }
  cancel() {
    this.reject?.(new Error("Cancelled. Recorded analysis remains available."));
    this.reject = null;
    this.worker?.terminate();
    this.worker = null;
  }
}
