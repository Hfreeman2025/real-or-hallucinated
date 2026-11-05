# Browser lie-detector engine

The engine is MIT code in `src/detector/engine.ts`, with UI-independent types in `types.ts`, information theory/grouping in `math.ts`, and a cancellable worker transport in `client.ts` / `worker.ts`. Model files live in the configurable `MODEL_DIR` cache (default `.cache/models/`), with pinned revisions, sizes, hashes and licences in `data/models.json`. They are not bundled in the repository.

## Method and scope

Farquhar, Kossen, Kuhn and Gal, *Detecting hallucinations in large language models using semantic entropy*, Nature 630, 625–630 (2024), DOI [10.1038/s41586-024-07421-0](https://www.nature.com/articles/s41586-024-07421-0). The paper's discrete estimator uses empirical cluster frequencies. Here, K=5, temperature=0.9, top-k=40, top-p=0.95, repetition penalty=1.1, and at most 32 generated tokens per answer. A local seeded sampler applies these transforms to the original logits; its top-k/nucleus distribution is covered by independent oracle tests. It does not rely on the SDK’s inactive top-p warper or replace global randomness. A question is derived from each source-checked game claim. The prompt contains neither the verified source passage nor the reference answer.

DeBERTa xsmall NLI predicts contradiction / entailment / neutral. For every unordered answer pair, evaluate both directions, conditioned on the question. Two answers are eligible to share a meaning only when entailment wins and is at least 0.60 in both directions. Grouping is deterministic, complete-link, in sample order: a new answer must match every existing member, so a transitive chain cannot merge a contradictory pair. This conservative approximation differs from the paper's representative-based implementation; the UI exposes the full pair matrix and a threshold slider.

Discrete semantic entropy is `-sum(p * log2(p))`, where `p = cluster_size / 5`. It ranges from 0 to `log2(5)`. This is uncertainty about sampled meanings, not a calibrated probability of truth. Each sample also stores its selected tokens' original model softmax probabilities and their mean log probability; sequence predictability is separate from semantic uncertainty. Token caps are explicit.

The game's source verdicts remain authoritative. To compare a detector guess with a player's claim verdict, the engine additionally measures NLI support for the original claim from each sampled answer, then computes `(1 + mean(entailment - contradiction)) / 2`. A score of at least 0.50 predicts Real; neutral support is 0.50. This authored index is not a calibrated truth probability. Entropy is reported separately and does not force a claim verdict. Its threshold is fixed before evaluation and its accuracy and AUROC are measured on all 70 source-labelled claims. Generated-answer error AUROC additionally requires reviewed answer-error labels; it must remain null until the review is bound to the exact generated texts.

## API

```ts
const client = new DetectorClient();
await client.load(onEvent, {
  modelHost: `${location.origin}/__models/`, // optional; default local on loopback, Hugging Face elsewhere
  cache: true,
});
const result = await client.run({ id, question, claim, seed }, onEvent);
client.cancel(); // terminates worker, downloads and inference; rejects the pending operation
```

`loadEngine` / `runDetector` are also exported for embedding without this UI. `runDetector` receives an `AbortSignal`; the worker client additionally uses termination for immediate cancellation of an already executing GPU/WASM operation. Exactly one request runs at a time. The worker and model are reused across questions. The final SDK/runtime passed repeated identical cached-GPU calls against CPU and full-prefix controls; the defective older combination was rejected. Each answer receives its own nonlinearly mixed Mulberry32 stream. Worker result and event boundaries are parsed, not trusted casts. Recorded results are checked by recomputing their clusters, entropy, support and verdict before display.

Events: `progress` (unique model/file, loaded and total bytes), `phase`, `sample`, `pair`. Results include original answers, token probabilities, cap flags, all twenty directional NLI distributions, five claim-support distributions, cluster memberships and measured elapsed times. Nothing is sent to an inference service. Only model-file downloads are external when using the remote option.

### WebKit runtime profile

Chromium uses one worker for WebGPU generation and WASM entailment. WebKit uses two: generation and tokenization in the parent worker, and a CPU-only `onnxruntime-web/wasm` session in a dedicated NLI worker. Each runtime uses one WASM thread. The bridge validates int64 tensor dimensions and finite three-label float32 logits; the CPU worker passes only the ONNX session's declared input names. It uses the same pinned NLI graph, label order, softmax and clustering. No new model weights are required.

This avoids importing the SDK's GPU backend into the CPU worker. A same-process cached reload had killed WebKit with the combined runtime; simply importing the full SDK in a child worker also failed. The final CPU-only path passed first load, in-flight cancellation, reuse, persisted cached reload and cache removal. The symptom is consistent with the CPU/JSEP memory issue reported in [ONNX Runtime #33516](https://github.com/microsoft/onnxruntime/issues/33516), but our tests do not identify a particular WebKit compiler or ONNX kernel as the root cause.

The UI terminates an unfinished downloader immediately. Once loaded, it cancels cooperatively at the current sample/NLI boundary, restores the recording immediately and waits for acknowledgement before allowing another run. Loaded sessions remain reusable; a 10-second deadline terminates an unresponsive worker. The public `client.cancel()` remains an immediate hard stop. This prevents a cancelled inference view from racing another heavy allocation. Unfinished-download cancellation and immediate retry are checked in WebKit at both sizes.

## Files, cache and limits

`npm run models:fetch` downloads only the selected ONNX variants and tokenizer/config files, in sequence, into the configured model directory. It checks free disk before every large file, refuses to cross a 10 GiB reserve, checks expected size and LFS SHA-256, and renames atomically. `data/models.json` is the small public manifest, not weights. The Vite middleware allows only manifest-listed paths; traversal and unknown files cannot expose arbitrary local data. Runtime WASM/modules are same-origin static assets. The shipped build contains no weights.

The live browser uses an application-specific Cache API store, `lie-detector-models-v3`. Clearing it touches that origin's cache only; shared disk files are untouched. Failed/partial downloads do not become valid cached weights. Cache-denied sessions report memory-only operation. Headless evaluation explicitly disables the browser weight cache and streams the one shared disk copy; temporary browser profiles close after each owned launch.

Cache validation uses fresh project-owned persistent profiles, then reloads the page in the same browser process. A rerun transfers zero ONNX weights; small metadata requests may remain. Incognito storage can reject the large generator despite a reported quota, so the UI reports memory-only operation instead of pretending it was saved. Download progress excludes SDK aggregate `progress_total` events to avoid counting the same model bytes twice.

The local file server answers the SDK's exact `Range: bytes=0-0` metadata probes with one byte and an honest `Content-Range`, rather than opening an entire model body for size discovery. Weight bodies remain unchanged and allowlisted.

Large model bodies are stored in bounded 16 MiB Cache API parts. A small manifest is committed only after every part and the expected byte count are complete. Reads validate the manifest and all part headers before reconstructing a streaming response; missing or truncated parts cannot masquerade as a complete model. A replacement uses a fresh part identifier, preserving the prior complete commit if writing fails. Interrupted parts remain inaccessible and are removed by **Remove cached models**. This fixed a reproducible Chromium `Cache.put` internal error during a full SDK load even though isolated writes of the same model passed. We do not claim to have identified Chromium's internal root cause.

Phones and adapters without WebGPU keep the complete interactive recorded run. This is a designed fallback, not fabricated live inference. The daily game needs no model and remains a separate blind round. Browser automation is silent: live AudioContext is replaced by device-free OfflineAudioContext before scripts run, Chromium is muted, Firefox's volume is zero, and there is no application audio.

## Reproduce and audit

Start `npm run dev` on 5177, then `TMPDIR="$PWD/.cache/tmp" npm run models:record`. It uses the same browser-worker engine as live interaction. One Chromium instance runs the 70 questions sequentially; each completed result is checkpointed under an engine-source digest. Interruption cannot publish a partly evaluated bank. `MODEL_RECORD_LIMIT=N` permits batches; matching checkpoints are reused only after validating the input and computed result. Coordinate the shared browser slot before running it.

The model manifest, engine source digests, browser version, parameters, timings and full answer/entailment records accompany `data/detector-recording.json`. Its recorded label stays visible. `vendor/transformers/` holds the unmodified, Apache-2.0 official browser-only bundle, with licence and source/hash provenance; native image-processing dependencies are deliberately excluded. ONNX Runtime is separately pinned and permissively licensed. The selected model and compatible runtime and the GPU/WASM differential that motivated it are documented in the v3 evidence report.

## Runtime acceptance

The old SDK3.8.1/ORT1.22 combination failed an identical-prompt greedy control on Metal: cached GPU answers varied, while CPU and full-prefix GPU answers agreed and repeated. SDK4.3.2 with its pinned ORT1.31 passed the same control, byte for byte, in the product's module-worker environment. See `docs/experiments/runtime-differential-*.json`. This identifies a defective older cached execution path; it does not claim an upstream kernel-level root cause. A direct page-thread upgrade trial was interrupted during dependency re-optimisation and is not accepted inference evidence.

The final seed generator uses Mulberry32, with reproducibility and known-vector tests. Nearby linear seeds in the earlier xorshift design produced a correlated first-draw ramp; nonlinearly mixed streams avoid that artefact. Each sampled answer uses its recorded seed plus its fixed sample offset. The local heap-based sampler is checked against a full-sort oracle over changing vocabularies. Original model probabilities are retained before every transformation. A 32-token cap is reported only if generation reaches it without an end-of-answer token.

Recording preflight verifies every selected cached model file against its exact manifest size and SHA-256 digest. The recording engine digest includes the actual vendored SDK bytes, its provenance, the lockfile, model manifest and engine modules. This prevents accepting checkpoints after a runtime or algorithm change. Browser profiles use a project-owned temporary directory, cache is disabled for evaluation, and each question is checkpointed before continuing.
