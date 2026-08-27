#!/usr/bin/env node
/**
 * Hero render: a medical office building with every architectural feature on.
 *
 * Usage:
 *   npm run preview            # in one shell
 *   node tools/feature-render.mjs [outputDir]
 *
 * Features are distributed across the walls the camera can actually see, and
 * which walls those are is MEASURED rather than assumed — a big reference bay
 * is tried on each wall in turn and the walls are ranked by how much of the
 * frame they move.
 */
import { chromium } from "playwright";

const OUT = process.argv[2] ?? ".";
const b = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  executablePath: process.env.CHROMIUM_PATH,
});
const page = await b.newPage({ viewport: { width: 1760, height: 1040 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

const isFinal = () => document.querySelector(".sample-meter")?.textContent?.includes("final");
await page.addInitScript(`window.__isFinal = ${isFinal.toString()}`);
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForTimeout(7000);

const settle = async () => {
  await page.waitForFunction(() => !window.__isFinal(), null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => window.__isFinal(), null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(300);
};
const sig = () =>
  page.evaluate(() => {
    const c = document.querySelector("canvas");
    const N = 220, off = document.createElement("canvas");
    off.width = N; off.height = N;
    const ctx = off.getContext("2d");
    ctx.drawImage(c, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data, out = new Array(N * N);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) out[p] = ((d[i] * 299 + d[i+1] * 587 + d[i+2] * 114) / 1000) | 0;
    return out;
  });
const diff = (a, c) => a.reduce((n, v, i) => n + (Math.abs(v - c[i]) > 6 ? 1 : 0), 0);

// --- Set up a medical office building -------------------------------------
await page.getByRole("tab", { name: "Program" }).click();
await page.waitForTimeout(400);
await page.getByLabel("Market").selectOption({ label: "Healthcare" });
await page.waitForTimeout(900);
await page.getByLabel("Building type").selectOption({ label: "Medical Office Building" });
await page.waitForTimeout(1200);
const target = page.getByLabel("Target square feet");
await target.fill("72000");
await target.press("Enter");
await page.waitForTimeout(1500);

// Modest sample count while we place things.
await page.getByRole("tab", { name: "Render" }).click();
await page.waitForTimeout(300);
await page.locator(".section-head", { hasText: "Quality" }).click();
await page.waitForTimeout(300);
await page.getByLabel("Viewport samples").fill("32");
await page.waitForTimeout(300);
await page.locator("button", { hasText: "Corner" }).first().click();
await page.waitForTimeout(1200);
await page.getByRole("tab", { name: "Program" }).click();
await page.waitForTimeout(500);

const head = page.locator(".section-head", { hasText: "Architectural features" });
if (!(await page.getByLabel("Add a feature").isVisible().catch(() => false))) {
  await head.click();
  await page.waitForTimeout(300);
}
const rows = () => page.locator(".section-body > div > div > button").filter({ hasText: /\$/ });
const del = () => page.locator("button", { hasText: /^Delete$/ }).first();
/** A row toggles, so clicking an already-open one closes it. Open, don't toggle. */
const openRow = async (i) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await del().isVisible().catch(() => false)) return;
    await rows().nth(i).click();
    await page.waitForTimeout(320);
  }
};
const clearAll = async () => {
  while ((await rows().count()) > 0) {
    await openRow(0);
    await del().click();
    await page.waitForTimeout(600);
  }
};
const wallSelect = () => page.locator("label.field", { hasText: "Wall" }).locator("select").first();

await clearAll();
await settle();
const bare = await sig();

// --- Which walls can this camera see? -------------------------------------
await page.getByLabel("Add a feature").selectOption("bay");
await page.waitForTimeout(700);
await openRow(0);
for (const [label, v] of [["Width (ft)", "60"], ["Projection (ft)", "12"]]) {
  const f = page.getByLabel(label).last();
  await f.fill(v); await f.press("Enter"); await page.waitForTimeout(400);
}
const values = await wallSelect().evaluate((el) => [...el.options].map((o) => ({ v: o.value, t: o.text })));
const ranked = [];
for (const o of values) {
  await wallSelect().selectOption(o.v);
  await settle();
  ranked.push({ ...o, px: diff(bare, await sig()) });
}
ranked.sort((a, b) => b.px - a.px);
console.log("walls by visibility:", ranked.map((r) => `${r.t}=${r.px}`).join("  "));
await clearAll();
await settle();

// --- Every feature, spread across the walls that read ----------------------
const visible = ranked.filter((r) => r.px > 30).slice(0, 3);
const wallFor = (i) => visible[i % visible.length].v;

// Sized so each move reads at building scale rather than as a detail.
const PLAN = [
  ["porte_cochere", { "Width (ft)": 46, "Projection (ft)": 26, "Clear height (ft)": 15 }],
  ["lobby",         { "Width (ft)": 52, "Projection (ft)": 10 }],
  ["canopy",        { "Width (ft)": 34, "Projection (ft)": 10 }],
  ["plaza",         { "Width (ft)": 90, "Depth (ft)": 46 }],
  ["pergola",       { "Width (ft)": 34, "Projection (ft)": 16 }],
  ["bay",           { "Width (ft)": 26, "Projection (ft)": 4 }],
  ["feature_corner", {}],
  ["balcony",       {}],
  ["loggia",        { "Width (ft)": 34, "Depth into plan (ft)": 12 }],
  ["connector",     {}],
  ["brise_soleil",  {}],
  ["sunshade",      {}],
  ["atrium",        {}],
  ["terrace",       {}],
  ["roof_screen",   {}],
  ["cornice",       {}],
];

let wallIndex = 0;
for (const [kind, fields] of PLAN) {
  await page.getByLabel("Add a feature").selectOption(kind);
  await page.waitForTimeout(700);
  const n = await rows().count();
  await openRow(n - 1);

  if (await wallSelect().count()) {
    await wallSelect().selectOption(wallFor(wallIndex++));
    await page.waitForTimeout(400);
    // Spread them along the wall so they do not stack on one another.
    const along = page.getByLabel("Position along wall").last();
    if (await along.count()) {
      await along.fill(String(20 + ((wallIndex * 27) % 60)));
      await along.press("Enter");
      await page.waitForTimeout(350);
    }
  }
  for (const [label, v] of Object.entries(fields)) {
    const f = page.getByLabel(label).last();
    if (await f.count()) { await f.fill(String(v)); await f.press("Enter"); await page.waitForTimeout(350); }
    else console.log(`  ${kind}: no field "${label}"`);
  }
  await rows().nth(n - 1).click();
  await page.waitForTimeout(200);
}

console.log("features placed:", await rows().count());
const kpis = await page.evaluate(() =>
  Object.fromEntries([...document.querySelectorAll(".dock .kpi")].map((el) => [
    el.querySelector(".label")?.textContent, el.querySelector(".kpi-value")?.textContent])));
console.log(kpis);

// --- Render it properly ----------------------------------------------------
await page.getByRole("tab", { name: "Render" }).click();
await page.waitForTimeout(400);
// The Quality section collapses when the tab unmounts, so re-open it.
if (!(await page.getByLabel("Viewport samples").isVisible().catch(() => false))) {
  await page.locator(".section-head", { hasText: "Quality" }).click();
  await page.waitForTimeout(400);
}
await page.getByLabel("Viewport samples").fill("400");
await page.waitForTimeout(400);

for (const preset of ["Corner", "Approach", "Aerial", "Plan"]) {
  await page.locator("button", { hasText: preset }).first().click();
  await page.waitForTimeout(1500);
  await settle();
  await page.locator(".stage").screenshot({ path: `${OUT}/features-${preset.toLowerCase()}.png` });
  console.log("rendered", preset);
}

await b.close();
