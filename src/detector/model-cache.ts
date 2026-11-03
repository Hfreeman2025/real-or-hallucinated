import { CACHE_CHUNK_BYTES, type ModelStore, matchChunked, putChunked } from "./chunk-cache.ts";
export const MODEL_CACHE = "lie-detector-models-v3";
interface Storage {
  open(name: string): Promise<ModelStore>;
}
/** Cache failures never masquerade as a saved model or discard a working memory session. */
export async function modelCache(
  storage: Storage | undefined,
  origin: string,
  unavailable: () => void,
  chunkBytes = CACHE_CHUNK_BYTES,
): Promise<ModelStore | null> {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > CACHE_CHUNK_BYTES)
    throw new Error("Invalid cache chunk size");
  let active: ModelStore | null = null;
  let reported = false;
  const failed = () => {
    active = null;
    if (!reported) {
      reported = true;
      unavailable();
    }
  };
  try {
    active = (await storage?.open(MODEL_CACHE)) ?? null;
  } catch {
    failed();
  }
  if (!active) {
    failed();
    return null;
  }
  return {
    async match(key) {
      try {
        if (!active) return undefined;
        const url = new URL(key, origin).href;
        const response = await active.match(url);
        return response ? await matchChunked(active, url, response) : undefined;
      } catch {
        failed();
        return undefined;
      }
    },
    async put(key, response) {
      try {
        if (!active) return;
        const url = new URL(key, origin).href;
        if (
          /\.onnx(?:$|\?)/.test(url) ||
          Number(response.headers.get("content-length")) > chunkBytes
        )
          await putChunked(active, url, response, chunkBytes);
        else await active.put(url, response);
      } catch {
        failed();
      }
    },
  };
}
