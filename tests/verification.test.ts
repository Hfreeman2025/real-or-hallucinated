import assert from "node:assert/strict";
import test from "node:test";
import { fetchSource } from "../scripts/source-fetch.ts";

const url = "https://science.nasa.gov/moon/facts/";
function response(
  body: BodyInit | null,
  status = 200,
  headers: HeadersInit = { "content-type": "text/html" },
) {
  const result = new Response(body, { status, headers });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
test("verification extracts visible source text and computes a response digest", async () => {
  const result = await fetchSource(url, async () =>
    response("<p>The Moon drifts away.</p><script>fake quote</script>"),
  );
  assert.equal(result.text, "The Moon drifts away.");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
test("verification fails explicitly on network and HTTP errors", async () => {
  await assert.rejects(
    fetchSource(url, async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  await assert.rejects(
    fetchSource(url, async () => response("Unavailable", 503)),
    /HTTP 503/,
  );
});
test("verification rejects non-HTML responses and unsafe final redirect URLs", async () => {
  await assert.rejects(
    fetchSource(url, async () => response("{}", 200, { "content-type": "application/json" })),
    /Expected HTML/,
  );
  await assert.rejects(
    fetchSource(url, async () => {
      const r = new Response("x", { headers: { "content-type": "text/html" } });
      Object.defineProperty(r, "url", { value: "https://example.org/" });
      return r;
    }),
    /public primary-source/,
  );
});
test("verification enforces both declared and streamed response size limits", async () => {
  await assert.rejects(
    fetchSource(url, async () =>
      response("x", 200, { "content-type": "text/html", "content-length": "5000001" }),
    ),
    /size limit/,
  );
  await assert.rejects(
    fetchSource(url, async () => response("x".repeat(5_000_001))),
    /size limit/,
  );
});
