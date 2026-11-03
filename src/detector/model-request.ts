import { GENERATOR, NLI } from "./models.ts";
/** v4 metadata discovery probes main; every actual fetch stays commit-pinned. */
export function pinModelRequest(url: string): string {
  const parsed = new URL(url);
  for (const model of [GENERATOR, NLI]) {
    const prefix = `/${model.id}/resolve/`;
    const at = parsed.pathname.indexOf(prefix);
    if (at < 0) continue;
    const revision = parsed.pathname.slice(at + prefix.length).split("/")[0];
    if (revision !== "main" && revision !== model.revision)
      throw new Error("Unreviewed model revision");
    if (revision === "main")
      parsed.pathname = parsed.pathname.replace(`${prefix}main/`, `${prefix}${model.revision}/`);
    return parsed.href;
  }
  throw new Error("Model is not in the approved manifest");
}
