export interface TokenConfidence {
  id: number;
  text: string;
  probability: number;
}
export interface AnswerSample {
  truncated: boolean;
  text: string;
  tokens: TokenConfidence[];
  meanLogProbability: number;
  milliseconds: number;
}
export interface Entailment {
  entailment: number;
  contradiction: number;
  neutral: number;
}
export interface PairEvidence {
  a: number;
  b: number;
  forward: Entailment;
  backward: Entailment;
}
export interface DetectorInput {
  id: string;
  question: string;
  claim: string;
  seed: number;
}
export interface DetectorResult {
  input: DetectorInput;
  samples: AnswerSample[];
  pairs: PairEvidence[];
  claimRelations: Entailment[];
  clusters: number[][];
  entropyBits: number;
  normalizedEntropy: number;
  support: number;
  predictedReal: boolean;
  threshold: number;
  milliseconds: number;
  backend: string;
}
export interface DownloadProgress {
  file: string;
  loaded: number;
  total: number;
  stage: string;
}
export type EngineEvent =
  | { type: "progress"; progress: DownloadProgress }
  | { type: "sample"; sample: AnswerSample; index: number }
  | { type: "phase"; phase: string }
  | { type: "pair"; pair: PairEvidence };
export interface Question {
  id: string;
  claimId: string;
  question: string;
  reference: string;
  patterns: string[];
}
