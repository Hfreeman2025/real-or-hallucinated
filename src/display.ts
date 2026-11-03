/** Presentation only. Never use this on stored evidence or verifier inputs. */
export function displaySourceText(text: string): string {
  const formulas: Record<string, string> = { CO2: "CO₂", H2O: "H₂O", CH4: "CH₄", N2O: "N₂O" };
  return text.replace(
    /(?<![\p{L}\p{N}_])(?:CO[ \t\u00a0]*2|H[ \t\u00a0]*2[ \t\u00a0]*O|CH[ \t\u00a0]*4|N[ \t\u00a0]*2[ \t\u00a0]*O)(?![\p{L}\p{N}_])/gu,
    (formula) => formulas[formula.replace(/\s/g, "")] ?? formula,
  );
}
