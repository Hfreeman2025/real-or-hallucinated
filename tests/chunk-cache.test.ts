import assert from "node:assert/strict";
import test from "node:test";
import { modelCache } from "../src/detector/model-cache.ts";

function storage() {
  const values = new Map<string, Response>();
  const writes: { key: string; bytes: number }[] = [];
  let successfulPartsBeforeFailure: number | null = null;
  return {
    values,
    writes,
    fail(after = 0) {
      successfulPartsBeforeFailure = after;
    },
    async open() {
      return {
        async match(key: string) {
          return values.get(key)?.clone();
        },
        async put(key: string, response: Response) {
          if (key.includes("__roh_part") && successfulPartsBeforeFailure !== null) {
            if (successfulPartsBeforeFailure === 0) throw new Error("quota");
            successfulPartsBeforeFailure--;
          }
          const bytes = (await response.clone().arrayBuffer()).byteLength;
          writes.push({ key, bytes });
          values.set(key, response.clone());
        },
      };
    },
  };
}
const origin = "https://example.test",
  key = `${origin}/model.onnx`;
test("bounded parts reassemble exactly, with original headers and a final commit", async () => {
  const store = storage();
  const cache = await modelCache(store, origin, () => assert.fail("cache failure"), 4);
  assert.ok(cache);
  const bytes = new Uint8Array([0, 255, 1, 254, 2, 253, 3, 252, 4, 251, 5, 250, 6]);
  await cache.put(
    key,
    new Response(bytes, {
      headers: { "content-length": "13", "content-type": "application/octet-stream" },
    }),
  );
  assert.deepEqual(
    store.writes.filter((w) => w.key !== key).map((w) => w.bytes),
    [4, 4, 4, 1],
  );
  assert.equal(store.writes.at(-1)?.key, key);
  for (let i = 0; i < 2; i++) {
    const result: Response | undefined = await cache.match(key);
    assert.ok(result);
    assert.equal(result.headers.get("content-length"), "13");
    assert.equal(result.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  }
});
test("failed replacement cannot commit partial data or destroy the previous complete model", async () => {
  const store = storage();
  let notices = 0;
  const cache = await modelCache(store, origin, () => notices++, 4);
  assert.ok(cache);
  await cache.put(key, new Response("original bytes"));
  const commit = await store.values.get(key)?.clone().text();
  const writesBefore = store.writes.length;
  store.fail(1);
  await cache.put(key, new Response("replacement bytes"));
  assert.equal(notices, 1);
  assert.equal(
    store.writes.length,
    writesBefore + 1,
    "One replacement part was written before failure",
  );
  assert.equal(await store.values.get(key)?.clone().text(), commit);
  const reopened = await modelCache(store, origin, () => assert.fail("read failed"), 4);
  assert.equal(await (await reopened?.match(key))?.text(), "original bytes");
});
test("a truncated cached part errors during streaming instead of yielding a partial model", async () => {
  const store = storage();
  const cache = await modelCache(store, origin, () => assert.fail("header checks should pass"), 4);
  assert.ok(cache);
  await cache.put(key, new Response("several parts"));
  const part = [...store.values.keys()].find((k) => k !== key);
  assert.ok(part);
  store.values.set(part, new Response("x", { headers: { "content-length": "4" } }));
  const result: Response | undefined = await cache.match(key);
  assert.ok(result);
  await assert.rejects(() => result.arrayBuffer(), /Truncated cache chunk/);
});
test("a missing part never returns an apparently complete cached model", async () => {
  const store = storage();
  let notices = 0;
  const cache = await modelCache(store, origin, () => notices++, 4);
  assert.ok(cache);
  await cache.put(key, new Response("several parts"));
  const part = [...store.values.keys()].find((k) => k !== key);
  assert.ok(part);
  store.values.delete(part);
  assert.equal(await cache.match(key), undefined);
  assert.equal(notices, 1);
});
test("truncated writes cannot publish a commit, and invalid chunk sizes are rejected", async () => {
  const store = storage();
  let notices = 0;
  const cache = await modelCache(store, origin, () => notices++, 4);
  assert.ok(cache);
  await cache.put(key, new Response("short", { headers: { "content-length": "15" } }));
  assert.equal(store.values.has(key), false);
  assert.equal(notices, 1);
  await assert.rejects(() => modelCache(store, origin, () => {}, 0), /Invalid cache chunk size/);
});
