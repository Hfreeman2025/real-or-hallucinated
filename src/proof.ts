import type { Claim } from "./schema.ts";
export function splitProof(claim: Claim): { before: string; phrase: string; after: string } | null {
  const edit = claim.evidence.proof;
  if (!edit) return null;
  const start = claim.text.indexOf(edit.phrase);
  if (start < 0 || claim.text.indexOf(edit.phrase, start + 1) !== -1)
    throw new Error("Invalid proof span");
  return {
    before: claim.text.slice(0, start),
    phrase: edit.phrase,
    after: claim.text.slice(start + edit.phrase.length),
  };
}
export function missedTells(
  claims: Claim[],
  answers: boolean[],
): { claim: Claim; label: string; reason: string }[] {
  if (claims.length !== 5 || answers.length !== 5)
    throw new Error("Finish the round before reviewing tells");
  return claims.flatMap((claim, index) => {
    if (answers[index] === claim.real) return [];
    const edit = claim.evidence.proof;
    return [
      {
        claim,
        label: edit?.tell ?? "An unexpected fact was supported",
        reason: edit?.reason ?? claim.evidence.explanation,
      },
    ];
  });
}
