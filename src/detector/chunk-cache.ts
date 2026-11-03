export interface ModelStore {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}
export const CACHE_CHUNK_BYTES = 16 * 1024 ** 2;
const marker = "x-lie-detector-cache";
function partKey(key: string, id: string, index: number) {
  const url = new URL(key);
  url.searchParams.set("__roh_part", `${id}:${index}`);
  return url.href;
}
/** Commit a small manifest last; incomplete or replaced writes can never form a model. */
export async function putChunked(
  store: ModelStore,
  key: string,
  response: Response,
  chunkBytes: number,
) {
  if (!response.ok || !response.body) throw new Error("Model response has no body");
  const id = crypto.randomUUID();
  const headers = [...response.headers];
  const reader = response.body.getReader();
  let block = new Uint8Array(chunkBytes),
    filled = 0,
    total = 0,
    count = 0;
  async function flush() {
    if (!filled) return;
    if (count >= 128) throw new Error("Model exceeds cache chunk limit");
    await store.put(
      partKey(key, id, count++),
      new Response(block.slice(0, filled), { headers: { "Content-Length": String(filled) } }),
    );
    filled = 0;
    block = new Uint8Array(chunkBytes);
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      total += value.byteLength;
      while (offset < value.byteLength) {
        const take = Math.min(chunkBytes - filled, value.byteLength - offset);
        block.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === chunkBytes) await flush();
      }
    }
    await flush();
    const expected = response.headers.get("content-length");
    if (!total || (expected !== null && Number(expected) !== total))
      throw new Error("Incomplete cached model");
    await store.put(
      key,
      new Response(JSON.stringify({ version: 1, id, total, count, chunkBytes, headers }), {
        headers: { [marker]: "parts-v1", "Content-Type": "application/json" },
      }),
    );
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export async function matchChunked(
  store: ModelStore,
  key: string,
  response: Response,
): Promise<Response> {
  if (response.headers.get(marker) !== "parts-v1") return response;
  const text = await response.text();
  if (text.length > 16384) throw new Error("Invalid cache manifest");
  const meta: unknown = JSON.parse(text);
  if (
    !meta ||
    typeof meta !== "object" ||
    !("version" in meta) ||
    meta.version !== 1 ||
    !("id" in meta) ||
    typeof meta.id !== "string" ||
    !/^[a-f\d-]{36}$/.test(meta.id) ||
    !("total" in meta) ||
    typeof meta.total !== "number" ||
    !Number.isSafeInteger(meta.total) ||
    meta.total <= 0 ||
    !("count" in meta) ||
    typeof meta.count !== "number" ||
    !Number.isSafeInteger(meta.count) ||
    meta.count < 1 ||
    meta.count > 128 ||
    !("chunkBytes" in meta) ||
    typeof meta.chunkBytes !== "number" ||
    !Number.isSafeInteger(meta.chunkBytes) ||
    meta.chunkBytes < 1 ||
    meta.chunkBytes > CACHE_CHUNK_BYTES ||
    Math.ceil(meta.total / meta.chunkBytes) !== meta.count ||
    !("headers" in meta) ||
    !Array.isArray(meta.headers) ||
    meta.headers.length > 64
  )
    throw new Error("Invalid cache manifest");
  const headers = new Headers();
  for (const pair of meta.headers) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    )
      throw new Error("Invalid cached headers");
    headers.append(pair[0], pair[1]);
  }
  headers.set("content-length", String(meta.total));
  const parts: Response[] = [];
  for (let i = 0; i < meta.count; i++) {
    const part = await store.match(partKey(key, meta.id, i));
    const expected = Math.min(meta.chunkBytes, meta.total - i * meta.chunkBytes);
    if (!part?.body || Number(part.headers.get("content-length")) !== expected)
      throw new Error("Incomplete cache chunks");
    parts.push(part);
  }
  let index = 0;
  const size = meta.chunkBytes,
    total = meta.total;
  return new Response(
    new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const part = parts[index];
          if (!part) {
            controller.close();
            return;
          }
          const bytes = new Uint8Array(await part.arrayBuffer());
          if (bytes.length !== Math.min(size, total - index * size))
            throw new Error("Truncated cache chunk");
          index++;
          controller.enqueue(bytes);
        },
        async cancel() {
          await Promise.all(parts.slice(index).map((part) => part.body?.cancel()));
        },
      },
      { highWaterMark: 0 },
    ),
    { headers },
  );
}
