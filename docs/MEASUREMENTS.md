# Recorded measurements

These are dated observations, not a claim about an arbitrary machine or a hosted deployment. The model evaluation was recorded on 2 November 2026; the current documentation's performance and typography measurements were captured on 3 November 2026, before the public-readiness refactor. Model inference was not re-recorded for that refactor.

## Evaluation

All seventy source-labelled claims become questions, with five answers each. The prompt includes neither the reference answer nor the verified passage. Each result stores token probabilities, all twenty directional answer-pair distributions, five claim-support distributions and elapsed time. Source, runtime, model, generated-answer and review digests bind the accepted data.

Claim accuracy is 42/70 (60%). Claim-support AUROC is 0.648163; semantic-entropy AUROC for first-answer errors is 0.6335, below the 0.6740 token-confidence baseline. The first answer supplies the requested fact on 20/70 questions. The review is AI-assisted, covers the requested fact rather than every added assertion, and counts one ambiguous answer as wrong. This is a small related bank, without an independent blind human benchmark.

See `data/detector-recording.json`, `data/detector-review.json` and the method in `ENGINE.md`. The verifier's dated source-fetch results remain in `data/verification.json`; they are not a live availability claim.

## Browser and rendering checks

The daily-game gate completed 245 assertions and 140 narrow-layout checks in each of Chromium, WebKit and Firefox. The detector gate completed 48 assertions per engine. Tests use native Performance/rAF with a Date-only fixture, preserving animation timing while exercising London dates from another timezone. Keyboard paths, every claim/reveal, denied storage, no-WebGPU fallback, source display and strict CSP are covered.

For performance, three fresh contexts ran per engine, sequentially on the same Mac. Meaningful paint is an application mark after the detector's first two native animation frames. Frame intervals cover the real five-card gather for the recording with the longest total answer text; they are not GPU timings or physical-phone guarantees.

| Engine | Median meaningful paint | Median frame | P95 frame |
|---|---:|---:|---:|
| Chromium 153 | 61.5 ms | 16.7 ms | 16.7 ms |
| WebKit 26.6 | 65.0 ms | 17.0 ms | 18.0 ms |
| Firefox 155 | 57.0 ms | 8.3 ms | 9.1 ms |

That build shipped 169,487 bytes of opener JavaScript/data gzipped; optional JavaScript totalled 374,527 bytes gzipped. These are asset gzip measurements, not a statement that the local preview compressed HTTP traffic. A later refactor changes bundle bytes; rerun the performance helper to measure it. Fonts total 165,476 bytes of WOFF2.

Native Chromium observation from navigation through completed replay recorded total startup CLS of exactly zero on both routes at 1440 × 900 and 390 × 844. Holding all WOFF2 responses until after data/grouping settled, then observing from before release through `document.fonts.ready` plus 600 ms, also recorded zero font-swap movement. Slow-data and warm-reload controls passed. WebKit/Firefox lacked the native CLS API in those builds; their geometry checks passed, without inventing a CLS value.

The JSON files in `measurements/` retain the timing values, assertions and raw shift entries. Resource URLs are represented as same-origin relative paths; generated screenshot paths and local server origins have been removed. The selected images in `images/` are actual UI captures.

## Runtime controls

The older Transformers.js 3.8.1 / ONNX Runtime 1.22 cached-GPU path produced different text on identical greedy calls. CPU and full-prefix GPU controls agreed and stayed stable. The accepted 4.3.2 / 1.31 combination passed repeated cached-GPU and full-prefix controls using the same pinned weights. This tests execution stability; the stable answer can still be factually wrong. The three `runtime-differential-*.json` records preserve that distinction. They do not identify a particular upstream kernel as the cause.

WebKit's combined GPU/CPU runtime failed a same-process cached reload. The final checker imports only the WASM runtime in its own worker and feeds only declared ONNX inputs. First load, cancellation, reuse, persisted reload and cache removal passed on the demo question. That lifecycle check is separate from the seventy-question Chromium benchmark.
