import assert from "node:assert/strict";
import test from "node:test";
import rawBank from "../data/puzzles.json";
import { displaySourceText } from "../src/display.ts";
import { quoteMatches } from "../src/matching.ts";
import { parseBank } from "../src/schema.ts";
import { sourcePassage } from "../src/views.ts";

test("source typography restores recognized chemical subscripts without guessing at other numbers", () => {
  assert.equal(
    displaySourceText("CO 2 mole fraction; CO2, H 2 O, CH 4 and N 2 O."),
    "CO₂ mole fraction; CO₂, H₂O, CH₄ and N₂O.",
  );
  assert.equal(
    displaySourceText("CO\u00a02 and H2O; CO₂ is already typeset."),
    "CO₂ and H₂O; CO₂ is already typeset.",
  );
  const ordinary = "280 ppm in 1800; 2 000 meters; CO 2026; XCO 2; CO2X; H 2 observations.";
  assert.equal(displaySourceText(ordinary), ordinary);
});

test("formatting a revealed passage leaves all stored evidence bytes and matching rules unchanged", () => {
  const bank = parseBank(rawBank);
  const before = JSON.stringify(bank);
  const claim = bank.puzzles
    .flatMap((p) => p.claims)
    .find((c) => c.evidence.context.before.includes("CO 2 mole fraction"));
  assert.ok(claim);
  const html = sourcePassage(claim);
  assert.ok(html.includes("CO₂ mole fraction"));
  assert.ok(!html.includes("CO 2"));
  assert.equal(JSON.stringify(bank), before);
  assert.equal(quoteMatches("CO 2 mole fraction", "CO 2 mole fraction"), true);
  assert.equal(quoteMatches("CO 2 mole fraction", "CO₂ mole fraction"), false);
});

test("display formatting still escapes source HTML and applies to highlighted quotes", () => {
  const claim = structuredClone(parseBank(rawBank).puzzles[0]?.claims[0]);
  assert.ok(claim);
  claim.evidence.context = { before: "<script>CO 2</script>", match: "H 2 O", after: " & CH4" };
  const html = sourcePassage(claim);
  assert.ok(html.includes("&lt;script&gt;CO₂&lt;/script&gt;"));
  assert.ok(html.includes("<mark>H₂O</mark>"));
  assert.ok(html.includes("&amp; CH₄"));
  assert.ok(!html.includes("<script>"));
});
