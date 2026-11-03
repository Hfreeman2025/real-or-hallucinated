import type { SourceContext } from "../src/context.ts";
import { type Bank, parseBank } from "../src/schema.ts";

// Build the entire candidate before the caller atomically swaps the JSON file.
// Neither a missing page nor invalid context may partly re-date the input bank.
export function withVerifiedContexts(
  bank: Bank,
  contexts: Map<string, SourceContext>,
  checkedOn: string,
): Bank {
  const claims = bank.puzzles.flatMap((p) => p.claims);
  if (contexts.size !== claims.length || claims.some((claim) => !contexts.has(claim.id)))
    throw new Error("Every claim needs freshly verified context before refreshing the bank");
  return parseBank({
    ...bank,
    puzzles: bank.puzzles.map((puzzle) => ({
      ...puzzle,
      claims: puzzle.claims.map((claim) => ({
        ...claim,
        evidence: {
          ...claim.evidence,
          context: contexts.get(claim.id),
          contextCheckedOn: checkedOn,
        },
      })),
    })),
  });
}
