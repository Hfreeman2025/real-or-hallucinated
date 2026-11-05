# Development

## Layout

- `src/main.ts`, `core.ts`, `schema.ts`, `storage.ts` and `views.ts`: daily rotation, validation, persistence and evidence reveals.
- `src/detector/view.ts`: detector interaction and run lifecycle. `layout.ts` renders markup; `recording.ts` parses the recorded bank; `capabilities.ts` probes the designed live/fallback state.
- `src/styles/`: focused stylesheets imported in their original cascade order; `style.css` and `detector.css` are entry points.
- `src/detector/engine.ts`, `sampling.ts` and `math.ts`: inference, seeded sampling, entailment grouping and information theory. These files are bound to the published recording by SHA-256.
- Worker transports validate every event/result. WebKit's CPU-only NLI bridge avoids importing a GPU runtime into the checker worker.
- `scripts/model-server.ts`: development/preview middleware serving only manifest-allowlisted model files. `MODEL_DIR` defaults to `.cache/models`; weights are never committed.
- `data/`: source-checked claims, question bank, exact recorded output, answer-review labels and pinned model/font inventories.

Display typography is applied at the presentation boundary. Never write formatted chemical notation back into stored quotes, context extraction or quote matching. `font-display: swap`, metric-matched fallbacks and startup reservations keep the opening layout stable without hiding content until fonts arrive.

Selected interface views: [phone detector](images/detector-phone.png), [daily desk](images/daily-desktop.png), and [fabrication proof](images/fabrication-proof.png).

## Checks

```sh
npm ci
npm run check
npm run audit
```

`check` runs strict TypeScript, Biome, the unit/contract suite, recording/score bindings, build and licence checks. The audit is a separate blocking CI gate. Tests cover London dates/DST, schema rejection, storage failure, source matching, exact proof spans, sampling against an independent oracle, entropy, AUROC ties, download accounting, cache replacement failure and tensor boundaries.

Install the pinned Playwright browsers once, then run the browser suites:

```sh
npx --no-install playwright install chromium webkit firefox
npm run test:browser
```

The runner starts its own production preview on an available loopback port, runs daily and detector suites sequentially and closes the server. It does not need an existing development server, model files or a GPU. Reports go to ignored `.cache/browser-results/`. `npm run test:detector` runs only the detector suite. `EVIDENCE_DIR` overrides the report directory; `BROWSER_ENGINE` selects one engine when diagnosing a failure.

On a shared Mac, coordinate the browser slot before launch. The harness refuses overlapping automated browsers, preserves a 10 GiB disk reserve, mutes Chromium/Firefox and replaces live audio contexts with device-free offline contexts. macOS alone opts into Metal; Linux CI uses Playwright's normal backend. Do not weaken CSP or hide console errors to make screenshot tooling pass.

CI uses the repository's own locked Playwright package and installs all three engines. It builds before starting the isolated preview, runs the same recorded-game suites and uploads test reports only on failure. It does **not** fetch model weights, re-record inference or re-fetch external source pages. A configured workflow is not a claim that a remote run has happened.

## Source verification

```sh
npm run verify
```

This needs network access to eighteen public publisher pages. It checks all seventy supporting/contradicting quotes and stores fresh surrounding sentences only if every check succeeds. A failed fetch never becomes cached success. Quote matching proves presence, not the correctness of an interpretation. Review a refreshed bank before committing it.

## Live-model checks

Live inference and recording are opt-in local checks, excluded from CI because they require the model cache and a desktop WebGPU adapter. Prepare the pinned files with `npm run models:fetch`. Use the same `MODEL_DIR` for the downloader and preview when sharing an existing cache. Model preparation writes only that cache, not the committed benchmark inventory.

With the local production preview running (`npm run preview`, on port 4184):

```sh
node --import tsx scripts/browser/v3-live.mjs
node --import tsx scripts/browser/v3-webkit-download.mjs
```

These test real model load, cancellation, reuse, cache persistence/removal and WebKit download retry. Keep them serial. They may create a large ignored browser cache. They are not part of the standard recorded-only browser gate.

`npm run models:record` instead requires the local development server (`npm run dev`, on port 5177). It verifies model sizes/hashes and checkpoints the seventy-question run before updating the recording. Review generated answers and regenerate score bindings before accepting a new result; never carry labels from different output text.

`npm run shots:v3` includes live-model captures and requires prepared weights; it is not a recorded-only CI command.

Capture and performance helpers are under `scripts/browser/`. Their generated `shots/` directory is ignored. Only deliberately selected documentation images belong in `docs/images/`. The dated measurements in `docs/measurements/` describe their recorded artifact, not every later refactor.
