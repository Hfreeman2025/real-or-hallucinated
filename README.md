# Real or Hallucinated?

Ask a small browser model the same factual question five times, watch its answers gather into inferred meanings, and inspect the probabilities behind every word and link. Make your own call on a claim; a checked primary source settles it. The original daily five-claim game remains a separate blind round, with exact fabrication marks and source passages highlighted in context. A static TypeScript experiment by Harry Freeman, with optional on-device inference and no accounts, keys, tracking or hosted model API.

## Run locally

Node.js 22.13+ and npm. No keys or environment variables are required.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5177**. The development port is unchanged. Both servers bind to loopback only. The watcher excludes generated browser caches/screenshots/docs and polls application files every 300ms, so local test artifacts cannot flood its module graph.

For the static production preview:

```sh
npm run build
npm run preview
```

Open **http://127.0.0.1:4184**. The preview uses the isolated QA port; the development port remains 5177. Nothing has been published.

![Five real model answers grouped into two inferred meanings, beside a source-checked claim](shots/v3/pass-2/desktop-viewport.png)

## Inspect the technique in ten seconds

Open the page. **Recorded model run** is visible immediately: five actual generated answers arrive, then move into meaning groups. Click an answer for its original token probabilities, or **Inspect the links** for both entailment directions. Change the threshold to recompute the grouping. No weights download until you choose **Load models & run**. Recorded timing is compressed; output text and probabilities are unchanged.

The selected shared model files total **889.1 MB**, plus the runtime shown on the page. To prepare local live inference, check at least 10 GiB is free, then run:

```sh
npm run models:fetch
```

Weights go only to `~/Personal/.models/`, with immutable revisions, sizes, SHA-256 digests and licences in its manifest and README. The dev/preview middleware streams only allowlisted files from that directory. There is no second repository copy. A desktop WebGPU adapter is required for live generation; phones and unsupported adapters retain the complete interactive recording. Progress, cancel, cache removal and failed-download states keep that recording usable. No inference request leaves the browser.

## Method and measured evaluation

**Discrete semantic entropy**, adapted from Farquhar, Kossen, Kuhn and Gal, [*Detecting hallucinations in large language models using semantic entropy*, Nature (2024)](https://www.nature.com/articles/s41586-024-07421-0). Five independent answers are sampled from Qwen2.5 0.5B Instruct. DeBERTa xsmall NLI tests each pair in both directions. Complete-link grouping requires every within-group pair to entail both ways at a fixed 0.60 threshold. Entropy is `−Σ p log₂ p`, using each group's empirical share of five answers. Our conservative grouping differs from the paper's representative-based implementation.

Token confidence is the original untempered model softmax probability, captured before repetition penalty, temperature, top-k and nucleus sampling. The displayed answer summary is a geometric mean. Entropy measures disagreement, not truth: a model can confidently repeat a falsehood. The additional forced binary claim verdict uses `(1 + mean(entailment − contradiction)) / 2 ≥ 0.50`, separately from entropy. That authored support index is not a calibrated truth probability. The checked source remains authoritative.

Transformers.js was chosen because it exposes causal-model logits and NLI in a browser worker. Generation uses WebGPU; NLI uses one WebAssembly thread. WebKit isolates NLI in a second CPU-only ONNX Runtime worker to make persisted cached reload reliable; Chromium uses one combined worker. The official browser-only SDK is vendored without native image dependencies; ONNX Runtime is pinned separately. See [the engine API and reproduction details](docs/ENGINE.md), [SDK provenance](vendor/transformers/PROVENANCE.json), and [model licences](docs/model-licenses.json).

The evaluation records all 70 verified questions in headless Chromium using the same browser engine, five answers per question, without source passages or reference answers in the generation prompt. Per-question checkpoints, model revisions, exact parameters, browser version, engine-source digests, answers, tokens and NLI distributions accompany `data/detector-recording.json`. All selected weight files are size- and SHA-256-verified before recording. Superseded runtime diagnostics are explicitly separated in `docs/experiments/`; they are not accepted evaluation results.

| Measured on all 70 questions | Result |
|---|---:|
| Binary claim verdict accuracy | 42/70 · 60% |
| Claim-support AUROC | 0.6482 |
| Semantic-entropy AUROC for first-answer errors | 0.6335 |
| Token-confidence error baseline AUROC | 0.6740 |
| First answer gives the requested fact | 20/70 · 28.6% |

**Semantic entropy did not beat token confidence on this set.** These are small models and a small, related question set, not a general benchmark. Error labels are AI-assisted editorial checks of the requested fact against the stored source quote, bound to exact answer and quote hashes. They do not audit every extra assertion; one ambiguous answer is conservatively marked incorrect. No independent human review has been performed. The page publishes the same results and every recorded verdict.

The daily proof reveal is still available in **Daily game**: on the 1 November edition, the fabricated phrase **“includes water vapour”** is redlined, a margin note corrects it, and NOAA's original passage highlights **“after water vapor has been removed.”** The exact proof marks are authored, source-checked annotations.

## Play and persistence

Buttons, left/right arrow keys, and deliberate horizontal swipes all answer. Vertical swipes scroll. Answers lock immediately; reload restores the current reveal. Native dialogs, visible focus, reduced motion, clipboard denial, storage failure, offline bundled play, missing/invalid content, slow loading, and JavaScript-disabled states are designed explicitly.

**14 editions / 70 claims** span science, nature, space, energy, climate, history, and technology. There are 35 real and 35 fabricated claims overall, with one to four real claims per edition. Each edition has five distinct source pages and at least three topics. The collection repeats every 14 days and says so in the archive.

Dates use **Europe/London**, including DST. The anchor is 19 October 2026. The archive lists fourteen recent dates and allows any available earlier date. Only completing today's edition adds to a local streak; archive play never backfills one. A round left open after midnight retains its answers and clearly stops calling its old date “Today”.

Progress is validated and saved in this browser, with guarded reads/writes. Clearing site data clears it. Local scores are editable; this is not a competitive leaderboard. Shared text is ASCII and contains only the date, score, and correctness pattern, never claims or their true/false verdicts.

V3 opens the **Lie detector**; **Daily game** retains the blind puzzle and its editor's proof reveal. The source passage is intentionally sealed before a decision, chemical formulas are typeset only for display, and desktop controls follow the claim directly. The earlier [v2.1 evidence report](docs/V2.1-EVIDENCE.md) remains a dated historical record.

## Evidence pipeline

All original claims, fabricated alterations, corrections, and explanations were AI-authored for this project. Every verdict is grounded in a fetched public primary source. Fabrications avoid living people, company conduct, health/medical advice, and elections; their cited pages directly contradict the altered detail. Missing search results are never treated as proof of falsity.

`data/puzzles.json` stores source URLs, titles, publishers, evidence quote excerpts, original check dates and response hashes, surrounding source sentences, context-check dates, and exact proof spans. Runtime validation rejects a fabrication mark unless it occurs exactly once in its claim, or context whose highlighted text does not match the stored evidence quote. Source context is extracted from the main document text where a `<main>` element exists, with adjacent sentences retained.

```sh
npm run verify
```

The verifier fetches all **18 unique source pages** with bounded concurrency, timeouts, HTML validation, response-size limits, and HTTPS host checks. All **70 supporting and contradicting quotes** must match. It writes `data/verification.json`; only a fully successful run constructs and atomically replaces the context-enriched puzzle file. Failed or invented context cannot partly refresh dates. Original claim-check dates and hashes are retained. There is **no cache fallback after a failed fetch**.

Source passages typeset an explicit allowlist of chemical formulas (CO₂, H₂O, CH₄, N₂O) for display only, including spaces introduced by flattened source markup. Stored quotes, context spans and verifier inputs remain unchanged; HTML escaping still follows formatting.

Matching normalises entities, case, whitespace, and typographic punctuation while retaining the words and numbers. Quote presence and context extraction do not prove interpretation: proof notes remain editorial judgements. The game displays dated bundled checks, not live data, and makes no external background requests. Original links navigate to their publishers only when opened.

## Checks and screenshots

The final local measurement uses three fresh contexts per engine, one browser at a time. First meaningful paint is the initial detector after two native animation frames; the five-answer gather begins at about 1.3 seconds. The heaviest case is chosen by total recorded answer length.

| Browser | Median meaningful paint | Median frame | P95 frame |
|---|---:|---:|---:|
| Chromium 153 | 59.9 ms | 16.7 ms | 16.8 ms |
| WebKit 26.6 | 57.0 ms | 17.0 ms | 18.0 ms |
| Firefox 155 | 47.0 ms | 8.3 ms | 9.1 ms |

Opener JavaScript/data modules total **168,533 bytes gzipped**. All optional JavaScript build chunks across both runtime profiles total 374,527 bytes gzipped; a browser loads its selected profile lazily. WASM is 26.86 MB raw / 6.68 MB gzipped for WebGPU, plus 14.26 MB raw / 3.68 MB gzipped for WebKit's CPU-only checker. The optional selected weights total 889.1 MB. These are asset gzip sizes, not a claim that Vite's loopback preview compresses HTTP traffic. Local timings and headless frame intervals are not network or physical-phone guarantees. See the [raw measurements](shots/v3/performance-report.json).

```sh
npm run check
npm run audit
npm run verify
```

`check` runs strict TypeScript, Biome, offline contract tests, hash-bound recording/metric validation, the static build, and the dependency-licence allowlist. Tests cover entropy, complete-link grouping, AUROC ties, seeded sampling against an independent oracle, tensor boundaries, download accounting, cache failure, schema rejection, exact proof spans, context offsets, immutable display typography, all-or-nothing source refreshes, London dates/DST, scoring, streaks, sharing and corrupt/blocked storage.

With the production preview running on 4184:

```sh
mkdir -p .cache/tmp
TMPDIR="$PWD/.cache/tmp" npm run test:browser
TMPDIR="$PWD/.cache/tmp" npm run test:detector
CRITIQUE_PASS=pass-1 TMPDIR="$PWD/.cache/tmp" npm run shots:v3
CRITIQUE_PASS=pass-2 TMPDIR="$PWD/.cache/tmp" npm run shots:v3
TMPDIR="$PWD/.cache/tmp" npm run test:perf:v3
```

The Mac harness uses Playwright through `createRequire` from the existing installation named in the brief, importing no project code or assets. On this shared Mac, the harness reuses matching installed Playwright binaries, avoiding duplicate copies. It falls back to this project's ignored `.cache/browsers/` only when necessary. A disk guard blocks local browser launches below 10 GiB; every browser is silent and engines run sequentially. Coordinate the shared browser slot before any suite. To install those exact-version binaries from this project's pinned Playwright CLI:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/browsers" npx --no-install playwright install webkit firefox
```

CI uses the pinned local Playwright dependency, installs all three engines, and gates on the browser suite as well as unit/type/lint/build/licence/audit checks. For another machine, install all three binaries and run with `CI=1 PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/browsers"`. No remote workflow has been dispatched.

The browser suite exercises all 70 claims and reveals in Chromium, WebKit, and Firefox, including 320px layouts, keyboard paths, reloads, streaks, archive dialogs, source-context highlighting, exact corrections, sharing, synthetic swipes, storage denial, and midnight rollover. The Date-only test clock preserves native Performance and animation timing.

- `shots/v3/pass-1/` and `pass-2/`: detector, inspectors, long/empty/error/loading/offline states, real live generation/cancel/cache states, paired screenshots and combined contact sheets.
- `shots/v3/daily/`: both complete daily-game state passes.
- `shots/v3/detector-browser-report.json`: the detector's serial three-engine functional checks.
- `shots/v3/browser-report.json`: the daily game's serial three-engine functional/layout checks.
- `shots/v3/performance-report.json`: three fresh runs per engine, actual frame intervals and gzipped asset sizes.
- `docs/V3-EVIDENCE.md` and `docs/V3-CRITIQUE.md`: final results, method, two visual critiques and limits.
- `shots/v3/before/` and `shots/v2/`: earlier states, retained as historical evidence.
- `public/og.png`: 1200×630 capture of the real running interface, not an illustration.

`IDENTITY.md` records the newsroom direction: ordinary sans-serif type, white and near-black surfaces, red correction marks, green source highlights, and motion that explains meaning groups. No decorative illustrations or downloaded fonts.

## Credits and licences

Original code, prose, and artwork: **Copyright (c) 2026 Harry Freeman**, MIT (`LICENSE`). Attributed source excerpts retain their publishers' material and reuse terms; they are not relicensed by the code licence. No agency logos, third-party photographs, or font files are bundled. No endorsement is implied.

Primary sources: [NASA Science](https://science.nasa.gov/), [NOAA National Ocean Service](https://oceanservice.noaa.gov/), [NOAA Global Monitoring Laboratory](https://gml.noaa.gov/ccgg/trends/weekly.html), [US Energy Information Administration](https://www.eia.gov/energyexplained/), [US National Park Service](https://www.nps.gov/stli/learn/historyculture/statue-statistics.htm), and [NIST](https://www.nist.gov/si-redefinition/second).

Reuse guidance checked: [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/), [NOAA NOS](https://oceanservice.noaa.gov/disclaimer.html), [EIA](https://www.eia.gov/about/copyrights_reuse.php), [NPS](https://www.nps.gov/aboutus/disclaimer.htm), and [NIST](https://www.nist.gov/copyrights-disclaimers). The app uses attributed educational text excerpts under those policies, with no agency branding or third-party media. NOAA's climate page credits underlying research; the game quotes the agency's explanatory prose, not the referenced paper.

ONNX Runtime is MIT; the vendored Transformers.js browser SDK and both selected models are Apache-2.0. npm dependencies are exactly pinned with one lockfile and checked against the MIT / Apache-2.0 / BSD / ISC allowlist. The generated inventory includes optional platform packages. Playwright is Apache-2.0; system fonts are not redistributed. See `docs/dependency-licenses.json` for the complete inventory.

## Limits

Fourteen editions repeat. Source interpretation and exact-span corrections are editorial. Tiny-model answers can be confidently false, repetitive or capped at 32 tokens; entropy depends on a fallible NLI model and five samples. The detector is an additional model inference, never a replacement for source proof. Checks are dated snapshots, not continuous monitoring. A full 70-question live eval was recorded in Chromium; WebKit live lifecycle checks cover the demo question, not a second 70-question benchmark. Phones and Firefox use the recorded experience; narrow live screenshots resize a desktop session and do not claim physical-phone inference. Physical-device swipes, a full assistive-technology audit, and independent human editorial acceptance remain unperformed. Local commits require explicit authorization; no pushes, accounts or publishing.
