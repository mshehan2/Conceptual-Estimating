#!/usr/bin/env node
/**
 * Feature editor check.
 *
 * Drives the feature editor in a real browser and asserts the three things
 * that have to be simultaneously true for it to be worth anything: the
 * feature draws, the feature prices, and the two agree about whether it is
 * there. Material banding once priced correctly and never drew — the worst
 * failure mode this tool has — and no unit test in the suite could see it.
 *
 * Usage:
 *   npm run preview            # in one shell
 *   node tools/feature-check.mjs [outputDir] [url]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "feature-check";
const URL = process.argv[3] ?? "http://localhost:4173/";

const LAUNCH = {
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ok " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Read the always-visible KPI dock rather than switching tabs to the estimate. */
const kpis = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".dock .kpi")].map((el) => [
        el.querySelector(".label")?.textContent ?? "",
        el.querySelector(".kpi-value")?.textContent ?? "",
      ]),
    ),
  );

const dollars = (s) => Number(String(s).replace(/[^0-9.]/g, "")) * (/M/.test(s) ? 1e6 : /K/.test(s) ? 1e3 : 1);

/**
 * A downsampled luminance signature of the viewport.
 *
 * Compressed-length hashes were the first thing tried here and they are not
 * good enough: the number moves for reasons that have nothing to do with the
 * geometry, and it cannot say HOW MUCH changed. Once the progressive renderer
 * has settled, two signatures of the same state differ by exactly zero pixels,
 * which makes "this feature drew" a measurement rather than a guess.
 */
const SIG_N = 220;
const signature = (page) =>
  page.evaluate((N) => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const off = document.createElement("canvas");
    off.width = N;
    off.height = N;
    const ctx = off.getContext("2d");
    ctx.drawImage(c, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;
    const out = new Array(N * N);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      out[p] = ((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0;
    }
    return out;
  }, SIG_N);

/** Pixels whose luminance moved enough to be a shape rather than dither. */
const changedPixels = (a, b) =>
  !a || !b ? -1 : a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 6 ? 1 : 0), 0);

/**
 * Wait for the progressive accumulator to finish, so a signature is stable.
 *
 * Waiting for "final" alone is a trap: the store's recompute is debounced, so
 * for a moment after an edit the meter still reads "final" from the PREVIOUS
 * state and the wait returns instantly against the old image. Measurements
 * taken that way move by hundreds of pixels between identical runs. So watch
 * for the accumulator to restart first, then for it to land.
 */
const isFinal = () => document.querySelector(".sample-meter")?.textContent?.includes("final");
const settle = async (page) => {
  await page.waitForFunction(() => !window.__isFinal(), null, { timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => window.__isFinal(), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(250);
};

const featureRows = (page) =>
  page.evaluate(() => {
    const head = [...document.querySelectorAll(".section-head")].find((el) =>
      el.textContent?.includes("Architectural features"),
    );
    const body = head?.parentElement?.querySelector(".section-body") ?? head?.nextElementSibling;
    if (!body) return [];
    return [...body.querySelectorAll(":scope > div > div > button")].map((b) => ({
      label: b.querySelector("span > span")?.textContent ?? "",
      chips: [...b.querySelectorAll(".chip")].map((c) => c.textContent),
      cost: b.querySelector(".num")?.textContent ?? "",
    }));
  });

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });

  await page.addInitScript(`window.__isFinal = ${isFinal.toString()}`);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);

  await page.getByRole("tab", { name: "Program" }).click();
  await page.waitForTimeout(400);

  const section = page.locator(".section-head", { hasText: "Architectural features" });
  check("feature section is present", await section.count() > 0);
  if (await section.count() === 0) return finish(browser, errors);

  // Open it if the seeded set left it collapsed.
  if (!(await page.getByLabel("Add a feature").isVisible().catch(() => false))) {
    await section.click();
    await page.waitForTimeout(300);
  }

  const before = await kpis(page);
  const beforeRows = await featureRows(page);
  const beforeCanvas = await signature(page);
  await page.screenshot({ path: join(OUT, "01-before.png") });
  console.log(`  seeded features: ${beforeRows.length} — ${beforeRows.map((r) => r.label).join(", ")}`);

  // --- add ----------------------------------------------------------------
  await page.getByLabel("Add a feature").selectOption("porte_cochere");
  await page.waitForTimeout(1500);

  const afterAdd = await featureRows(page);
  const added = afterAdd.find((r) => r.label === "Porte cochère" && !beforeRows.some((b) => b.label === r.label))
    ?? afterAdd[afterAdd.length - 1];
  check("adding a feature adds a row", afterAdd.length === beforeRows.length + 1,
    `${beforeRows.length} → ${afterAdd.length}`);
  check("the new row prices non-zero", dollars(added?.cost) > 0, `cost ${added?.cost}`);
  check("the new row names a wall", (added?.chips ?? []).some((c) => /wall|whole/.test(c)),
    (added?.chips ?? []).join(" / "));

  const addKpis = await kpis(page);
  check(
    "adding a feature moves the project total",
    dollars(addKpis["Project total"]) !== dollars(before["Project total"]),
    `${before["Project total"]} → ${addKpis["Project total"]}`,
  );

  const addCanvas = await signature(page);
  check("adding a feature changes what is drawn", changedPixels(beforeCanvas, addCanvas) > 0,
    `${changedPixels(beforeCanvas, addCanvas)} px`);
  await page.screenshot({ path: join(OUT, "02-added.png") });

  // --- expand and retune ---------------------------------------------------
  const rowButton = page.locator("button", { hasText: "Porte cochère" }).last();
  await rowButton.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "03-expanded.png") });

  const lineRows = await page.evaluate(() => {
    const t = [...document.querySelectorAll(".table")].pop();
    return t ? [...t.querySelectorAll("tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => c.textContent)) : [];
  });
  check("expanding shows priced lines", lineRows.length > 0, `${lineRows.length} lines`);

  const costBefore = dollars((await featureRows(page)).at(-1)?.cost);
  const projection = page.getByLabel("Projection (ft)").last();
  if (await projection.count()) {
    await setNumber(projection, 30);
    await page.waitForTimeout(1400);
    const costAfter = dollars((await featureRows(page)).at(-1)?.cost);
    check("a bigger projection costs more", costAfter > costBefore,
      `${costBefore} → ${costAfter}`);
  } else {
    check("projection control exists", false, "no 'Projection (ft)' field");
  }
  await page.screenshot({ path: join(OUT, "04-retuned.png") });

  // --- toggle off ----------------------------------------------------------
  const offCanvasBefore = await signature(page);
  await page.locator("button", { hasText: /^On$/ }).last().click();
  await page.waitForTimeout(1400);
  const offRows = await featureRows(page);
  check("switching a feature off zeroes its cost", dollars(offRows.at(-1)?.cost) === 0,
    `cost ${offRows.at(-1)?.cost}`);
  check("switching a feature off marks it", (offRows.at(-1)?.chips ?? []).includes("off"),
    (offRows.at(-1)?.chips ?? []).join(" / "));
  check("switching a feature off removes it from the render",
    changedPixels(offCanvasBefore, await signature(page)) > 0);
  await page.screenshot({ path: join(OUT, "05-off.png") });

  await page.locator("button", { hasText: /^Off$/ }).last().click();
  await page.waitForTimeout(1200);

  // --- duplicate -----------------------------------------------------------
  await page.locator("button", { hasText: "Duplicate" }).last().click();
  await page.waitForTimeout(1400);
  const dupRows = await featureRows(page);
  check("duplicate adds a second row", dupRows.length === afterAdd.length + 1,
    `${afterAdd.length} → ${dupRows.length}`);
  check("the duplicate prices the same as its original",
    Math.abs(dollars(dupRows.at(-1)?.cost) - dollars(dupRows.at(-2)?.cost)) < 1,
    `${dupRows.at(-2)?.cost} vs ${dupRows.at(-1)?.cost}`);
  await page.screenshot({ path: join(OUT, "06-duplicated.png") });

  // --- delete --------------------------------------------------------------
  const delKpisBefore = await kpis(page);
  await page.locator("button", { hasText: "Delete" }).last().click();
  await page.waitForTimeout(1400);
  const delRows = await featureRows(page);
  check("delete removes the row", delRows.length === dupRows.length - 1,
    `${dupRows.length} → ${delRows.length}`);
  check("delete moves the project total back down",
    dollars((await kpis(page))["Project total"]) < dollars(delKpisBefore["Project total"]),
    `${delKpisBefore["Project total"]} → ${(await kpis(page))["Project total"]}`);
  await page.screenshot({ path: join(OUT, "07-deleted.png") });

  // --- every kind adds without error ---------------------------------------
  const kinds = await page.evaluate(() =>
    [...document.querySelectorAll('select')].flatMap((s) =>
      [...s.options].filter((o) => o.parentElement?.tagName === "OPTGROUP" &&
        ["Entry & arrival", "Facade", "Volume", "Roof & outdoor"].includes(o.parentElement.label))
        .map((o) => o.value)));
  const uniqueKinds = [...new Set(kinds)];
  let addErrors = errors.length;
  for (const kind of uniqueKinds) {
    await page.getByLabel("Add a feature").selectOption(kind);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
  const allRows = await featureRows(page);
  const zero = allRows.filter((r) => dollars(r.cost) === 0 && !r.chips.includes("off"));
  check("every feature kind adds cleanly", errors.length === addErrors,
    errors.slice(addErrors).join(" | "));
  check("no enabled feature prices at zero", zero.length === 0,
    zero.map((r) => r.label).join(", "));
  check("all kinds present", allRows.length === delRows.length + uniqueKinds.length,
    `${uniqueKinds.length} kinds, ${allRows.length} rows`);
  await page.screenshot({ path: join(OUT, "08-all-kinds.png") });

  // A render with everything on is the picture worth actually looking at.
  await settle(page);
  await page.locator(".stage").screenshot({ path: join(OUT, "09-all-kinds-render.png") });

  await drawCheck(page);
  await finish(browser, errors);
}

/**
 * Does each feature actually DRAW?
 *
 * This is the check that matters most. Material banding once priced perfectly
 * and rendered nothing at all, and every test in the suite was green while it
 * did — because a takeoff and a mesh are produced by different code from the
 * same parameters, and only a picture can tell you they agree. So: clear the
 * model, settle, and for each kind add it alone and count the pixels that
 * move. On a settled accumulator, an identical scene differs by zero.
 */
async function drawCheck(page) {
  console.log("\n  per-feature draw check");

  // Fewer samples: this is sixteen settles, and it is a shape test, not a
  // beauty contest.
  await page.getByRole("tab", { name: "Render" }).click();
  await page.waitForTimeout(300);
  await page.locator(".section-head", { hasText: "Quality" }).click();
  await page.waitForTimeout(300);
  await page.getByLabel("Viewport samples").fill("24");
  await page.getByRole("tab", { name: "Program" }).click();
  await page.waitForTimeout(400);

  const rows = () => page.locator(".section-body > div > div > button").filter({ hasText: /\$/ });
  const clearAll = async () => {
    while ((await rows().count()) > 0) {
      await rows().first().click();
      await page.waitForTimeout(300);
      await page.locator("button", { hasText: /^Delete$/ }).first().click();
      await page.waitForTimeout(650);
    }
  };

  await clearAll();

  // Features default to the first wall, which the opening camera is behind.
  // Orbit round to it once, then hold the camera still for the whole loop.
  const box = await page.locator(".stage").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let k = 0; k < 2; k++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(cx + i * 14, cy + i * 1.2, { steps: 1 });
    await page.mouse.up();
  }

  await settle(page);
  const bare = await signature(page);
  check("a settled render is stable", changedPixels(bare, await signature(page)) === 0,
    `${changedPixels(bare, await signature(page))} px of noise`);

  const kinds = [
    "canopy", "porte_cochere", "bay", "lobby", "sunshade", "brise_soleil",
    "balcony", "loggia", "feature_corner", "atrium", "connector", "terrace",
    "plaza", "pergola", "roof_screen", "cornice",
  ];
  const drawn = [];
  for (const kind of kinds) {
    await page.getByLabel("Add a feature").selectOption(kind);
    await settle(page);
    const px = changedPixels(bare, await signature(page));
    drawn.push({ kind, px });
    console.log(`    ${kind.padEnd(15)} ${String(px).padStart(6)} px`);
    await clearAll();
    await settle(page);
  }

  // 5px, not 1px: a settled scene is exactly stable, so anything above a
  // handful of pixels is geometry. A default entry canopy is 24ft on a 400ft
  // wall and legitimately lands near the bottom of this range.
  const missing = drawn.filter((d) => d.px < 5);
  check("every feature kind draws something", missing.length === 0,
    missing.length ? missing.map((d) => `${d.kind} ${d.px}px`).join(", ") : `${drawn.length} kinds`);
  writeFileSync(join(OUT, "draw.json"), JSON.stringify(drawn, null, 2));
}

/**
 * Commit a number into a NumberInput.
 *
 * The obvious route — the prototype value setter plus a synthetic input event,
 * then el.blur() — silently does nothing here, twice over: the element was
 * never focused so blur() is a no-op, and NumberInput only commits its draft
 * on blur. Typing into it and pressing Enter is the path a person takes and
 * the only one that lands.
 */
async function setNumber(locator, value) {
  await locator.fill(String(value));
  await locator.press("Enter");
}

async function finish(browser, errors) {
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ results, errors }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (errors.length) console.log(`errors: ${JSON.stringify(errors, null, 2)}`);
  process.exit(failed.length || errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
