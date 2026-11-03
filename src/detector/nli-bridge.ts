import { type PreTrainedModel, Tensor } from "../../vendor/transformers/transformers.web.js";
import { encodeNliInputs, parseNliLogits } from "./nli-wire.ts";
import type { EngineEvent } from "./types.ts";
import { parseEngineEvent } from "./validation.ts";
export class NliBridge {
  private worker = new Worker(new URL("./nli-worker.ts", import.meta.url), { type: "module" });
  private reject: ((error: Error) => void) | null = null;
  private request(
    expected: "ready" | "result",
    message: object,
    emit: (event: EngineEvent) => void = () => {},
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose();
        reject(new Error("CPU entailment timed out"));
      }, 120000);
      const finish = () => {
        clearTimeout(timer);
        this.reject = null;
      };
      this.reject = (error) => {
        finish();
        reject(error);
      };
      this.worker.onerror = () => {
        finish();
        reject(new Error("The CPU entailment worker failed"));
      };
      this.worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!data || typeof data !== "object" || !("type" in data)) return;
        if (data.type === "error" && "message" in data && typeof data.message === "string") {
          finish();
          reject(new Error(data.message));
        } else if (data.type === expected) {
          finish();
          resolve(expected === "result" && "logits" in data ? data.logits : undefined);
        } else {
          try {
            emit(parseEngineEvent(data));
          } catch {
            finish();
            reject(new Error("Invalid CPU entailment event"));
          }
        }
      };
      this.worker.postMessage(message);
    });
  }
  async load(
    modelHost: string,
    cache: boolean,
    emit: (event: EngineEvent) => void,
    signal: AbortSignal,
  ) {
    const abort = () => this.dispose();
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      await this.request("ready", { type: "load", modelHost, cache }, emit);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  model(): PreTrainedModel {
    const classify = async (inputs: Record<string, unknown>) => {
      const values = encodeNliInputs(inputs);
      const batch = values[0]?.dims[0];
      if (!batch) throw new Error("Empty NLI batch");
      const result = parseNliLogits(
        await this.request("result", { type: "infer", inputs: values }),
        batch,
      );
      return { logits: new Tensor("float32", result.data, result.dims) };
    };
    return Object.assign(classify, {
      generate: async () => {
        throw new Error("Entailment is not a generator");
      },
      dispose: async () => this.dispose(),
    });
  }
  dispose() {
    this.reject?.(new Error("CPU entailment stopped"));
    this.reject = null;
    this.worker.terminate();
  }
}
