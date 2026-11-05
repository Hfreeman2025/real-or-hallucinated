import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { preview } from "vite";

await readFile("dist/index.html");
const evidence = process.env.EVIDENCE_DIR ?? ".cache/browser-results";
await mkdir(evidence, { recursive: true });
const server = await preview({
  preview: { host: "127.0.0.1", port: 0, strictPort: true },
});
try {
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string", "Preview must expose a TCP address");
  const env = {
    ...process.env,
    PREVIEW_URL: `http://127.0.0.1:${address.port}`,
    EVIDENCE_DIR: evidence,
  };
  const suites = process.argv.includes("--detector-only") ? ["v3-check"] : ["exercise", "v3-check"];
  for (const suite of suites) {
    const child = spawn(process.execPath, ["--import", "tsx", `scripts/browser/${suite}.mjs`], {
      env,
      stdio: "inherit",
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`${suite} failed: ${signal ?? code}`)),
      );
    });
  }
} finally {
  server.httpServer.closeIdleConnections();
  await new Promise((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
