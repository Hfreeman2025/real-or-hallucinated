import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_CACHE, modelCache } from "../src/detector/model-cache.ts";

test("model cache scopes keys to the app store and returns the actual stored response", async () => {
  const values = new Map<string, Response>();
  let opened = "";
  const cache = await modelCache(
    {
      async open(name) {
        opened = name;
        return {
          async match(key) {
            return values.get(key);
          },
          async put(key, response) {
            values.set(key, response);
          },
        };
      },
    },
    "https://example.test",
    () => assert.fail("Cache should work"),
  );
  assert.equal(opened, MODEL_CACHE);
  assert.ok(cache);
  await cache.put("/model.onnx", new Response("actual-model-bytes"));
  assert.equal(await (await cache.match("/model.onnx"))?.text(), "actual-model-bytes");
  assert.ok(values.has("https://example.test/model.onnx"));
  assert.equal(await cache.match("/absent.onnx"), undefined);
});
test("blocked cache reports memory-only operation without claiming persistence", async () => {
  let notices = 0;
  assert.equal(await modelCache(undefined, "https://example.test", () => notices++), null);
  assert.equal(notices, 1);
  assert.equal(
    await modelCache(
      {
        async open() {
          throw new Error("Denied");
        },
      },
      "https://example.test",
      () => notices++,
    ),
    null,
  );
  assert.equal(notices, 2);
});
test("quota or read failure disables that cache and reports once; inference can retain its bytes", async () => {
  for (const failure of ["read", "write"]) {
    let notices = 0,
      accesses = 0;
    const cache = await modelCache(
      {
        async open() {
          return {
            async match() {
              accesses++;
              if (failure === "read") throw new Error("Denied");
              return undefined;
            },
            async put() {
              accesses++;
              if (failure === "write") throw new Error("QuotaExceeded");
            },
          };
        },
      },
      "https://example.test",
      () => notices++,
    );
    assert.ok(cache);
    if (failure === "read") assert.equal(await cache.match("/model"), undefined);
    else await cache.put("/model", new Response("retained-in-memory"));
    await cache.put("/later", new Response("later"));
    assert.equal(await cache.match("/later"), undefined);
    assert.equal(notices, 1);
    assert.equal(accesses, 1);
  }
});
