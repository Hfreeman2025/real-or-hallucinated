import { escapeHtml as e } from "../dom.ts";
import { splitProof } from "../proof.ts";
import type { Bank, Claim } from "../schema.ts";
import { sourcePassage, sourceRecord } from "../views.ts";
import { DetectorClient } from "./client.ts";
import { updateDownloads } from "./download-progress.ts";
import { claimSupport, entails, meaningClusters, semanticEntropy } from "./math.ts";
import { MODEL_CACHE } from "./model-cache.ts";
import { GENERATOR, MAX_TOKENS, NLI } from "./models.ts";
import type { AnswerSample, DetectorResult, EngineEvent, Question } from "./types.ts";
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
interface Recording {
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
function parseRecording(value: unknown): Recording {
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
function parseQuestions(value: unknown): Question[] {
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
function fixed(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(2);
}
const letters = "ABCDE";
export async function mountDetector(root: HTMLElement, bank: Bank): Promise<void> {
  const webKit =
    /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent);
  const client = new DetectorClient(
    webKit
      ? () => new Worker(new URL("./webkit-worker.ts", import.meta.url), { type: "module" })
      : undefined,
  );
  let ready = false;
  let loading = false;
  let stopping: number | null = null;
  let stopDeadline: ReturnType<typeof setTimeout> | null = null;
  let operation = 0;
  let generation = 0;
  let userGuess: boolean | null = null;
  let selectedSample = 0;
  let threshold = 0.6;
  let live = false;
  let gpuReady = false;
  let liveDraft: AnswerSample[] = [];
  let bytes = 0;
  let active: DetectorResult;
  let recording: Recording;
  let questions: Question[];
  let claims: Map<string, Claim>;
  const files = new Map<string, { loaded: number; total: number }>();
  const query = <T extends HTMLElement>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`Detector control missing: ${selector}`);
    return found;
  };
  try {
    const [{ default: rawRecording }, { default: rawQuestions }, { default: models }] =
      await Promise.all([
        import("../../data/detector-recording.json"),
        import("../../data/questions.json"),
        import("../../data/models.json"),
      ]);
    recording = parseRecording(rawRecording);
    questions = parseQuestions(rawQuestions);
    claims = new Map(bank.puzzles.flatMap((p) => p.claims).map((c) => [c.id, c]));
    if (
      recording.records.some(
        (r) =>
          r.input.claim !== claims.get(r.input.id)?.text ||
          r.input.question !== questions.find((q) => q.claimId === r.input.id)?.question,
      )
    )
      throw new Error("Recorded run does not match this verified question bank");
    active =
      recording.records.find((r) => r.input.id === recording.defaultId) ??
      (recording.records[0] as DetectorResult);
    bytes = models.models
      .filter((m) => (m.id === GENERATOR.id && m.dtype === GENERATOR.dtype) || m.id === NLI.id)
      .reduce((sum, m) => sum + m.bytes, 0);
    root.innerHTML = `<div class="detector-heading"><div><h2>Lie detector</h2><p>Ask a small model five times. Check whether its answers agree in meaning.</p></div><div class="detector-mode-links"><a href="#live-heading">Run live</a><a href="#detector-method">How this works</a></div></div>
    <div class="detector-controls"><label for="detector-question">Source-checked question<select id="detector-question">${recording.records.map((r) => `<option value="${e(r.input.id)}" ${r.input.id === active.input.id ? "selected" : ""}>${e(r.input.question)}</option>`).join("")}</select></label><button type="button" id="detector-replay">Replay clustering</button></div>
    <div class="detector-desk"><section class="detector-copy" aria-labelledby="detector-claim"><div class="case-heading"><span>Your judgement</span><span id="detector-topic"></span></div><p class="claim-status" id="detector-claim-status">Unverified claim · may be fabricated</p><h3 id="detector-claim" class="detector-claim"></h3><div id="detector-guess" class="answer-buttons"><button type="button" data-guess="fake">Hallucinated</button><button type="button" data-guess="real">Real</button></div><p class="detector-hint">Make your call, then let the verified source settle it.</p><div id="detector-comparison" tabindex="-1" aria-label="Your decision, the detector and the verified source"></div><div class="detector-citation" id="detector-citation"></div></section>
    <section class="meaning-desk" aria-labelledby="meaning-heading"><div class="case-heading"><h3 id="meaning-heading">Semantic entropy</h3><span id="detector-origin">Recorded model run</span></div><p id="meaning-question" class="meaning-question"></p><div class="entropy-readout"><div><strong id="entropy-number">—</strong><span>bits of meaning uncertainty</span></div><div class="meaning-count"><strong id="meaning-count">5 → ?</strong><span>answers → inferred meanings</span></div></div><div class="meaning-distribution" id="meaning-distribution" aria-label="Meaning cluster frequencies"></div><div class="meaning-status-line"><p id="replay-status" class="replay-status" role="status">Replaying five real model samples…</p><button type="button" id="meaning-cancel" hidden>Cancel run</button></div><div id="cluster-stage" class="cluster-stage"></div><p class="inference-caption">Model-generated answers. Grouping is inferred by DeBERTa, not verified truth. <button type="button" id="open-entailment">Inspect the links</button></p></section></div>
    <div class="detector-inspection"><details id="token-inspector"><summary>Token confidence <span>Inspect a sampled answer</span></summary><div id="token-content"></div></details><details id="entailment-inspector"><summary>Bidirectional entailment <span>Why these answers joined</span></summary><div class="entailment-controls"><label for="entailment-threshold">Minimum entailment probability <output id="threshold-value">0.60</output></label><input id="entailment-threshold" type="range" min="0.5" max="0.95" step="0.05" value="0.6"/><p>Both directions must pass, for every pair within a group. This slider recomputes the grouping locally. Published scores use 0.60.</p></div><div id="entailment-matrix"></div><p id="pair-explanation" class="pair-explanation" role="status">Select a pair to inspect both directions.</p></details></div>
    <div id="detector-truth"></div>
    <section class="live-models" aria-labelledby="live-heading"><div><h3 id="live-heading">Run it on this device</h3><p>${e(GENERATOR.name)} + DeBERTa xsmall · <strong>${(bytes / 1e6).toFixed(1)} MB</strong> of model files + ${webKit ? "approximately 42 MB" : "approximately 27.5 MB"} runtime on first load. Apache-2.0 weights. Downloads start only when you choose.</p><p id="gpu-support" class="checked">Checking WebGPU support. The recorded run stays usable.</p></div><div class="live-actions"><button type="button" id="models-load" disabled>Load models &amp; run</button><button type="button" id="models-cancel" hidden>Cancel</button><button type="button" id="models-clear">Remove cached models</button></div><p id="cache-status" class="checked">Completed files are cached on this origin when storage allows.</p><div class="download-line"><progress id="model-progress" max="100" value="0" aria-label="Model download progress" hidden></progress><p id="model-status" role="status">Recorded ${e(new Date(recording.recordedAt).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" }))} in a headless Chromium browser using this engine. Replay timing is compressed; answer text and probabilities are unchanged.</p></div></section>
    <section id="detector-evaluation" class="detector-evaluation"><div><p class="section-label">Recorded evaluation · not a live score</p><h3>How often did it get this set right?</h3><p>All 70 verified claims, five sampled answers each. No source passage or reference answer goes into generation.</p></div><div class="evaluation-numbers"><div><strong>${recording.evaluation ? `${Math.round(recording.evaluation.accuracy * 100)}%` : "—"}</strong><span>claim verdict accuracy${recording.evaluation ? ` · ${recording.evaluation.correct}/${recording.evaluation.count}` : " · not evaluated"}</span></div><div><strong>${fixed(recording.evaluation?.semanticAuroc)}</strong><span>semantic-entropy AUROC<br>for generated-answer errors</span></div><div><strong>${fixed(recording.evaluation?.claimAuroc)}</strong><span>claim-support AUROC<br>NLI answer consensus</span></div></div><p class="evaluation-comparison">The first sampled answer got the requested fact right on <strong>${recording.evaluation?.answerCorrect ?? "—"}/70</strong> questions. Token confidence alone scored <strong>${fixed(recording.evaluation?.tokenAuroc)} AUROC</strong>${recording.evaluation?.tokenAuroc !== undefined && recording.evaluation.semanticAuroc !== null && recording.evaluation.tokenAuroc > (recording.evaluation.semanticAuroc ?? 0) ? "; semantic entropy did not beat that simpler baseline." : "."}</p><p class="checked">AUROC: 0.50 is chance, 1.00 is perfect ranking. Small, related questions; this is an illustrative evaluation, not a general benchmark. ${recording.evaluation?.semanticAuroc === null ? "Generated-answer review is pending; no answer-error AUROC is claimed." : "AI-assisted editorial labels check the requested fact against stored sources, not every extra assertion. One ambiguous reply is scored as incorrect. No independent human review has been performed."}</p><details><summary>Inspect all 70 recorded verdicts</summary><div class="evaluation-table-wrap" tabindex="0" role="region" aria-label="Recorded verdicts table, scroll horizontally for all columns"><table><caption>Recorded detector compared with source truth</caption><thead><tr><th>Claim</th><th>Entropy</th><th>Detector</th><th>Source</th></tr></thead><tbody>${recording.records.map((r) => `<tr><td>${e(r.input.claim)}</td><td>${r.entropyBits.toFixed(2)} bits</td><td>${r.predictedReal ? "Real" : "Hallucinated"}</td><td>${claims.get(r.input.id)?.real ? "Real" : "Fabricated"}</td></tr>`).join("")}</tbody></table></div></details></section>
    <section id="detector-method" class="detector-method"><h3>The model can agree with itself and still be wrong.</h3><div><p>Semantic entropy measures disagreement in meaning. Five independent samples come from ${e(GENERATOR.name)} at temperature 0.9. A second model, DeBERTa, tests whether each answer entails another and vice versa. An answer joins a group only when it matches every member in both directions.</p><p>For each group, p is its share of the five samples. We compute H = −Σ p log₂ p. Zero bits means one inferred meaning; log₂(5) ≈ 2.32 bits means five. This is the <strong>discrete semantic entropy</strong> variant of <a href="https://www.nature.com/articles/s41586-024-07421-0" target="_blank" rel="noopener noreferrer">Farquhar et al., Nature (2024)</a>, adapted to small browser models and conservative complete-link grouping.</p><p>Token colours use the generator’s own untempered softmax probability of each sampled token. A high value means the token was predictable, not that it is true. The forced binary claim guess uses DeBERTa’s mean entailment-versus-contradiction margin. Semantic entropy separately flags meaning uncertainty; uncertainty is not the same as a false claim. Neither model can overrule a checked primary source.</p><p>Live inference runs in browser workers on your device: WebGPU generation and single-threaded WebAssembly entailment. No hosted model API, keys, analytics, microphone or audio. A clearly labelled real recording remains available on unsupported browsers and phones.</p></div></section>`;
  } catch (error) {
    root.innerHTML = `<div class="detector-unavailable"><h2>Lie detector</h2><p>${e(error instanceof Error ? error.message : "The recorded run could not be validated.")}</p><p>No model output has been substituted. Open the daily game to inspect the checked claims.</p></div>`;
    return;
  }
  const currentClaim = () => {
    const claim = claims.get(active.input.id);
    if (!claim) throw new Error("Claim unavailable");
    return claim;
  };
  const groups = () => meaningClusters(5, active.pairs, threshold);
  const entropy = () => semanticEntropy(groups());
  const support = () => claimSupport(active.claimRelations);
  function sampleCard(index: number): HTMLElement {
    const sample = loading && liveDraft[index] ? liveDraft[index] : active.samples[index];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "sample-card";
    card.dataset.sample = String(index);
    card.setAttribute("aria-label", `Inspect confidence for model-generated answer ${index + 1}`);
    card.innerHTML = `<span class="sample-label">Model-generated · ${index + 1}</span><span class="sample-text">${e(sample?.text ?? "")}</span><span class="sample-confidence"><span class="record-value">${Math.round(Math.exp(sample?.meanLogProbability ?? -Infinity) * 100)}%</span> token predictability${sample?.truncated ? " · token limit reached" : ""}</span>`;
    card.addEventListener("click", () => {
      selectedSample = index;
      inspectTokens();
      const inspector = query<HTMLDetailsElement>("#token-inspector");
      inspector.open = true;
      inspector.querySelector("summary")?.focus({ preventScroll: true });
      inspector.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
    return card;
  }
  function inspectTokens() {
    const sample =
      loading && liveDraft[selectedSample]
        ? liveDraft[selectedSample]
        : active.samples[selectedSample];
    if (!sample) return;
    query("#token-content").innerHTML =
      `<p><strong>Model-generated answer ${selectedSample + 1}</strong> · ${sample.tokens.length} tokens · ${(sample.milliseconds / 1000).toFixed(1)} seconds in the ${live ? "live" : "recorded"} run</p><div class="token-ribbon">${sample.tokens.map((t) => `<span class="token confidence-${Math.min(4, Math.floor(t.probability * 5))}" tabindex="0" aria-label="${e(t.text)}: ${(t.probability * 100).toFixed(1)} percent" title="P(token | previous tokens) = ${(t.probability * 100).toFixed(1)}%">${e(t.text)}</span>`).join("")}</div><output id="token-probability" class="token-probability" aria-live="off">Focus or hover a token to inspect its probability.</output><div class="token-legend"><span>Less predictable</span><span class="confidence-scale" aria-hidden="true"></span><span>More predictable</span></div><p class="checked">Original model probabilities, before repetition penalty, temperature, top-k and nucleus sampling. The summary uses their geometric mean. Predictability is not truth.${sample.truncated ? ` This answer reached the ${MAX_TOKENS}-token limit and may be incomplete.` : ""}</p>`;
    root.querySelectorAll<HTMLElement>(".token").forEach((token, index) => {
      const show = () => {
        const value = sample.tokens[index];
        if (value)
          query("#token-probability").textContent =
            `“${value.text}” · ${(value.probability * 100).toFixed(1)}% probability given the preceding tokens`;
      };
      token.addEventListener("focus", show);
      token.addEventListener("pointerenter", show);
    });
  }
  function matrix() {
    const cells: string[] = [];
    for (let a = 0; a < 5; a++)
      for (let b = 0; b < 5; b++) {
        const pair = active.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
        const strength = pair ? Math.min(pair.forward.entailment, pair.backward.entailment) : 1;
        cells.push(
          a === b
            ? `<span class="matrix-self" aria-label="Answer ${a + 1} with itself">${a + 1}</span>`
            : `<button type="button" data-pair="${a}:${b}" class="matrix-cell ${pair && entails(pair.forward, threshold) && entails(pair.backward, threshold) ? "linked" : "unlinked"}" aria-label="Answers ${a + 1} and ${b + 1}: minimum entailment ${Math.round(strength * 100)} percent">${Math.round(strength * 100)}<span>%</span></button>`,
        );
      }
    query("#entailment-matrix").innerHTML =
      `<p class="section-label">Rows and columns: answers 1–5 · minimum of both directions</p><div class="entailment-grid">${cells.join("")}</div>`;
    root.querySelectorAll<HTMLButtonElement>("[data-pair]").forEach((button) => {
      button.addEventListener("click", () => {
        const [a, b] = (button.dataset.pair ?? "").split(":").map(Number);
        const pair = active.pairs.find(
          (p) => p.a === Math.min(a ?? 0, b ?? 0) && p.b === Math.max(a ?? 0, b ?? 0),
        );
        if (!pair) return;
        const first = a === pair.a ? pair.forward : pair.backward;
        const second = a === pair.a ? pair.backward : pair.forward;
        query("#pair-explanation").textContent =
          `Answer ${(a ?? 0) + 1} → ${(b ?? 0) + 1}: ${(first.entailment * 100).toFixed(1)}% entailment. Reverse: ${(second.entailment * 100).toFixed(1)}%. ${Math.min(first.entailment, second.entailment) >= threshold ? "Both pass the current threshold; other group members must also agree." : "At least one direction fails the current threshold."} These are model inferences.`;
      });
    });
  }
  function updateMetrics() {
    const clusters = groups();
    const h = entropy();
    query("#entropy-number").textContent = h.toFixed(2);
    query("#meaning-count").textContent = `5 → ${clusters.length}`;
    const distribution = query("#meaning-distribution");
    distribution.replaceChildren();
    clusters.forEach((c, i) => {
      const segment = document.createElement("span");
      segment.className = `meaning-segment group-${i}`;
      segment.style.flexGrow = String(c.length);
      segment.textContent = `${letters[i]} · ${c.length}/5`;
      distribution.append(segment);
    });
    distribution.setAttribute(
      "aria-label",
      clusters.map((c, i) => `Meaning ${letters[i]}: ${c.length} of 5 answers`).join("; "),
    );
    query("#detector-origin").textContent = live ? "Live · this device" : "Recorded model run";
  }
  function arrange(animate = true) {
    const stage = query("#cluster-stage");
    const oldCards = new Map(
      [...stage.querySelectorAll<HTMLElement>(".sample-card")].map((el) => [
        Number(el.dataset.sample),
        { el, rect: el.getBoundingClientRect() },
      ]),
    );
    stage.replaceChildren();
    stage.classList.add("is-grouped");
    stage.dataset.groupCount = String(groups().length);
    groups().forEach((members, i) => {
      const group = document.createElement("section");
      group.className = `meaning-group group-${i}`;
      group.innerHTML = `<h4>Meaning ${letters[i]}<span>${members.length} of 5</span></h4>`;
      members.forEach((index) => {
        group.append(oldCards.get(index)?.el ?? sampleCard(index));
      });
      stage.append(group);
    });
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      performance.mark("roh:cluster-start");
      stage.querySelectorAll<HTMLElement>(".sample-card").forEach((el) => {
        const old = oldCards.get(Number(el.dataset.sample));
        const rect = el.getBoundingClientRect();
        if (old)
          el.animate(
            [
              { transform: `translate(${old.rect.x - rect.x}px,${old.rect.y - rect.y}px)` },
              { transform: "translate(0,0)" },
            ],
            { duration: 600, easing: "cubic-bezier(.2,.7,.2,1)" },
          );
      });
    }
    updateMetrics();
    matrix();
    inspectTokens();
    comparison();
  }
  async function replay() {
    const id = ++generation;
    const stage = query("#cluster-stage");
    stage.classList.remove("is-grouped");
    stage.replaceChildren();
    const pool = document.createElement("div");
    pool.className = "answer-pool";
    stage.append(pool);
    query("#replay-status").textContent = "Replay · original answers, compressed timing";
    query("#entropy-number").textContent = "—";
    query("#meaning-count").textContent = "5 → ?";
    query("#meaning-distribution").replaceChildren();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (let i = 0; i < 5; i++) {
      if (id !== generation) return;
      const card = sampleCard(i);
      card.classList.add("sample-arriving");
      pool.append(card);
      if (!reduced) await new Promise((resolve) => setTimeout(resolve, 180));
    }
    if (!reduced) await new Promise((resolve) => setTimeout(resolve, 350));
    if (id !== generation) return;
    arrange(!reduced);
    query("#replay-status").textContent =
      `${groups().length} inferred ${groups().length === 1 ? "meaning" : "meanings"} from five model-generated answers · ${live ? "live computation" : "recorded computation"}`;
  }
  function comparison() {
    const host = query("#detector-comparison");
    const truth = query("#detector-truth");
    query("#citation-state").textContent =
      userGuess === null ? "Passage sealed until your decision." : "Verified passage opened below.";
    if (userGuess === null) {
      host.replaceChildren();
      truth.replaceChildren();
      return;
    }
    const claim = currentClaim();
    const prediction = support() >= 0.5;
    host.innerHTML = `<div class="judgement-grid"><div><span>You</span><strong>${userGuess ? "Real" : "Hallucinated"}</strong><small>${userGuess === claim.real ? "Correct" : "Incorrect"}</small></div><div><span>Detector</span><strong>${prediction ? "Real" : "Hallucinated"}</strong><small>${prediction === claim.real ? "Correct" : "Incorrect"} · inferred</small></div><div><span>Source</span><strong>${claim.real ? "Real" : "Fabricated"}</strong><small>Verified passage</small></div></div><p class="detector-hint">NLI support index ${support().toFixed(2)}; 0.50 is neutral. ${entropy() / Math.log2(5) >= 0.5 ? "High meaning uncertainty: possible confabulation." : "Lower meaning uncertainty is not proof of truth."} <a href="#detector-truth">Read the verified source</a></p>`;
    query("#detector-claim-status").textContent = claim.real ? "Checked fact" : "Fabricated claim";
    const parts = splitProof(claim);
    query("#detector-claim").innerHTML = parts
      ? `${e(parts.before)}<del>${e(parts.phrase)}</del>${e(parts.after)}`
      : e(claim.text);
    query("#detector-guess").hidden = true;
    truth.innerHTML = `<section class="detector-source"><div><p class="section-label">The verified source settles it</p><h3>${claim.real ? "A supported claim." : "A fabrication, corrected."}</h3>${claim.evidence.proof ? `<div class="editor-note"><span class="note-label">${e(claim.evidence.proof.kind)} corrected</span><strong>${e(claim.evidence.proof.replacement)}</strong><p>${e(claim.evidence.proof.reason)}</p></div>` : `<p>${e(claim.evidence.explanation)}</p>`}</div><div>${sourceRecord(claim)}${sourcePassage(claim)}</div></section>`;
  }
  function select(result: DetectorResult, isLive = false, alreadySampled = false) {
    liveDraft = [];
    generation++;
    active = result;
    live = isLive;
    userGuess = null;
    selectedSample = 0;
    threshold = 0.6;
    query<HTMLInputElement>("#entailment-threshold").value = "0.6";
    query("#threshold-value").textContent = "0.60";
    query("#detector-topic").textContent = currentClaim().topic;
    query("#meaning-question").textContent = active.input.question;
    query("#detector-claim-status").textContent = "Unverified claim · may be fabricated";
    query("#detector-claim").textContent = currentClaim().text;
    query("#detector-guess").hidden = false;
    query("#detector-citation").innerHTML =
      `<details class="citation-details" ${matchMedia("(max-width:760px)").matches ? "" : "open"}><summary>Source citation · ${e(currentClaim().source.publisher)}</summary>${sourceRecord(currentClaim())}<p class="checked" id="citation-state">Passage sealed until your decision.</p></details>`;
    comparison();
    if (alreadySampled) {
      arrange();
      query("#replay-status").textContent =
        "Live computation complete · five answers grouped by bidirectional entailment";
    } else void replay();
  }
  function state(text: string) {
    query("#model-status").textContent = text;
  }
  function event(event: EngineEvent) {
    if (event.type === "phase") {
      state(event.phase);
      if (event.phase.startsWith("Cache storage unavailable"))
        query("#cache-status").textContent = event.phase;
      if (live && loading) query("#replay-status").textContent = `Live · ${event.phase}`;
    }
    if (event.type === "progress") {
      const p = event.progress;
      const { loaded, total } = updateDownloads(files, p);
      const progress = query<HTMLProgressElement>("#model-progress");
      progress.hidden = false;
      progress.max = Math.max(bytes, total);
      progress.value = loaded;
      state(
        `${(loaded / 1e6).toFixed(1)} / ${(Math.max(bytes, total) / 1e6).toFixed(1)} MB · ${p.file} · ${p.stage}`,
      );
    }
    if (event.type === "sample") {
      liveDraft[event.index] = event.sample;
      query("#meaning-count").textContent = `${event.index + 1} → ?`;
      query("#cluster-stage .answer-pool").append(sampleCard(event.index));
      query("#replay-status").textContent =
        `Live generation · ${event.index + 1} of 5 answers sampled on this device`;
      if (event.index === selectedSample) inspectTokens();
    }
  }
  function controls() {
    query<HTMLButtonElement>("#models-load").disabled = loading || stopping !== null || !gpuReady;
    query("#models-cancel").hidden = !loading;
    query("#meaning-cancel").hidden = !loading;
    root.querySelectorAll<HTMLButtonElement>("[data-guess]").forEach((button) => {
      button.disabled = loading;
    });
    query<HTMLSelectElement>("#detector-question").disabled = loading;
    query<HTMLButtonElement>("#detector-replay").disabled = loading;
    query<HTMLInputElement>("#entailment-threshold").disabled = loading;
    query<HTMLButtonElement>("#models-clear").disabled = loading || stopping !== null;
    query("#models-load").textContent = ready ? "Sample again on this device" : "Load models & run";
  }
  async function runLive() {
    const id = ++operation;
    loading = true;
    files.clear();
    controls();
    const emit = (update: EngineEvent) => {
      if (id === operation) event(update);
    };
    try {
      if (!ready) {
        await client.load(emit);
        if (id !== operation) return;
        ready = true;
      }
      const chosen = active.input;
      generation++;
      liveDraft = [];
      live = true;
      userGuess = null;
      query("#detector-claim").textContent = currentClaim().text;
      query("#detector-claim-status").textContent = "Unverified claim · may be fabricated";
      query("#detector-guess").hidden = false;
      comparison();
      query("#token-content").textContent =
        "Live token probabilities will appear as answers arrive.";
      query("#entailment-matrix").replaceChildren();
      query("#pair-explanation").textContent =
        "Live entailment is pending; no previous scores are shown.";
      query("#replay-status").textContent = "Live · sampling the first answer";
      query("#detector-origin").textContent = "Live · sampling on this device";
      query("#entropy-number").textContent = "—";
      query("#meaning-count").textContent = "0 → ?";
      query("#meaning-distribution").replaceChildren();
      const stage = query("#cluster-stage");
      stage.classList.remove("is-grouped");
      stage.innerHTML = '<div class="answer-pool"></div>';
      query(".meaning-desk").scrollIntoView({ block: "start", behavior: "instant" });
      const result = await client.run({ ...chosen, seed: Date.now() >>> 0 }, emit);
      if (id !== operation) return;
      select(result, true, true);
      state(
        `Live run complete in ${(result.milliseconds / 1000).toFixed(1)} seconds. Models remain in this worker; no question was sent to a server.`,
      );
    } catch (error) {
      if (id === operation) {
        ready = false;
        client.cancel();
        const recorded = recording.records.find((r) => r.input.id === active.input.id);
        if (recorded) select(recorded);
        state(
          `Local run unavailable: ${error instanceof Error ? error.message : "unknown error"}. The recorded run remains usable.`,
        );
      }
    } finally {
      if (stopping === id) finishStopping(id);
      if (id === operation) {
        loading = false;
        query("#model-progress").hidden = true;
        controls();
      }
    }
  }
  query<HTMLSelectElement>("#detector-question").addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const r = recording.records.find((r) => r.input.id === target.value);
    if (r) select(r);
  });
  query("#detector-replay").addEventListener("click", () => void replay());
  root.querySelectorAll<HTMLButtonElement>("[data-guess]").forEach((button) => {
    button.addEventListener("click", () => {
      userGuess = button.dataset.guess === "real";
      comparison();
      query("#detector-comparison").focus({ preventScroll: true });
    });
  });
  query<HTMLInputElement>("#entailment-threshold").addEventListener("input", () => {
    threshold = Number(query<HTMLInputElement>("#entailment-threshold").value);
    query("#threshold-value").textContent = threshold.toFixed(2);
    generation++;
    arrange();
    query("#replay-status").textContent =
      "Exploratory grouping · published evaluation remains at 0.60";
  });
  query("#open-entailment").addEventListener("click", () => {
    const el = query<HTMLDetailsElement>("#entailment-inspector");
    el.open = true;
    el.querySelector("summary")?.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", behavior: "instant" });
  });
  query("#meaning-cancel").addEventListener("click", () =>
    query<HTMLButtonElement>("#models-cancel").click(),
  );
  query("#models-load").addEventListener("click", () => void runLive());
  function finishStopping(id: number, forced = false) {
    if (stopping !== id) return;
    if (stopDeadline) clearTimeout(stopDeadline);
    stopDeadline = null;
    if (forced || !ready) {
      client.cancel();
      ready = false;
    }
    stopping = null;
    controls();
    state(
      ready
        ? "Cancelled. Models remain loaded; the recorded run is ready."
        : "Cancelled. Completed files may remain cached; the recorded run is ready.",
    );
  }
  query("#models-cancel").addEventListener("click", () => {
    const id = operation++;
    loading = false;
    const recorded = recording.records.find((r) => r.input.id === active.input.id);
    if (recorded) select(recorded);
    query("#model-progress").hidden = true;
    if (client.worker && ready) {
      // Abort at a sample/NLI boundary and retain the loaded session.
      // A cancelled view must not race a second heavyweight allocation.
      stopping = id;
      client.worker.postMessage({ type: "cancel" });
      stopDeadline = setTimeout(() => finishStopping(id, true), 10000);
      state("Stopping the current local calculation. The recorded run is ready.");
    } else {
      // Before a session is ready, terminate the downloader immediately. Aborting an
      // SDK metadata probe cooperatively logs a warning after the user has cancelled.
      client.cancel();
      ready = false;
      state("Cancelled. Completed files may remain cached; the recorded run is ready.");
    }
    controls();
  });
  query("#models-clear").addEventListener("click", async () => {
    if (loading || stopping !== null) return;
    client.cancel();
    ready = false;
    try {
      if ("caches" in globalThis) await caches.delete(MODEL_CACHE);
      state("This origin’s model cache removed. Shared disk weights are untouched.");
    } catch {
      state("Cache storage is unavailable. No shared disk files were changed.");
    }
    controls();
  });
  const verdictTable = query(".evaluation-table-wrap");
  verdictTable.addEventListener("keydown", (event) => {
    if (
      event.target !== verdictTable ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    )
      return;
    // WebKit does not consistently scroll a focused overflow region with arrow keys.
    event.preventDefault();
    verdictTable.scrollBy({ left: event.key === "ArrowRight" ? 120 : -120, behavior: "instant" });
  });
  select(active);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => performance.mark("roh:detector-painted")),
  );
  const firefox = /Firefox\//.test(navigator.userAgent);
  const gpu = firefox ? undefined : Reflect.get(navigator, "gpu");
  if (matchMedia("(max-width:760px)").matches)
    query("#gpu-support").textContent =
      "Phone mode: the interactive recorded run is ready. Live generation requires a desktop WebGPU adapter.";
  else if (firefox)
    query("#gpu-support").textContent =
      "Firefox: live WebGPU inference is unavailable in this build. The recorded run and every inspection control remain ready.";
  else if (gpu && typeof gpu.requestAdapter === "function") {
    try {
      const adapter = await gpu.requestAdapter();
      gpuReady = !!adapter;
      query("#gpu-support").textContent = gpuReady
        ? "WebGPU available. Generation runs on your GPU; entailment uses one WebAssembly thread."
        : "This browser has no WebGPU adapter. The recorded run and every inspection control remain available.";
    } catch {
      query("#gpu-support").textContent =
        "WebGPU could not initialise. The recorded run remains fully inspectable.";
    }
  } else
    query("#gpu-support").textContent =
      "WebGPU is unavailable here. The real recorded run is the designed fallback; every inspection control still works.";
  controls();
}
