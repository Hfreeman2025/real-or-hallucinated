const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  deg: "°",
};
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole: string, entity: string) => {
    if (entity.startsWith("#")) {
      const n =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : whole;
    }
    return entities[entity] ?? whole;
  });
}
export function normalize(text: string): string {
  return decodeEntities(text)
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
export function quoteMatches(page: string, quote: string): boolean {
  const target = normalize(quote);
  return target.length > 0 && normalize(page).includes(target);
}
export function htmlText(html: string): string {
  return decodeEntities(
    (html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1] ?? html)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
