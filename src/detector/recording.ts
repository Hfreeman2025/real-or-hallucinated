import type { DetectorResult, Question } from "./types.ts";
import { parseDetectorResult } from "./validation.ts";

interface Evaluation {
  accuracy: number;
  claimAuroc: number | null;
  semanticAuroc: number | null;
  count: number;
  correct: number;
  answerAccuracy?: number;
  answerCorrect?: number;
  tokenAuroc?: number;
}
export interface Recording {
  recordedAt: string;
  records: DetectorResult[];
  evaluation: Evaluation | null;
  defaultId?: string;
}
function recordObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Invalid recorded evaluation");
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Invalid evaluation number");
  return value;
}
export function parseRecording(value: unknown): Recording {
  const raw = recordObject(value);
  if (!Array.isArray(raw.records) || !raw.records.length || typeof raw.recordedAt !== "string")
    throw new Error("The recorded run is not available yet. The daily game remains ready to play.");
  const ev = raw.evaluation ? recordObject(raw.evaluation) : null;
  return {
    recordedAt: raw.recordedAt,
    records: raw.records.map(parseDetectorResult),
    defaultId: typeof raw.defaultId === "string" ? raw.defaultId : undefined,
    evaluation: ev
      ? {
          accuracy: number(ev.accuracy),
          claimAuroc: ev.claimAuroc === null ? null : number(ev.claimAuroc),
          semanticAuroc: ev.semanticAuroc === null ? null : number(ev.semanticAuroc),
          count: number(ev.count),
          correct: number(ev.correct),
          answerAccuracy: typeof ev.answerAccuracy === "number" ? ev.answerAccuracy : undefined,
          answerCorrect: typeof ev.answerCorrect === "number" ? ev.answerCorrect : undefined,
          tokenAuroc: typeof ev.tokenAuroc === "number" ? ev.tokenAuroc : undefined,
        }
      : null,
  };
}
export function parseQuestions(value: unknown): Question[] {
  const raw = recordObject(value);
  if (!Array.isArray(raw.questions)) throw new Error("Question bank unavailable");
  return raw.questions.map((value) => {
    const q = recordObject(value);
    if (
      typeof q.id !== "string" ||
      typeof q.claimId !== "string" ||
      typeof q.question !== "string" ||
      typeof q.reference !== "string"
    )
      throw new Error("Invalid question");
    return {
      id: q.id,
      claimId: q.claimId,
      question: q.question,
      reference: q.reference,
      patterns: [],
    };
  });
}
