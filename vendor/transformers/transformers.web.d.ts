// Narrow typed contract for the unmodified official Transformers.js 4.3.2
// browser bundle. Runtime outputs are also shape-checked at the engine boundary.
export class Tensor {
  constructor(type: string, data: Float32Array | BigInt64Array, dims: number[]);
  data: ArrayLike<number | bigint>;
  dims: number[];
  tolist(): unknown;
}
export interface PreTrainedTokenizer {
  (text: string | string[], options?: Record<string, unknown>): { input_ids: Tensor; attention_mask: Tensor };
  apply_chat_template(messages: { role: string; content: string }[], options: Record<string, unknown>): string | unknown;
  decode(tokens: (number | bigint)[], options?: Record<string, unknown>): string;
}
export interface PreTrainedModel {
  (inputs: Record<string, unknown>): Promise<{ logits: Tensor }>;
  generate(options: Record<string, unknown>): Promise<Tensor | object>;
  dispose(): Promise<unknown>;
}
interface Options { session_options?: { logSeverityLevel: number }; revision: string; device?: string; dtype?: string; progress_callback?: (value: { status: string; file?: string; loaded?: number; total?: number }) => void }
export const AutoTokenizer: { from_pretrained(id: string, options: Options): Promise<PreTrainedTokenizer> };
export const AutoModelForCausalLM: { from_pretrained(id: string, options: Options): Promise<PreTrainedModel> };
export const AutoModelForSequenceClassification: typeof AutoModelForCausalLM;
export class LogitsProcessor { _call(ids: bigint[][], logits: Tensor): Tensor }
export class LogitsProcessorList { push(processor: LogitsProcessor): void }
export const env: {
  fetch: typeof globalThis.fetch;
  allowLocalModels: boolean; allowRemoteModels: boolean; remoteHost: string;
  useCustomCache: boolean;
  customCache: { match(key: string): Promise<Response | undefined>; put(key: string, response: Response): Promise<void> };
  useBrowserCache: boolean; useWasmCache: boolean; useFSCache: boolean; logLevel: number;
  backends: { onnx: { logLevel?: string; wasm?: { numThreads?: number; wasmPaths?: string | { mjs: string; wasm: string } } } };
};
