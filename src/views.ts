import { displayDate, londonDate, score } from "./core.ts";
import { displaySourceText } from "./display.ts";
import { escapeHtml as e } from "./dom.ts";
import { missedTells, splitProof } from "./proof.ts";
import type { Claim, Puzzle } from "./schema.ts";
import type { Round } from "./storage.ts";

export function progress(puzzle: Puzzle, round: Round): string {
  return `<ol class="progress" aria-label="Round progress">${puzzle.claims
    .map((claim, i) => {
      const answer = round.answers[i];
      const done = answer !== undefined;
      return `<li class="${done ? (answer === claim.real ? "correct" : "missed") : i === round.reviewed ? "current" : ""}" ${i === round.reviewed ? 'aria-current="step"' : ""}><span>${i + 1}</span><span>${done ? (answer === claim.real ? "Correct" : "Missed") : i === round.reviewed ? "Checking" : "Pending"}</span></li>`;
    })
    .join("")}</ol>`;
}
export function sourceRecord(claim: Claim): string {
  return `<div class="source-record"><p class="publisher">${e(claim.source.publisher)}</p><p class="source-title">${e(claim.source.title)}</p><a class="source-link" href="${e(claim.source.url)}" target="_blank" rel="noopener noreferrer">${e(new URL(claim.source.url).hostname)} <span class="source-link-label">Open original source</span></a></div>`;
}
export function sourcePassage(claim: Claim): string {
  const context = claim.evidence.context;
  return `<div class="source-passage"><p class="section-label">${claim.real ? "Supporting passage" : "Correcting passage"}</p><blockquote><span class="context">${e(displaySourceText(context.before))}</span><mark>${e(displaySourceText(context.match))}</mark><span class="context">${e(displaySourceText(context.after))}</span></blockquote><p class="quote-key">Highlighted words locate the stored evidence quote within its source. Chemical formulas are typeset for reading; stored text is unchanged.</p><p class="checked">Passage checked ${displayDate(claim.evidence.contextCheckedOn)}.</p></div>`;
}
function claimCopy(claim: Claim, revealed: boolean): string {
  const parts = revealed ? splitProof(claim) : null;
  if (!parts) return e(claim.text);
  return `${e(parts.before)}<button type="button" class="proof-phrase" id="proof-phrase" aria-describedby="proof-note" aria-label="Marked phrase: ${e(parts.phrase)}. Read editor note.">${e(parts.phrase)}</button>${e(parts.after)}`;
}
export function roundView(puzzle: Puzzle, round: Round): string {
  const claim = puzzle.claims[Math.min(round.reviewed, 4)];
  if (!claim) throw new Error("Missing claim");
  const revealed = round.answers.length > round.reviewed;
  const correct = round.answers[round.reviewed] === claim.real;
  const edit = claim.evidence.proof;
  return `<div class="round-bar"><span>Daily edition</span>${progress(puzzle, round)}<span class="round-count">${round.answers.length} / 5 checked</span></div>
  <div class="checking-desk ${revealed ? "is-revealed" : ""} ${revealed && !claim.real ? "has-correction" : ""}">
    <article class="copy-desk" aria-labelledby="active-claim"><div class="case-heading"><span>Claim ${round.reviewed + 1} of 5</span><span>${e(claim.topic)}</span></div>
    <p class="claim-status">${revealed ? (claim.real ? "Checked fact" : "Fabricated claim") : "Unverified claim · may be fabricated"}</p>
    <div class="proof-layout"><h2 class="claim-text" id="active-claim">${claimCopy(claim, revealed)}</h2>
    ${revealed && edit ? `<aside class="editor-note" id="proof-note" tabindex="-1"><span class="note-label">${e(edit.kind)} corrected</span><strong>${e(edit.replacement)}</strong><p>${e(edit.reason)}</p></aside>` : !revealed ? '<aside class="proof-waiting"><span class="note-label">Editor’s margin</span><p>Any altered wording will be marked here after your decision.</p></aside>' : ""}</div>
    <div class="decision-area">${revealed ? `<div class="verdict-line"><h3 id="verdict" tabindex="-1">${claim.real ? "Real" : "Hallucinated"}</h3><span>${correct ? "Your answer was correct." : "Your answer was incorrect."}</span></div><button type="button" class="next-button" id="next">${round.reviewed === 4 ? "Review your five claims" : "Next claim"} <span aria-hidden="true">→</span></button>` : `<div class="answer-buttons" role="group" aria-labelledby="active-claim"><button type="button" id="answer-fake"><span aria-hidden="true">←</span> Hallucinated</button><button type="button" id="answer-real">Real <span aria-hidden="true">→</span></button></div><p class="input-hint">Choose a button, use arrow keys, or swipe the claim.</p>`}</div></article>
    <section class="evidence-desk" aria-labelledby="source-heading"><div class="case-heading"><h3 id="source-heading" tabindex="-1">Source record</h3><span>${revealed ? (claim.real ? "Real · verified passage" : "Fabricated · correction") : "Passage sealed"}</span></div>${sourceRecord(claim)}
    ${revealed ? `${sourcePassage(claim)}<details class="source-analysis"><summary>${claim.real ? "Why this supports the claim" : "Why this contradicts the claim"}</summary><p>${e(claim.evidence.explanation)}</p></details>` : `<div class="sealed-evidence"><p class="section-label">Evidence sealed</p><h4>Citation on record.<br>Passage held back.</h4><p>Decide whether this source supports the claim. Your decision opens the checked passage.</p><p class="checked">Source checked ${displayDate(claim.evidence.contextCheckedOn)}.<br>Bundled evidence, ready to open. No live request.</p></div>`}</section></div>`;
}
export function summaryView(puzzle: Puzzle, round: Round, date: string): string {
  const correct = score(
    round.answers,
    puzzle.claims.map((c) => c.real),
  );
  const tells = missedTells(puzzle.claims, round.answers);
  return `<div class="round-bar"><span>Edition complete</span>${progress(puzzle, round)}<span class="round-count">5 / 5 checked</span></div><div class="summary-layout"><section class="result-panel"><p class="section-label">${displayDate(date)}</p><h2 class="score" id="summary-title" tabindex="-1">${correct}<span>/5</span></h2><p class="result-label">claims correctly assessed</p><p class="result-description">${tells.length ? `${tells.length} ${tells.length === 1 ? "decision needs" : "decisions need"} a closer look. The evidence is below.` : "You identified every verdict. Review the source records below."}</p><button type="button" class="next-button" id="share">Copy result</button><p class="share-caption" id="share-status" role="status">Plain text. No claims or answers included.</p><div id="share-fallback"></div><button type="button" class="secondary-button" id="another-day">Choose another day</button><p class="checked">${date === londonDate() ? "The next edition opens at midnight, Europe/London." : "Archive play does not backfill the daily streak."}</p></section>
  <section class="tells-panel" aria-labelledby="tells-title"><div class="case-heading"><h3 id="tells-title">The tells you missed</h3><span>${tells.length} ${tells.length === 1 ? "finding" : "findings"}</span></div>
  ${tells.length ? tells.map((tell) => `<article class="missed-tell"><p class="tell-type">${tell.claim.real ? "A real claim rejected" : "A fabrication accepted"}</p><h4>${e(tell.label)}</h4><p>${e(tell.reason)}</p><p class="tell-claim"><strong>${tell.claim.real ? "Checked fact" : "Fabricated claim"}:</strong> ${e(tell.claim.text)}</p>${tell.claim.evidence.proof ? `<p class="tell-correction"><del>${e(tell.claim.evidence.proof.phrase)}</del><span>${e(tell.claim.evidence.proof.replacement)}</span></p>` : ""}</article>`).join("") : '<div class="perfect-result"><h4>No missed tells.</h4><p>All five decisions matched the checked sources.</p></div>'}
  <h3 class="review-heading">All five source records</h3><div class="summary-review">${puzzle.claims.map((claim, i) => `<details><summary><span class="review-result ${round.answers[i] === claim.real ? "right" : "wrong"}">${round.answers[i] === claim.real ? "Correct" : "Missed"}</span><span class="review-claim"><small>${claim.real ? "Checked fact" : "Fabricated claim"}</small>${e(claim.text)}</span><span class="review-toggle" aria-hidden="true">+</span></summary><div class="review-body">${sourceRecord(claim)}${sourcePassage(claim)}<p>${e(claim.evidence.explanation)}</p></div></details>`).join("")}</div></section></div>`;
}
