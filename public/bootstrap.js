// Choose the shell before first paint; source data still loads through the validated app.
document.documentElement.dataset.view =
  new URL(location.href).searchParams.get("view") === "daily" ? "daily" : "detector";

// Preload the two critical faces on first navigation. A reload reuses the font cache;
// requesting another preload can produce unused-preload warnings despite visible Plex text.
if (performance.getEntriesByType("navigation")[0]?.type !== "reload") {
  for (const file of [
    "ibm-plex-sans-latin-400-normal.woff2",
    "ibm-plex-sans-condensed-latin-600-normal.woff2",
  ]) {
    const webKit =
      /AppleWebKit/.test(navigator.userAgent) &&
      !/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent);
    if (webKit) {
      // WebKit may retain decoded fonts across contexts but flag matching link preloads unused.
      // FontFace.load eagerly loads these same two files without an unconsumed link hint.
      const condensed = file.includes("condensed");
      const face = new FontFace(
        condensed ? "IBM Plex Sans Condensed" : "IBM Plex Sans",
        `url("/fonts/${file}") format("woff2")`,
        { weight: condensed ? "600" : "400", display: "swap" },
      );
      void face.load().then(
        (loaded) => document.fonts.add(loaded),
        () => {},
      );
      continue;
    }
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "font";
    link.type = "font/woff2";
    link.crossOrigin = "anonymous";
    link.href = `/fonts/${file}`;
    document.head.append(link);
  }
}
