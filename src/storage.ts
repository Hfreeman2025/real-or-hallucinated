import { dayNumber } from "./core.ts";
import { record } from "./schema.ts";
export interface Round {
  editionId: string;
  answers: boolean[];
  reviewed: number;
}
export interface History {
  version: 1;
  rounds: Record<string, Round>;
  completedDates: string[];
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const emptyHistory = (): History => ({ version: 1, rounds: {}, completedDates: [] });
const KEY = "real-or-hallucinated:v1";
export function parseHistory(value: unknown): History {
  if (
    !record(value) ||
    value.version !== 1 ||
    !record(value.rounds) ||
    !Array.isArray(value.completedDates)
  )
    throw new Error("Invalid saved progress");
  const rounds: Record<string, Round> = {};
  for (const [date, round] of Object.entries(value.rounds)) {
    dayNumber(date);
    if (
      !record(round) ||
      typeof round.editionId !== "string" ||
      !Array.isArray(round.answers) ||
      round.answers.length > 5 ||
      !round.answers.every((a: unknown) => typeof a === "boolean") ||
      typeof round.reviewed !== "number" ||
      !Number.isInteger(round.reviewed) ||
      round.reviewed < 0 ||
      round.reviewed > round.answers.length ||
      round.answers.length - round.reviewed > 1
    )
      throw new Error("Invalid saved round");
    rounds[date] = { editionId: round.editionId, answers: round.answers, reviewed: round.reviewed };
  }
  const completedDates = value.completedDates.map((date: unknown) => {
    if (typeof date !== "string") throw new Error("Invalid completion date");
    dayNumber(date);
    if (rounds[date]?.reviewed !== 5) throw new Error("Completion requires five reviewed claims");
    return date;
  });
  return { version: 1, rounds, completedDates: [...new Set(completedDates)] };
}
export function loadHistory(storage: StorageLike): { history: History; error: string | null } {
  try {
    const raw = storage.getItem(KEY);
    return { history: raw === null ? emptyHistory() : parseHistory(JSON.parse(raw)), error: null };
  } catch {
    return {
      history: emptyHistory(),
      error: "Saved progress could not be read. You can still play; this session starts fresh.",
    };
  }
}
export function saveHistory(storage: StorageLike, history: History): string | null {
  try {
    storage.setItem(KEY, JSON.stringify(history));
    return null;
  } catch {
    return "Your browser could not save progress. This round works, but may be lost when you close it.";
  }
}
