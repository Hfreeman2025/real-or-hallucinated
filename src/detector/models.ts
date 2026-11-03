export const GENERATOR = {
  id: "onnx-community/Qwen2.5-0.5B-Instruct",
  revision: "22942cb7d7ba4cc81bb4673549ca4d4614469b5e",
  bytes: 786156820,
  dtype: "q4",
  name: "Qwen2.5 0.5B",
  eosTokenIds: [151645, 151643], // Pinned generation_config.json; EOS at the cap is a completed answer.
} as const;
export const NLI = {
  id: "Xenova/nli-deberta-v3-xsmall",
  revision: "2a4f614a701367a02d51389039afc998faeda637",
  bytes: 87246587,
} as const;
export const SAMPLE_COUNT = 5;
export const MAX_TOKENS = 32;
export const TEMPERATURE = 0.9;
export const CLUSTER_THRESHOLD = 0.6;

export const TOP_P = 0.95;
export const SYSTEM_PROMPT =
  "Answer the factual question directly with only a short answer. Do not repeat the question. No explanation.";

export const TOP_K = 40;
export const REPETITION_PENALTY = 1.1;
