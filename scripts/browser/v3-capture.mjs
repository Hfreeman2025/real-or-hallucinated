import { execFileSync } from "node:child_process";

const pass = process.env.CRITIQUE_PASS ?? "pass-1";
if (!/^pass-[12]$/.test(pass)) throw new Error("Choose pass-1 or pass-2");
const run = (script, extra = {}) =>
  execFileSync(process.execPath, ["--import", "tsx", `scripts/browser/${script}.mjs`], {
    env: { ...process.env, CRITIQUE_PASS: pass, ...extra },
    stdio: "inherit",
  });
// Each child closes its browser before returning; no parallel engines or suites.
run("v3-check", { CAPTURE: "1", ...(pass === "pass-2" ? { BROWSER_ENGINE: "chromium" } : {}) });
run("v3-extra-states");
run("v3-download-states");
run("capture", { EVIDENCE_DIR: "shots/v3/daily" });
run("v3-live");
run("v3-contacts");
