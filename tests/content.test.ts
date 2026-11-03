import assert from "node:assert/strict";
import test from "node:test";
import rawBank from "../data/puzzles.json";
import { parseBank, sourceUrl } from "../src/schema.ts";
import { emptyHistory, loadHistory, parseHistory, saveHistory } from "../src/storage.ts";

test("all fourteen editions contain five distinct claims, every topic, and varied truth ratios", () => {
  const bank = parseBank(rawBank);
  assert.equal(bank.puzzles.length, 14);
  assert.equal(bank.puzzles.flatMap((p) => p.claims).length, 70);
  assert.equal(bank.puzzles.flatMap((p) => p.claims).filter((c) => c.real).length, 35);
  assert.ok(new Set(bank.puzzles.map((p) => p.claims.filter((c) => c.real).length)).size >= 3);
});
test("bank rejects absent evidence, contradictory verdict method, invalid date, and duplicate text", () => {
  const changed = () => structuredClone(rawBank);
  const absent = changed();
  absent.puzzles[0]?.claims.splice(0, 1);
  assert.throws(() => parseBank(absent));
  const noQuote = changed();
  const first = noQuote.puzzles[0]?.claims[0];
  if (first) first.evidence.quote = "";
  assert.throws(() => parseBank(noQuote));
  const method = changed();
  const mc = method.puzzles[0]?.claims[0];
  if (mc) mc.real = !mc.real;
  assert.throws(() => parseBank(method));
  const date = changed();
  date.startDate = "2026-02-30";
  assert.throws(() => parseBank(date));
  const duplicate = changed();
  const dc = duplicate.puzzles[0]?.claims[1];
  if (dc) dc.text = duplicate.puzzles[0]?.claims[0]?.text ?? "";
  assert.throws(() => parseBank(duplicate));
});
test("source URLs exclude scripts, plain HTTP, unrelated hosts, and embedded credentials", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://science.nasa.gov/",
    "https://example.org/",
    "https://user:pass@science.nasa.gov/",
  ])
    assert.throws(() => sourceUrl(url));
  assert.equal(
    sourceUrl("https://science.nasa.gov/moon/facts/"),
    "https://science.nasa.gov/moon/facts/",
  );
});
test("invalid saved state never gets cast into a valid game", () => {
  for (const bad of [
    null,
    { version: 1, rounds: {}, completedDates: ["2026-11-01"] },
    {
      version: 1,
      rounds: { "2026-11-01": { editionId: "a", answers: [1], reviewed: 0 } },
      completedDates: [],
    },
    {
      version: 1,
      rounds: { "2026-11-01": { editionId: "a", answers: [true], reviewed: 2 } },
      completedDates: [],
    },
  ])
    assert.throws(() => parseHistory(bad));
});
test("storage round-trips a locked reveal and completion without changing the answers", () => {
  let saved: string | null = null;
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  };
  const history = emptyHistory();
  history.rounds["2026-11-01"] = { editionId: "edition-14", answers: [true, false], reviewed: 1 };
  assert.equal(saveHistory(storage, history), null);
  assert.deepEqual(loadHistory(storage), { history, error: null });
});
test("corrupt and blocked storage preserve playability with an explicit error", () => {
  const corrupt = loadHistory({ getItem: () => "{invalid", setItem: () => {} });
  assert.deepEqual(corrupt.history, emptyHistory());
  assert.match(corrupt.error ?? "", /could not be read/);
  const blocked = {
    getItem: (): null => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.match(loadHistory(blocked).error ?? "", /could not be read/);
  assert.match(saveHistory(blocked, emptyHistory()) ?? "", /could not save/);
});

test("each daily round spans three topics and never repeats a source that could give a later answer away", () => {
  const bank = parseBank(rawBank);
  for (const puzzle of bank.puzzles) {
    assert.equal(new Set(puzzle.claims.map((c) => c.source.url)).size, 5);
    assert.ok(new Set(puzzle.claims.map((c) => c.topic)).size >= 3);
  }
});

test("bank rejects repeated source pages within a daily edition", () => {
  const changed = structuredClone(rawBank);
  const first = changed.puzzles[0]?.claims[0];
  const second = changed.puzzles[0]?.claims[1];
  if (first && second) second.source = first.source;
  assert.throws(() => parseBank(changed), /source/);
});
