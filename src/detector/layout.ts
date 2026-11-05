import { escapeHtml as e } from "../dom.ts";
import type { Claim } from "../schema.ts";
import { GENERATOR, MAX_TOKENS } from "./models.ts";
import type { Recording } from "./recording.ts";
import type { AnswerSample } from "./types.ts";

function fixed(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(2);
}
// Keep source-formatting newlines out of the rendered token and view text.
function compact(markup: string): string {
  return markup.replace(/>\n</g, "><");
}

export function detectorMarkup(
  recording: Recording,
  activeId: string,
  claims: ReadonlyMap<string, Claim>,
  bytes: number,
  webKit: boolean,
): string {
  return compact(`<div class="detector-heading">
<div>
<h2>Lie detector</h2>
<p>Ask a small model five times. Check whether its answers agree in meaning.</p>
</div>
<div class="detector-mode-links">
<a href="#live-heading">Run live</a>
<a href="#detector-method">How this works</a>
</div>
</div>
    <div class="detector-controls">
<label for="detector-question">Source-checked question<select id="detector-question">${recording.records.map((r) => `<option value="${e(r.input.id)}" ${r.input.id === activeId ? "selected" : ""}>${e(r.input.question)}</option>`).join("")}</select>
</label>
<button type="button" id="detector-replay">Replay clustering</button>
</div>
    <div class="detector-desk">
<section class="detector-copy" aria-labelledby="detector-claim">
<div class="case-heading">
<span>Your judgement</span>
<span id="detector-topic">
</span>
</div>
<p class="claim-status" id="detector-claim-status">Unverified claim · may be fabricated</p>
<h3 id="detector-claim" class="detector-claim">
</h3>
<div id="detector-guess" class="answer-buttons">
<button type="button" data-guess="fake">Hallucinated</button>
<button type="button" data-guess="real">Real</button>
</div>
<p class="detector-hint">Make your call, then let the verified source settle it.</p>
<div id="detector-comparison" tabindex="-1" aria-label="Your decision, the detector and the verified source">
</div>
<div class="detector-citation" id="detector-citation">
</div>
</section>
    <section class="meaning-desk" aria-labelledby="meaning-heading">
<div class="case-heading">
<h3 id="meaning-heading">Semantic entropy</h3>
<span id="detector-origin">Recorded model run</span>
</div>
<p id="meaning-question" class="meaning-question">
</p>
<div class="entropy-readout">
<div>
<strong id="entropy-number">—</strong>
<span>bits of meaning uncertainty</span>
</div>
<div class="meaning-count">
<strong id="meaning-count">5 → ?</strong>
<span>answers → inferred meanings</span>
</div>
</div>
<div class="meaning-distribution" id="meaning-distribution" aria-label="Meaning cluster frequencies">
</div>
<div class="meaning-status-line">
<p id="replay-status" class="replay-status" role="status">Replaying five real model samples…</p>
<button type="button" id="meaning-cancel" hidden>Cancel run</button>
</div>
<div id="cluster-stage" class="cluster-stage">
</div>
<p class="inference-caption">Model-generated answers. Grouping is inferred by DeBERTa, not verified truth. <button type="button" id="open-entailment">Inspect the links</button>
</p>
</section>
</div>
    <div class="detector-inspection">
<details id="token-inspector">
<summary>Token confidence <span>Inspect a sampled answer</span>
</summary>
<div id="token-content">
</div>
</details>
<details id="entailment-inspector">
<summary>Bidirectional entailment <span>Why these answers joined</span>
</summary>
<div class="entailment-controls">
<label for="entailment-threshold">Minimum entailment probability <output id="threshold-value">0.60</output>
</label>
<input id="entailment-threshold" type="range" min="0.5" max="0.95" step="0.05" value="0.6"/>
<p>Both directions must pass, for every pair within a group. This slider recomputes the grouping locally. Published scores use 0.60.</p>
</div>
<div id="entailment-matrix">
</div>
<p id="pair-explanation" class="pair-explanation" role="status">Select a pair to inspect both directions.</p>
</details>
</div>
    <div id="detector-truth">
</div>
    <section class="live-models" aria-labelledby="live-heading">
<div>
<h3 id="live-heading">Run it on this device</h3>
<p>${e(GENERATOR.name)} + DeBERTa xsmall · <strong>${(bytes / 1e6).toFixed(1)} MB</strong> of model files + ${webKit ? "approximately 42 MB" : "approximately 27.5 MB"} runtime on first load. Apache-2.0 weights. Downloads start only when you choose.</p>
<p id="gpu-support" class="checked">Checking WebGPU support. The recorded run stays usable.</p>
</div>
<div class="live-actions">
<button type="button" id="models-load" disabled>Load models &amp; run</button>
<button type="button" id="models-cancel" hidden>Cancel</button>
<button type="button" id="models-clear">Remove cached models</button>
</div>
<p id="cache-status" class="checked">Completed files are cached on this origin when storage allows.</p>
<div class="download-line">
<progress id="model-progress" max="100" value="0" aria-label="Model download progress" hidden>
</progress>
<p id="model-status" role="status">Recorded ${e(new Date(recording.recordedAt).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" }))} in a headless Chromium browser using this engine. Replay timing is compressed; answer text and probabilities are unchanged.</p>
</div>
</section>
    <section id="detector-evaluation" class="detector-evaluation">
<div>
<p class="section-label">Recorded evaluation · not a live score</p>
<h3>How often did it get this set right?</h3>
<p>All 70 verified claims, five sampled answers each. No source passage or reference answer goes into generation.</p>
</div>
<div class="evaluation-numbers">
<div>
<strong>${recording.evaluation ? `${Math.round(recording.evaluation.accuracy * 100)}%` : "—"}</strong>
<span>claim verdict accuracy${recording.evaluation ? ` · ${recording.evaluation.correct}/${recording.evaluation.count}` : " · not evaluated"}</span>
</div>
<div>
<strong>${fixed(recording.evaluation?.semanticAuroc)}</strong>
<span>semantic-entropy AUROC<br>for generated-answer errors</span>
</div>
<div>
<strong>${fixed(recording.evaluation?.claimAuroc)}</strong>
<span>claim-support AUROC<br>NLI answer consensus</span>
</div>
</div>
<p class="evaluation-comparison">The first sampled answer got the requested fact right on <strong>${recording.evaluation?.answerCorrect ?? "—"}/70</strong> questions. Token confidence alone scored <strong>${fixed(recording.evaluation?.tokenAuroc)} AUROC</strong>${recording.evaluation?.tokenAuroc !== undefined && recording.evaluation.semanticAuroc !== null && recording.evaluation.tokenAuroc > (recording.evaluation.semanticAuroc ?? 0) ? "; semantic entropy did not beat that simpler baseline." : "."}</p>
<p class="checked">AUROC: 0.50 is chance, 1.00 is perfect ranking. Small, related questions; this is an illustrative evaluation, not a general benchmark. ${recording.evaluation?.semanticAuroc === null ? "Generated-answer review is pending; no answer-error AUROC is claimed." : "AI-assisted editorial labels check the requested fact against stored sources, not every extra assertion. One ambiguous reply is scored as incorrect. No independent human review has been performed."}</p>
<details>
<summary>Inspect all 70 recorded verdicts</summary>
<div class="evaluation-table-wrap" tabindex="0" role="region" aria-label="Recorded verdicts table, scroll horizontally for all columns">
<table>
<caption>Recorded detector compared with source truth</caption>
<thead>
<tr>
<th>Claim</th>
<th>Entropy</th>
<th>Detector</th>
<th>Source</th>
</tr>
</thead>
<tbody>${recording.records
    .map(
      (r) => `<tr>
<td>${e(r.input.claim)}</td>
<td>${r.entropyBits.toFixed(2)} bits</td>
<td>${r.predictedReal ? "Real" : "Hallucinated"}</td>
<td>${claims.get(r.input.id)?.real ? "Real" : "Fabricated"}</td>
</tr>`,
    )
    .join("")}</tbody>
</table>
</div>
</details>
</section>
    <section id="detector-method" class="detector-method">
<h3>The model can agree with itself and still be wrong.</h3>
<div>
<p>Semantic entropy measures disagreement in meaning. Five independent samples come from ${e(GENERATOR.name)} at temperature 0.9. A second model, DeBERTa, tests whether each answer entails another and vice versa. An answer joins a group only when it matches every member in both directions.</p>
<p>For each group, p is its share of the five samples. We compute H = −Σ p log₂ p. Zero bits means one inferred meaning; log₂(5) ≈ 2.32 bits means five. This is the <strong>discrete semantic entropy</strong> variant of <a href="https://www.nature.com/articles/s41586-024-07421-0" target="_blank" rel="noopener noreferrer">Farquhar et al., Nature (2024)</a>, adapted to small browser models and conservative complete-link grouping.</p>
<p>Token colours use the generator’s own untempered softmax probability of each sampled token. A high value means the token was predictable, not that it is true. The forced binary claim guess uses DeBERTa’s mean entailment-versus-contradiction margin. Semantic entropy separately flags meaning uncertainty; uncertainty is not the same as a false claim. Neither model can overrule a checked primary source.</p>
<p>Live inference runs in browser workers on your device: WebGPU generation and single-threaded WebAssembly entailment. No hosted model API, keys, analytics, microphone or audio. A clearly labelled real recording remains available on unsupported browsers and phones.</p>
</div>
</section>`);
}

export function tokenInspectorMarkup(
  sample: AnswerSample,
  selectedSample: number,
  live: boolean,
): string {
  return compact(`<p>
<strong>Model-generated answer ${selectedSample + 1}</strong> · ${sample.tokens.length} tokens · ${(sample.milliseconds / 1000).toFixed(1)} seconds in the ${live ? "live" : "recorded"} run</p>
<div class="token-ribbon">${sample.tokens.map((t) => `<span class="token confidence-${Math.min(4, Math.floor(t.probability * 5))}" tabindex="0" aria-label="${e(t.text)}: ${(t.probability * 100).toFixed(1)} percent" title="P(token | previous tokens) = ${(t.probability * 100).toFixed(1)}%">${e(t.text)}</span>`).join("")}</div>
<output id="token-probability" class="token-probability" aria-live="off">Focus or hover a token to inspect its probability.</output>
<div class="token-legend">
<span>Less predictable</span>
<span class="confidence-scale" aria-hidden="true">
</span>
<span>More predictable</span>
</div>
<p class="checked">Original model probabilities, before repetition penalty, temperature, top-k and nucleus sampling. The summary uses their geometric mean. Predictability is not truth.${sample.truncated ? ` This answer reached the ${MAX_TOKENS}-token limit and may be incomplete.` : ""}</p>`);
}
