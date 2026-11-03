import { createHash } from "node:crypto";
import { htmlText } from "../src/matching.ts";
import { sourceUrl } from "../src/schema.ts";
export type RequestSource = (input: string, init?: RequestInit) => Promise<Response>;
export async function fetchSource(
  url: string,
  request: RequestSource = fetch,
): Promise<{ text: string; sha256: string }> {
  const response = await request(sourceUrl(url), {
    signal: AbortSignal.timeout(40_000),
    headers: { "User-Agent": "RealOrHallucinated/1.0 (personal educational source verification)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  sourceUrl(response.url);
  if (!response.headers.get("content-type")?.includes("text/html"))
    throw new Error("Expected HTML source");
  if (Number(response.headers.get("content-length")) > 5_000_000)
    throw new Error("Source exceeds size limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 5_000_000) {
      await reader.cancel();
      throw new Error("Source exceeds size limit");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  return {
    text: htmlText(body.toString("utf8")),
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}
