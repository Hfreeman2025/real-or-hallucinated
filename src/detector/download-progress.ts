import { GENERATOR, NLI } from "./models.ts";

/** SDK events may name the same file by repo, resolved URL or ONNX-relative path. */
export function progressFileKey(file: string): string {
  const model = [GENERATOR.id, NLI.id].find((id) => file.includes(id));
  const leaf = file.split("?")[0]?.split("/").at(-1)?.trim();
  return model && leaf ? `${model}/${leaf}` : file;
}

export function updateDownloads(
  files: Map<string, { loaded: number; total: number }>,
  progress: { file: string; loaded: number; total: number; stage: string },
): { loaded: number; total: number } {
  // v4 emits both per-file progress and an aggregate progress_total for the same bytes.
  if (progress.total > 0 && progress.stage !== "progress_total")
    files.set(progressFileKey(progress.file), { loaded: progress.loaded, total: progress.total });
  return [...files.values()].reduce(
    (sum, file) => ({ loaded: sum.loaded + file.loaded, total: sum.total + file.total }),
    { loaded: 0, total: 0 },
  );
}
