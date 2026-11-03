import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  type PreTrainedModel,
} from "../../vendor/transformers/transformers.web.js";
import type { Engine, LoadOptions } from "./engine.ts";
import { GENERATOR, NLI } from "./models.ts";
import { NliBridge } from "./nli-bridge.ts";
import { configureWebKitRuntime } from "./webkit-environment.ts";
export async function loadWebKitEngine(options: LoadOptions): Promise<Engine> {
  const bridge = new NliBridge();
  let generator: PreTrainedModel | null = null;
  try {
    const progress_callback = await configureWebKitRuntime(env, options, false);
    options.emit({ type: "phase", phase: `Loading ${GENERATOR.name} · WebGPU` });
    const tokenizer = await AutoTokenizer.from_pretrained(GENERATOR.id, {
      revision: GENERATOR.revision,
      progress_callback,
    });
    generator = await AutoModelForCausalLM.from_pretrained(GENERATOR.id, {
      revision: GENERATOR.revision,
      device: "webgpu",
      dtype: "q4",
      session_options: { logSeverityLevel: 3 },
      progress_callback,
    });
    options.signal.throwIfAborted();
    options.emit({ type: "phase", phase: "Loading DeBERTa · isolated CPU-only WebAssembly" });
    const nliTokenizer = await AutoTokenizer.from_pretrained(NLI.id, {
      revision: NLI.revision,
      progress_callback,
    });
    await bridge.load(options.modelHost, options.cache, options.emit, options.signal);
    return {
      generator,
      tokenizer,
      nli: bridge.model(),
      nliTokenizer,
      backend: `${GENERATOR.name} webgpu q4 · DeBERTa CPU-only WASM q8, one thread, two isolated workers`,
    };
  } catch (error) {
    bridge.dispose();
    await generator?.dispose();
    throw error;
  }
}
