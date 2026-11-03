export function element<T extends Element>(
  selector: string,
  type: { new (...args: never[]): T },
): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing interface element: ${selector}`);
  return found;
}
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
