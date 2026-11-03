import {
  AutoModelForCausalLM,
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  LogitsProcessor,
  LogitsProcessorList,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  Tensor,
} from "../../vendor/transformers/transformers.web.js";
import { claimSupport, meaningClusters, seededRandom, semanticEntropy, softmax } from "./math.ts";
import { modelCache } from "./model-cache.ts";
import { pinModelRequest } from "./model-request.ts";
import {
  CLUSTER_THRESHOLD,
  GENERATOR,
  MAX_TOKENS,
  NLI,
  REPETITION_PENALTY,
  SAMPLE_COUNT,
  SYSTEM_PROMPT,
  TEMPERATURE,
  TOP_K,
  TOP_P,
} from "./models.ts";
import { drawToken } from "./sampling.ts";
import type {
  AnswerSample,
  DetectorInput,
  DetectorResult,
  EngineEvent,
  Entailment,
  TokenConfidence,
} from "./types.ts";

export interface Engine {
  generator: PreTrainedModel;
  tokenizer: PreTrainedTokenizer;
  nli: PreTrainedModel;
  nliTokenizer: PreTrainedTokenizer;
  backend: string;
}
export interface LoadOptions {
  generatorDevice?: "webgpu" | "wasm";
  modelHost: string;
  cache: boolean;
  signal: AbortSignal;
  emit: (event: EngineEvent) => void;
}

export async function loadEngine(options: LoadOptions): Promise<Engine> {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = options.modelHost;
  env.useBrowserCache = false;
  env.useWasmCache = false;
  env.useCustomCache = false;
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
      env.useCustomCache = true;
      env.customCache = cache;
    }
  }
  // Runtime modules use immutable same-origin HTTP caching; model weights use Cache API.
  env.useFSCache = false;
  env.backends.onnx.logLevel = "error";
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    wasm.wasmPaths = `${globalThis.location.origin}/runtime/`;
  }
  const nativeFetch = globalThis.fetch.bind(globalThis);
  env.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return nativeFetch(url.includes("/resolve/") ? pinModelRequest(url) : input, {
      ...init,
      signal: options.signal,
      ...(options.cache ? {} : { cache: "no-store" as const }),
    });
  };
  const progress_callback = (progress: {
    status: string;
    name?: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    options.emit({
      type: "progress",
      progress: {
        file: `${progress.name ?? "Model"} / ${progress.file ?? "files"}`,
        loaded: progress.loaded ?? 0,
        total: progress.total ?? 0,
        stage: progress.status,
      },
    });
  };
  options.emit({
    type: "phase",
    phase: `Loading ${GENERATOR.name} · ${options.generatorDevice ?? "webgpu"}`,
  });
  const tokenizer = await AutoTokenizer.from_pretrained(GENERATOR.id, {
    revision: GENERATOR.revision,
    progress_callback,
  });
  const generator = await AutoModelForCausalLM.from_pretrained(GENERATOR.id, {
    revision: GENERATOR.revision,
    device: options.generatorDevice ?? "webgpu",
    dtype: "q4",
    session_options: { logSeverityLevel: 3 },
    progress_callback,
  });
  options.signal.throwIfAborted();
  options.emit({ type: "phase", phase: "Loading DeBERTa · WebAssembly" });
  const nliTokenizer = await AutoTokenizer.from_pretrained(NLI.id, {
    revision: NLI.revision,
    progress_callback,
  });
  const nli = await AutoModelForSequenceClassification.from_pretrained(NLI.id, {
    revision: NLI.revision,
    device: "wasm",
    dtype: "q8",
    session_options: { logSeverityLevel: 3 },
    progress_callback,
  });
  options.signal.throwIfAborted();
  return {
    generator,
    tokenizer,
    nli,
    nliTokenizer,
    backend: `${GENERATOR.name} ${options.generatorDevice ?? "webgpu"} q4 · DeBERTa WASM q8, one thread`,
  };
}

/** Own seeded sampler: raw confidence is captured before every sampling transform. */
class TokenTrace extends LogitsProcessor {
  tokens: { id: number; probability: number }[] = [];
  private random: () => number;
  constructor(seed: number) {
    super();
    this.random = seededRandom(seed);
  }
  _call(input_ids: bigint[][], logits: Tensor): Tensor {
    const data = logits.data;
    if (!(data instanceof Float32Array)) throw new Error("Expected float32 generator logits");
    const draw = drawToken(
      data,
      { temperature: TEMPERATURE, topK: TOP_K, topP: TOP_P, repetitionPenalty: REPETITION_PENALTY },
      this.random,
      new Set((input_ids[0] ?? []).map(Number)),
    );
    this.tokens.push({ id: draw.id, probability: draw.modelProbability });
    // The SDK greedy step carries our sampled token through its KV-cache machinery.
    // No global Math.random patch, and no reliance on its inactive top-p option.
    data.fill(-Infinity);
    data[draw.id] = 0;
    return logits;
  }
}
function sequenceIds(value: unknown): bigint[] {
  if (
    !Array.isArray(value) ||
    !Array.isArray(value[0]) ||
    !value[0].every(
      (n: unknown) => typeof n === "bigint" || (typeof n === "number" && Number.isInteger(n)),
    )
  )
    throw new Error("Invalid generated sequence");
  return value[0].map((n: bigint | number) => BigInt(n));
}
async function sample(engine: Engine, question: string, seed: number): Promise<AnswerSample> {
  const start = performance.now();
  const prompt = engine.tokenizer.apply_chat_template(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question },
    ],
    { tokenize: false, add_generation_prompt: true },
  );
  if (typeof prompt !== "string") throw new Error("Invalid chat template");
  const inputs = engine.tokenizer(prompt);
  const inputLength = inputs.input_ids.dims[1];
  if (
    typeof inputLength !== "number" ||
    !Number.isInteger(inputLength) ||
    inputLength < 1 ||
    inputs.input_ids.dims.length !== 2
  )
    throw new Error("Invalid prompt token dimensions");
  const trace = new TokenTrace(seed);
  const processors = new LogitsProcessorList();
  processors.push(trace);
  {
    const generated = await engine.generator.generate({
      ...inputs,
      max_new_tokens: MAX_TOKENS,
      do_sample: false,
      temperature: 1,
      top_p: 1,
      top_k: 0,
      repetition_penalty: 1,
      logits_processor: processors,
    });
    if (!(generated instanceof Tensor)) throw new Error("No generated tensor");
    const ids = sequenceIds(generated.tolist()).slice(inputLength);
    if (trace.tokens.length !== ids.length)
      throw new Error("Token confidence trace diverged from generation");
    const tokens: TokenConfidence[] = trace.tokens
      .map((t) => ({ ...t, text: engine.tokenizer.decode([t.id], { skip_special_tokens: true }) }))
      .filter((t) => t.text.length > 0);
    if (!tokens.length) throw new Error("Model returned an empty answer");
    const text = engine.tokenizer.decode(ids, { skip_special_tokens: true }).trim();
    return {
      truncated:
        ids.length >= MAX_TOKENS && !GENERATOR.eosTokenIds.some((id) => BigInt(id) === ids.at(-1)),
      text,
      tokens,
      meanLogProbability:
        tokens.reduce((sum, t) => sum + Math.log(Math.max(t.probability, Number.MIN_VALUE)), 0) /
        tokens.length,
      milliseconds: performance.now() - start,
    };
  }
}
async function infer(
  engine: Engine,
  premises: string[],
  hypotheses: string[],
): Promise<Entailment[]> {
  const inputs = engine.nliTokenizer(premises, {
    text_pair: hypotheses,
    padding: true,
    truncation: true,
    max_length: 192,
  });
  const output = await engine.nli(inputs);
  if (!(output.logits instanceof Tensor) || output.logits.dims[1] !== 3)
    throw new Error("Invalid NLI logits");
  const labels: Record<number, string> = { 0: "contradiction", 1: "entailment", 2: "neutral" };
  const rows = output.logits.tolist();
  if (!Array.isArray(rows) || rows.length !== premises.length) throw new Error("Invalid NLI batch");
  return rows.map((row: unknown) => {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      !row.every((v: unknown) => typeof v === "number")
    )
      throw new Error("Invalid NLI probabilities");
    const probabilities = softmax(row);
    const result: Entailment = { entailment: 0, contradiction: 0, neutral: 0 };
    probabilities.forEach((p, i) => {
      const label = String(labels?.[i] ?? "").toLowerCase();
      if (label === "entailment" || label === "contradiction" || label === "neutral")
        result[label] = p;
      else throw new Error("Unknown NLI label mapping");
    });
    return result;
  });
}
export async function runDetector(
  engine: Engine,
  input: DetectorInput,
  emit: (event: EngineEvent) => void,
  signal: AbortSignal,
): Promise<DetectorResult> {
  const start = performance.now();
  const samples: AnswerSample[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    signal.throwIfAborted();
    emit({ type: "phase", phase: `Sampling answer ${i + 1} of ${SAMPLE_COUNT}` });
    const answer = await sample(engine, input.question, input.seed + i * 1009);
    samples.push(answer);
    emit({ type: "sample", sample: answer, index: i });
  }
  const pairs: DetectorResult["pairs"] = [];
  for (let a = 0; a < SAMPLE_COUNT; a++)
    for (let b = a + 1; b < SAMPLE_COUNT; b++) {
      signal.throwIfAborted();
      emit({
        type: "phase",
        phase: `Testing both entailment directions · pair ${pairs.length + 1} of 10`,
      });
      const aa = samples[a]?.text;
      const bb = samples[b]?.text;
      if (!aa || !bb) throw new Error("Missing answer sample");
      const relation = await infer(
        engine,
        [`Question: ${input.question} Answer: ${aa}`, `Question: ${input.question} Answer: ${bb}`],
        [`Question: ${input.question} Answer: ${bb}`, `Question: ${input.question} Answer: ${aa}`],
      );
      const forward = relation[0];
      const backward = relation[1];
      if (!forward || !backward) throw new Error("Missing entailment direction");
      const pair = { a, b, forward, backward };
      pairs.push(pair);
      emit({ type: "pair", pair });
    }
  signal.throwIfAborted();
  emit({ type: "phase", phase: "Comparing sampled answers with the claim" });
  const claimRelations = await infer(
    engine,
    samples.map((s) => `Question: ${input.question} Answer: ${s.text}`),
    samples.map(() => input.claim),
  );
  const clusters = meaningClusters(SAMPLE_COUNT, pairs, CLUSTER_THRESHOLD);
  const entropyBits = semanticEntropy(clusters);
  const normalizedEntropy = entropyBits / Math.log2(SAMPLE_COUNT);
  const support = claimSupport(claimRelations);
  return {
    input,
    samples,
    pairs,
    claimRelations,
    clusters,
    entropyBits,
    normalizedEntropy,
    support,
    predictedReal: support >= 0.5,
    threshold: CLUSTER_THRESHOLD,
    milliseconds: performance.now() - start,
    backend: engine.backend,
  };
}
export async function disposeEngine(engine: Engine): Promise<void> {
  await engine.generator.dispose();
  await engine.nli.dispose();
}
