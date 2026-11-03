import {
  addDays,
  dayNumber,
  displayDate,
  londonDate,
  puzzleIndex,
  score,
  shareText,
  streak,
} from "./core.ts";
import { mountDetector } from "./detector/view.ts";
import { escapeHtml as e, element } from "./dom.ts";
import { type Bank, parseBank } from "./schema.ts";
import { emptyHistory, type History, loadHistory, type Round, saveHistory } from "./storage.ts";
import { roundView, summaryView } from "./views.ts";

const game = element("#game", HTMLElement);
const dialog = element("#info-dialog", HTMLDialogElement);
const content = element("#dialog-content", HTMLElement);
const announcement = element("#announcement", HTMLElement);
let bank: Bank | null = null;
let history: History = emptyHistory();
let storageError: string | null = null;
let date = londonDate();
let dailyMode = true;
let expiryNoted = false;
let firstPaintScheduled = false;
let detectorMounted = false;
function ensureDetector() {
  if (bank && !detectorMounted) {
    detectorMounted = true;
    void mountDetector(element("#detector", HTMLElement), bank);
  }
}
let detectorMode = new URL(location.href).searchParams.get("view") !== "daily";
function showView(detector: boolean) {
  detectorMode = detector;
  element("#skip-game", HTMLButtonElement).textContent = detector
    ? "Skip to the detector"
    : "Skip to the claim";
  if (detector) ensureDetector();
  element("#detector", HTMLElement).hidden = !detector;
  element("#daily-view", HTMLElement).hidden = detector;
  for (const [id, active] of [
    ["detector-open", detector],
    ["daily-open", !detector],
  ] as const) {
    const button = element(`#${id}`, HTMLButtonElement);
    button.classList.toggle("view-current", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const url = new URL(location.href);
  url.searchParams.set("view", detector ? "detector" : "daily");
  window.history.replaceState(null, "", url);
}
showView(detectorMode);
element("#detector-open", HTMLButtonElement).addEventListener("click", () => showView(true));
element("#daily-open", HTMLButtonElement).addEventListener("click", () => showView(false));
try {
  const loaded = loadHistory(localStorage);
  history = loaded.history;
  storageError = loaded.error;
} catch {
  storageError =
    "Browser storage is unavailable. You can play; progress lasts for this session only.";
}
function currentBank(): Bank {
  if (!bank) throw new Error("Edition data is unavailable");
  return bank;
}
function puzzle() {
  const b = currentBank();
  const p = b.puzzles[puzzleIndex(date, b.startDate, b.puzzles.length)];
  if (!p) throw new Error("No edition for this date");
  return p;
}
function round(): Round {
  const saved = history.rounds[date];
  if (saved?.editionId === puzzle().id) return saved;
  const created: Round = { editionId: puzzle().id, answers: [], reviewed: 0 };
  history.rounds[date] = created;
  return created;
}
function persist() {
  try {
    storageError = saveHistory(localStorage, history) ?? storageError;
  } catch {
    storageError = "Browser storage is unavailable. Progress lasts for this session only.";
  }
}
function announce(text: string) {
  announcement.textContent = text;
}
function notices() {
  element("#notices", HTMLElement).innerHTML =
    `${storageError ? `<p class="state-notice">${e(storageError)}</p>` : ""}${!navigator.onLine ? '<p class="state-notice offline-notice">Offline. This bundled edition remains available; original source links need a connection.</p>' : ""}${expiryNoted ? '<p class="state-notice">A new London day has begun. Finish this round, then open today in the archive.</p>' : ""}`;
  const checkedOn = bank?.puzzles[0]?.claims[0]?.evidence.contextCheckedOn;
  element("#connection-status", HTMLElement).textContent =
    `${navigator.onLine ? "Bundled evidence" : "Offline · bundled evidence"}${checkedOn ? ` · checked ${displayDate(checkedOn)}` : ". No live feed."}`;
}
function render(focus?: "verdict" | "summary" | "claim") {
  const r = round();
  element("#edition-date", HTMLElement).textContent =
    `${date === londonDate() ? "Today" : "Archive"} · ${displayDate(date, true)} · Europe/London`;
  element("#streak", HTMLElement).textContent =
    `Daily streak: ${streak(history.completedDates, londonDate())}`;
  game.innerHTML = r.reviewed === 5 ? summaryView(puzzle(), r, date) : roundView(puzzle(), r);
  game.setAttribute("aria-busy", "false");
  notices();
  game.querySelector("#answer-fake")?.addEventListener("click", () => answer(false));
  game.querySelector("#answer-real")?.addEventListener("click", () => answer(true));
  game.querySelector("#next")?.addEventListener("click", next);
  game.querySelector("#share")?.addEventListener("click", () => {
    void share();
  });
  const archiveButton = game.querySelector("#another-day");
  if (archiveButton instanceof HTMLButtonElement) bindDialog(archiveButton, archive);
  game.querySelector("#proof-phrase")?.addEventListener("click", () => {
    const note = element("#proof-note", HTMLElement);
    note.focus({ preventScroll: true });
    if (matchMedia("(max-width:760px)").matches)
      note.scrollIntoView({ block: "nearest", behavior: "instant" });
  });
  if (focus === "verdict") {
    const claim = puzzle().claims[r.reviewed];
    if (claim?.real && matchMedia("(max-width:760px)").matches) {
      game.querySelector<HTMLElement>("#source-heading")?.focus({ preventScroll: true });
      game.querySelector(".evidence-desk")?.scrollIntoView({ block: "start", behavior: "instant" });
    } else game.querySelector<HTMLElement>("#verdict")?.focus({ preventScroll: true });
  }
  if (focus === "summary")
    game.querySelector<HTMLElement>("#summary-title")?.focus({ preventScroll: true });
  if (focus === "claim") {
    game.focus({ preventScroll: true });
    if (matchMedia("(max-width:760px)").matches)
      game.scrollIntoView({ block: "start", behavior: "instant" });
  }
  if (!firstPaintScheduled) {
    firstPaintScheduled = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => performance.mark("roh:first-claim-painted")),
    );
  }
}
function answer(value: boolean) {
  if (!bank || dialog.open || detectorMode) return;
  const r = round();
  if (r.reviewed === 5 || r.answers.length !== r.reviewed) return;
  const claim = puzzle().claims[r.reviewed];
  if (!claim) return;
  r.answers.push(value);
  persist();
  performance.mark("roh:reveal-start");
  render("verdict");
  announce(
    `${claim.real ? "Real" : "Hallucinated"}. ${value === claim.real ? "Correct." : "Incorrect."} ${claim.evidence.proof?.reason ?? claim.evidence.explanation}`,
  );
}
function next() {
  const r = round();
  if (r.reviewed >= r.answers.length) return;
  r.reviewed++;
  if (r.reviewed === 5 && date === londonDate() && !history.completedDates.includes(date))
    history.completedDates.push(date);
  persist();
  render(r.reviewed === 5 ? "summary" : "claim");
  announce(
    r.reviewed === 5
      ? `Round complete: ${score(
          r.answers,
          puzzle().claims.map((c) => c.real),
        )} out of 5. Review the tells you missed.`
      : `Claim ${r.reviewed + 1} of 5.`,
  );
}
async function share() {
  const results = round().answers.map((answer, i) => answer === puzzle().claims[i]?.real);
  const text = shareText(date, results.filter(Boolean).length, results);
  try {
    await navigator.clipboard.writeText(text);
    element("#share-status", HTMLElement).textContent =
      "Result copied. No claims or answers included.";
  } catch {
    element("#share-status", HTMLElement).textContent =
      "Clipboard unavailable. Select and copy the result below.";
    element("#share-fallback", HTMLElement).innerHTML =
      `<label for="result-text">Spoiler-free result</label><textarea id="result-text" readonly rows="5">${e(text)}</textarea>`;
    element("#result-text", HTMLTextAreaElement).select();
  }
}
function openDialog(title: string, markup: string) {
  element("#dialog-title", HTMLElement).textContent = title;
  content.innerHTML = markup;
  if (!dialog.open) dialog.showModal();
}
function bindDialog(button: HTMLButtonElement, open: () => void) {
  button.addEventListener("click", () => {
    // Safari does not focus mouse-clicked buttons by default. Establish the
    // native dialog's return target explicitly, including for mouse users.
    button.focus({ preventScroll: true });
    open();
  });
}
function selectDate(value: string) {
  showView(false);
  if (!bank || value < bank.startDate || value > londonDate()) return;
  dayNumber(value);
  date = value;
  dailyMode = value === londonDate();
  expiryNoted = false;
  const url = new URL(location.href);
  url.searchParams.set("date", date);
  window.history.replaceState(null, "", url);
  dialog.close();
  render("claim");
  announce(`Opened ${displayDate(date)}.`);
}
function archive() {
  if (!bank) {
    openDialog(
      "Archive unavailable",
      "<p>The edition file has not loaded. Reload the page to try again.</p>",
    );
    return;
  }
  const b = bank;
  const today = londonDate();
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, -i)).filter(
    (d) => d >= b.startDate,
  );
  openDialog(
    "Archive",
    `<p>14 editions rotate every 14 days. Later dates repeat the same editions. Archive play does not backfill your streak.</p><div class="archive-list">${
      dates.length
        ? dates
            .map((d) => {
              const p = b.puzzles[puzzleIndex(d, b.startDate, b.puzzles.length)];
              if (!p) return "";
              const saved = history.rounds[d];
              const complete = saved?.editionId === p.id && saved.reviewed === 5;
              return `<button type="button" data-date="${d}" ${d === date ? 'aria-current="date"' : ""}><span><strong>${d === today ? "Today" : displayDate(d)}</strong><small>Edition ${puzzleIndex(d, b.startDate, b.puzzles.length) + 1}</small></span><span>${
                complete
                  ? `${score(
                      saved.answers,
                      p.claims.map((c) => c.real),
                    )}/5`
                  : saved?.answers.length
                    ? "Continue"
                    : "Open"
              }</span></button>`;
            })
            .join("")
        : `<p class="empty-archive">There are no earlier editions yet. The first edition opens on ${displayDate(b.startDate)}.</p>`
    }</div>${dates.length ? `<form id="archive-form"><label for="archive-date">Open a date</label><div class="date-picker"><input type="date" id="archive-date" min="${b.startDate}" max="${today}" value="${date}" required/><button type="submit">Open edition</button></div><p class="checked">Available from ${displayDate(b.startDate)}. Calendar dates use Europe/London.</p></form>` : ""}`,
  );
  for (const button of content.querySelectorAll<HTMLButtonElement>("[data-date]"))
    button.addEventListener("click", () => {
      if (button.dataset.date) selectDate(button.dataset.date);
    });
  content.querySelector("#archive-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = element("#archive-date", HTMLInputElement);
    if (input.reportValidity()) selectDate(input.value);
  });
}
function about() {
  openDialog(
    "How it works",
    `<p>Assess five claims. Every citation points to a real public source, but some claims deliberately misrepresent it.</p><ol class="how-to"><li>Choose Real or Hallucinated. Left/right arrow keys and horizontal swipes work too.</li><li>Inspect the reveal. A fabrication gets its exact altered phrase marked, with an editor’s correction. A fact gets its source passage, with the supporting quote highlighted in context.</li><li>Review the tells you missed. Your score and daily streak stay in this browser.</li></ol><p>There is no timer or fixed daily ratio. Finishing today’s London-date edition adds to your streak. Archive rounds do not create past streak days.</p><p>Fourteen editions rotate. The daily game uses bundled source checks and no model. The separate Lie detector offers an explicitly recorded experiment and optional on-device model downloads. No analytics or account is used. Reduced-motion settings are respected.</p>`,
  );
}
function sources() {
  openDialog(
    "Sources & verification",
    `<p>All 70 claims and corrections were AI-authored for this project. The verdicts are grounded in fetched primary-source text, not a model’s confidence.</p><h3>What is checked</h3><p>NASA, NOAA, the US Energy Information Administration, the National Park Service, and NIST supply the cited source pages. Each reveal links its original page. No endorsement is implied.</p><p>Real claims have a supporting quotation. Fabricated claims alter a number, date, location, definition, comparison, or attribution that the cited page contradicts. Each red mark identifies the exact altered span.</p><p>The verifier re-fetches all 18 unique pages, checks all 70 quotes, and stores the surrounding source sentences only after every check passes. It never substitutes cached content after a failed fetch.</p><h3>Limits</h3><p>These are dated editorial checks, not live facts. Matching a quote proves that text is present; assessing its meaning still requires judgement. Proof notes are editorial explanations, not an automated hallucination detector.</p><p>Fabrications avoid living people, company conduct, health advice, and elections. Shared results contain no claims or true/false verdicts. Quotes retain their publishers’ attribution and reuse terms. No agency branding or third-party media is bundled.</p><h3>Local progress</h3><p>Saved answers are validated before use. Storage failure leaves a playable session with an explicit notice. Clearing site data clears progress. Local scores can be edited; this is not a competitive leaderboard.</p><p>Original code and artwork: MIT. © 2026 Harry Freeman. System fonts. No tracking.</p>`,
  );
}
element("#skip-game", HTMLButtonElement).addEventListener("click", () => {
  game.focus();
  game.scrollIntoView({ block: "start", behavior: "instant" });
});
bindDialog(element("#archive-open", HTMLButtonElement), archive);
bindDialog(element("#about-open", HTMLButtonElement), about);
bindDialog(element("#sources-open", HTMLButtonElement), sources);
element("#dialog-close", HTMLButtonElement).addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
document.addEventListener("keydown", (event) => {
  if (
    detectorMode ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    dialog.open ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  )
    return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    answer(event.key === "ArrowRight");
  }
});
let swipeStart: { x: number; y: number } | null = null;
game.addEventListener(
  "touchstart",
  (event) => {
    const t = event.touches[0];
    swipeStart =
      t &&
      event.touches.length === 1 &&
      !(event.target instanceof Element && event.target.closest("button,a,details,textarea"))
        ? { x: t.clientX, y: t.clientY }
        : null;
  },
  { passive: true },
);
game.addEventListener(
  "touchend",
  (event) => {
    const t = event.changedTouches[0];
    if (t && swipeStart) {
      const dx = t.clientX - swipeStart.x;
      const dy = t.clientY - swipeStart.y;
      if (Math.abs(dx) >= 75 && Math.abs(dx) > Math.abs(dy) * 1.6) answer(dx > 0);
    }
    swipeStart = null;
  },
  { passive: true },
);
game.addEventListener("touchcancel", () => {
  swipeStart = null;
});
window.addEventListener("offline", notices);
window.addEventListener("online", notices);
function checkDay() {
  if (bank && dailyMode && !expiryNoted && date !== londonDate()) {
    expiryNoted = true;
    element("#edition-date", HTMLElement).textContent =
      `Open edition · ${displayDate(date, true)} · Europe/London`;
    element("#streak", HTMLElement).textContent =
      `Daily streak: ${streak(history.completedDates, londonDate())}`;
    const summaryNote = game.querySelector<HTMLElement>(".result-panel > .checked");
    if (summaryNote) summaryNote.textContent = "A newer edition is available in the archive.";
    notices();
    announce("A new London day has begun. Open today in the archive after this round.");
  }
}
setInterval(checkDay, 30000);
window.addEventListener("focus", checkDay);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkDay();
});
async function boot() {
  try {
    const { default: rawBank } = await import("../data/puzzles.json");
    bank = parseBank(rawBank);
    if (detectorMode) ensureDetector();
    const requested = new URL(location.href).searchParams.get("date");
    if (requested) {
      try {
        if (
          dayNumber(requested) >= dayNumber(bank.startDate) &&
          dayNumber(requested) <= dayNumber(londonDate())
        )
          date = requested;
      } catch {
        announce("Invalid archive date. Today’s edition is open.");
      }
    }
    dailyMode = date === londonDate();
    render();
  } catch {
    element("#edition-date", HTMLElement).textContent = "Edition unavailable";
    element("#streak", HTMLElement).textContent =
      `Daily streak: ${streak(history.completedDates, londonDate())}`;
    element("#detector", HTMLElement).innerHTML =
      '<div class="detector-unavailable"><h2>Verified question bank unavailable</h2><p>The claim file could not be loaded or validated. No model has been loaded and no answers have been substituted. Reload to try again.</p></div>';
    game.setAttribute("aria-busy", "false");
    game.innerHTML =
      '<div class="unavailable-desk" role="alert"><p class="section-label">Edition unavailable</p><h2>The claim file could not be loaded or validated.</h2><p>No answers or evidence have been substituted. If this local server was restarted, reload the page.</p><button type="button" class="secondary-button" id="reload">Reload edition</button></div>';
    game.querySelector("#reload")?.addEventListener("click", () => location.reload());
    notices();
  }
}
void boot();
