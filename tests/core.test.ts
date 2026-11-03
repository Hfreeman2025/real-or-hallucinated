import assert from "node:assert/strict";
import test from "node:test";
import { londonDate, puzzleIndex, score, shareText, streak } from "../src/core.ts";
import { htmlText, normalize, quoteMatches } from "../src/matching.ts";

test("London date changes at BST midnight, independent of UTC date", () => {
  assert.equal(londonDate(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
  assert.equal(londonDate(new Date("2026-12-01T23:30:00Z")), "2026-12-01");
});
test("spring and autumn DST transition instants remain on the correct calendar day", () => {
  for (const instant of ["2026-03-29T00:59:59Z", "2026-03-29T01:00:00Z"])
    assert.equal(londonDate(new Date(instant)), "2026-03-29");
  for (const instant of ["2026-10-25T00:59:59Z", "2026-10-25T01:00:00Z"])
    assert.equal(londonDate(new Date(instant)), "2026-10-25");
});
test("rotation handles day boundaries, dates before launch, and repeats after fourteen", () => {
  assert.equal(puzzleIndex("2026-11-01", "2026-10-19", 14), 13);
  assert.equal(puzzleIndex("2026-11-02", "2026-10-19", 14), 0);
  assert.equal(puzzleIndex("2026-10-18", "2026-10-19", 14), 13);
  assert.throws(() => puzzleIndex("2026-02-30", "2026-10-19", 14));
  assert.throws(() => puzzleIndex("2026-11-01", "2026-10-19", 0));
});
test("scoring compares answers with truth and rejects incomplete or oversized rounds", () => {
  assert.equal(score([true, false, true, false, true], [true, false, false, false, true]), 4);
  assert.throws(() => score([true], [true, false]));
});
test("streak counts completed London dates once and allows yesterday before today is played", () => {
  assert.equal(streak(["2026-10-30", "2026-10-31", "2026-10-31"], "2026-11-01"), 2);
  assert.equal(streak(["2026-10-30", "2026-11-01"], "2026-11-01"), 1);
  assert.equal(streak(["2026-10-29"], "2026-11-01"), 0);
  assert.equal(streak(["2026-10-31", "2026-11-01", "2026-11-02"], "2026-11-01"), 2);
});
test("share text uses only ASCII, score, and correctness marks, never truth or claim content", () => {
  const result = shareText("2026-11-01", 3, [true, false, true, true, false]);
  assert.equal(
    result,
    "Real or Hallucinated?\n1 Nov 2026 | 3/5\n[+] [-] [+] [+] [-]\nFive claims checked.",
  );
  assert.match(result, /^[\x20-\x7E\n]+$/);
  assert.throws(() => shareText("2026-11-01", 5, [true, false, true, true, false]));
});
test("quote matching normalizes entities, whitespace, curly punctuation, and dashes", () => {
  assert.equal(normalize(" “A\u00a0day”—it’s  24 hours. "), '"a day"-it\'s 24 hours.');
  assert.equal(
    quoteMatches("Text: A planet’s\n  rings — are icy.", "A planet's rings - are icy."),
    true,
  );
  assert.equal(quoteMatches("The number is 24.", "The number is 42."), false);
  assert.equal(quoteMatches("anything", ""), false);
});
test("HTML extraction ignores script/style and preserves text boundaries and entities", () => {
  const text = htmlText(
    "<p>Saturn &amp; Jupiter</p><script>wrong</script><style>wrong</style><p>don&#39;t</p>",
  );
  assert.equal(normalize(text), "saturn & jupiter don't");
});

test("a daily score requires exactly five answers", () => {
  assert.throws(() => score(Array(6).fill(true), Array(6).fill(true)));
  assert.throws(() => score([], []));
});
test("streaks remain consecutive across DST, a leap day, and New Year", () => {
  assert.equal(streak(["2026-03-28", "2026-03-29", "2026-03-30"], "2026-03-30"), 3);
  assert.equal(streak(["2024-02-28", "2024-02-29", "2024-03-01"], "2024-03-01"), 3);
  assert.equal(streak(["2026-12-31", "2027-01-01"], "2027-01-01"), 2);
});
