const DAY = 86_400_000;
export function dayNumber(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid calendar date");
  const time = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date)
    throw new Error("Invalid calendar date");
  return Math.floor(time / DAY);
}
export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY + DAY / 2).toISOString().slice(0, 10);
}
export function londonDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function displayDate(date: string, long = false): string {
  dayNumber(date);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: long ? "long" : "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function puzzleIndex(date: string, start: string, count: number): number {
  if (!Number.isInteger(count) || count < 1) throw new Error("Empty puzzle bank");
  const elapsed = dayNumber(date) - dayNumber(start);
  return ((elapsed % count) + count) % count;
}
export function score(answers: boolean[], truths: boolean[]): number {
  if (answers.length !== 5 || truths.length !== 5) throw new Error("Incomplete round");
  return answers.reduce((sum, answer, index) => sum + Number(answer === truths[index]), 0);
}
export function streak(dates: string[], today: string): number {
  const days = new Set(dates.map(dayNumber));
  let day = dayNumber(today);
  if (!days.has(day)) day--;
  let count = 0;
  while (days.has(day)) {
    count++;
    day--;
  }
  return count;
}
export function shareText(date: string, correct: number, results: boolean[]): string {
  if (results.length !== 5 || correct !== results.filter(Boolean).length)
    throw new Error("Cannot share an incomplete or inconsistent result");
  return `Real or Hallucinated?\n${displayDate(date)} | ${correct}/5\n${results.map((result) => (result ? "[+]" : "[-]")).join(" ")}\nFive claims checked.`;
}
