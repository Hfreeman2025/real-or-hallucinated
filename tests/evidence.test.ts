import assert from "node:assert/strict";
import test from "node:test";
import rawBank from "../data/puzzles.json";
import { withVerifiedContexts } from "../scripts/context-refresh.ts";
import { extractContext } from "../src/context.ts";
import { normalize } from "../src/matching.ts";
import { missedTells, splitProof } from "../src/proof.ts";
import { parseBank } from "../src/schema.ts";

test("context retains adjacent sentences and the rest of the supporting sentence", () => {
  const context = extractContext(
    "Before the finding. Scientists found a tiny moon in 1980. Later observations confirmed it. Another topic.",
    "a tiny moon",
  );
  assert.deepEqual(context, {
    before: "Before the finding. Scientists found ",
    match: "a tiny moon",
    after: " in 1980. Later observations confirmed it. ",
  });
});
test("context locates a quote despite Unicode punctuation and multiple whitespace", () => {
  const context = extractContext(
    "First sentence. A planet’s\n rings — are icy. Next sentence.",
    "A planet's rings - are icy.",
  );
  assert.equal(normalize(context.match), "a planet's rings - are icy.");
  assert.equal(context.before, "First sentence. ");
  assert.equal(context.after, " Next sentence.");
});
test("missing and empty quotes never produce invented source context", () => {
  assert.throws(() => extractContext("The real source.", "invented text"), /absent/);
  assert.throws(() => extractContext("The real source.", " "), /Empty/);
});

test("context offsets survive astral symbols and HTML entities before the quote", () => {
  const result = extractContext(
    "A distant object \u{1f6f0} was seen. Fish &amp; chips are here. More follows.",
    "Fish & chips",
  );
  assert.equal(result.match, "Fish & chips");
});

test("all fabrications point at one exact invented phrase and all facts retain source context", () => {
  const bank = parseBank(rawBank);
  for (const claim of bank.puzzles.flatMap((p) => p.claims)) {
    assert.equal(normalize(claim.evidence.context.match), normalize(claim.evidence.quote));
    const parts = splitProof(claim);
    if (claim.real) assert.equal(parts, null);
    else {
      assert.ok(parts);
      assert.equal(parts.before + parts.phrase + parts.after, claim.text);
    }
  }
});
test("proof schema rejects missing, duplicated, or incorrect annotations and invented context", () => {
  const changed = structuredClone(rawBank);
  const fake = changed.puzzles.flatMap((p) => p.claims).find((c) => !c.real);
  assert.ok(fake?.evidence.proof);
  fake.evidence.proof.phrase = "a phrase absent from the claim";
  assert.throws(() => parseBank(changed), /exactly once/);
  const context = structuredClone(rawBank);
  const first = context.puzzles[0]?.claims[0];
  assert.ok(first);
  first.evidence.context.match = "invented supporting text";
  assert.throws(() => parseBank(context), /exact evidence/);
});
test("missed tells are derived from actual mistakes, including facts incorrectly rejected", () => {
  const puzzle = parseBank(rawBank).puzzles[13];
  assert.ok(puzzle);
  const perfect = puzzle.claims.map((c) => c.real);
  assert.deepEqual(missedTells(puzzle.claims, perfect), []);
  const wrong = perfect.map((a) => !a);
  const tells = missedTells(puzzle.claims, wrong);
  assert.equal(tells.length, 5);
  assert.ok(tells.some((t) => t.label === "An unexpected fact was supported"));
  assert.ok(tells.some((t) => t.label === t.claim.evidence.proof?.tell));
  assert.throws(() => missedTells(puzzle.claims, []), /Finish/);
});

test("failed context refresh never partly changes the existing bank or its dates", () => {
  const bank = parseBank(rawBank);
  const before = structuredClone(bank);
  const contexts = new Map(
    bank.puzzles.flatMap((p) => p.claims).map((c) => [c.id, c.evidence.context]),
  );
  contexts.delete("h-35");
  assert.throws(() => withVerifiedContexts(bank, contexts, "2026-11-02"), /Every claim/);
  assert.deepEqual(bank, before);
});
test("context refresh rejects an invented passage without changing the input", () => {
  const bank = parseBank(rawBank);
  const before = structuredClone(bank);
  const contexts = new Map(
    bank.puzzles.flatMap((p) => p.claims).map((c) => [c.id, c.evidence.context]),
  );
  contexts.set("h-35", { before: "", match: "not on the cited page", after: "" });
  assert.throws(() => withVerifiedContexts(bank, contexts, "2026-11-02"), /exact evidence/);
  assert.deepEqual(bank, before);
});
test("successful context refresh updates every context date and preserves original claim-check provenance", () => {
  const bank = parseBank(rawBank);
  const before = structuredClone(bank);
  const contexts = new Map(
    bank.puzzles.flatMap((p) => p.claims).map((c) => [c.id, c.evidence.context]),
  );
  const refreshed = withVerifiedContexts(bank, contexts, "2027-01-01");
  assert.ok(
    refreshed.puzzles
      .flatMap((p) => p.claims)
      .every((c) => c.evidence.contextCheckedOn === "2027-01-01"),
  );
  assert.deepEqual(bank, before);
  assert.deepEqual(
    refreshed.puzzles.flatMap((p) => p.claims).map((c) => c.evidence.checkedOn),
    before.puzzles.flatMap((p) => p.claims).map((c) => c.evidence.checkedOn),
  );
});
