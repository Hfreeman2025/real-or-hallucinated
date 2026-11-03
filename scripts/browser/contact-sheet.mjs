import { readFile, writeFile } from "node:fs/promises";
import { launch } from "./runtime.mjs";

const pass = process.env.CRITIQUE_PASS ?? "pass-1";
const folder = `${process.env.EVIDENCE_DIR ?? "shots/v2"}/${pass}`;
const report = JSON.parse(await readFile(`${folder}/capture-report.json`, "utf8"));
const names = [...new Set(report.captures.map((c) => c.name))];
const browser = await launch("chromium");
try {
  for (let i = 0; i < names.length; i += 3) {
    const page = await browser.newPage({
      viewport: { width: 1040, height: 1800 },
      deviceScaleFactor: 1,
    });
    let html =
      "<html><head><style>body{margin:0;background:#d7dad4;font:14px Arial;color:#111}.row{height:620px;display:grid;grid-template-columns:730px 270px;gap:14px;padding:12px;border-bottom:2px solid #111;box-sizing:border-box}.cell{min-width:0}h2{font-size:14px;margin:0 0 8px}img{width:100%;height:570px;object-fit:contain;object-position:top left;background:#eee}</style></head><body>";
    for (const name of names.slice(i, i + 3)) {
      html += '<section class="row">';
      for (const size of ["desktop", "mobile"]) {
        const item = report.captures.find((c) => c.name === name && c.size === size);
        const bytes = await readFile(item.file);
        html += `<div class="cell"><h2>${pass} / ${name} / ${size}</h2><img src="data:image/png;base64,${bytes.toString("base64")}" /></div>`;
      }
      html += "</section>";
    }
    html += "</body></html>";
    await page.setContent(html);
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await page.screenshot({
      path: `${folder}/contact-${Math.floor(i / 3) + 1}.png`,
      fullPage: true,
    });
    await page.close();
  }
  await writeFile(
    `${folder}/contact-index.json`,
    `${JSON.stringify({ groups: Array.from({ length: Math.ceil(names.length / 3) }, (_, i) => ({ file: `contact-${i + 1}.png`, states: names.slice(i * 3, i * 3 + 3) })) }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
