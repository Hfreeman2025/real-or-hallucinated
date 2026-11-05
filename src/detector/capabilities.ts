export async function probeGpuSupport(status: HTMLElement): Promise<boolean> {
  let gpuReady = false;
  const firefox = /Firefox\//.test(navigator.userAgent);
  const gpu = firefox ? undefined : Reflect.get(navigator, "gpu");
  if (matchMedia("(max-width:760px)").matches)
    status.textContent =
      "Phone mode: the interactive recorded run is ready. Live generation requires a desktop WebGPU adapter.";
  else if (firefox)
    status.textContent =
      "Firefox: live WebGPU inference is unavailable in this build. The recorded run and every inspection control remain ready.";
  else if (gpu && typeof gpu.requestAdapter === "function") {
    try {
      const adapter = await gpu.requestAdapter();
      gpuReady = !!adapter;
      status.textContent = gpuReady
        ? "WebGPU available. Generation runs on your GPU; entailment uses one WebAssembly thread."
        : "This browser has no WebGPU adapter. The recorded run and every inspection control remain available.";
    } catch {
      status.textContent =
        "WebGPU could not initialise. The recorded run remains fully inspectable.";
    }
  } else
    status.textContent =
      "WebGPU is unavailable here. The real recorded run is the designed fallback; every inspection control still works.";
  return gpuReady;
}
