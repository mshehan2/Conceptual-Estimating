#!/usr/bin/env node
/**
 * Visual check.
 *
 * Drives the running app in a real browser, exercises the render paths, and
 * saves what came out. Unit tests cannot see any of this: every render defect
 * in this project so far — shadows that never drew, windows bunched into the
 * middle of an elevation, a sky that rendered flat, depth measured over the
 * ground plane, edge detection firing along a receding surface, instanced
 * entourage missing from a pass — was invisible from the code and obvious the
 * moment someone looked at the picture.
 *
 * Usage:
 *   npm run preview            # in one shell
 *   node tools/visual-check.mjs [outputDir] [url]
 *
 * Writes numbered screenshots and each AI conditioning pass, then prints a
 * summary. Look at the images; that is the point.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "visual-check";
const URL = process.argv[3] ?? "http://localhost:4173/";

// The sandboxed browser this runs in has no GPU, so software rendering is the
// realistic worst case — which is exactly the case worth measuring.
const LAUNCH = {
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
};

const CAMERAS = ["Aerial", "Approach", "Street", "Corner"];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });

  const timings = {};
  const time = async (label, fn) => {
    const started = Date.now();
    await fn();
    timings[label] = `${((Date.now() - started) / 1000).toFixed(1)}s`;
  };

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(OUT, "01-default.png") });

  // Keep sample counts low: this is a correctness check, not a beauty contest.
  // Sliders are addressed by name, never by position: the quality control lives
  // in a collapsed section, so "the last range input" is the exposure slider,
  // and setting that to 24 pins exposure at its ceiling and blows out every
  // screenshot the run then takes.
  await page.getByRole("tab", { name: "Render" }).click();
  await page.waitForTimeout(300);
  await page.locator(".section-head", { hasText: "Quality" }).click();
  await page.waitForTimeout(300);
  await setSlider(page, "Viewport samples", 24);

  for (const [i, camera] of CAMERAS.entries()) {
    await page.getByRole("button", { name: camera, exact: true }).click();
    await page.waitForTimeout(7000);
    await page.screenshot({ path: join(OUT, `0${i + 2}-${camera.toLowerCase()}.png`) });
  }

  // Conditioning passes, saved individually so each can be judged on its own.
  await time("passes", async () => {
    await page.getByRole("tab", { name: "Photoreal" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Capture passes" }).click();
    await waitFor(page, () => page.locator(".section-head", { hasText: "Conditioning passes" }).count());
  });

  await page.locator(".section-head", { hasText: "Conditioning passes" }).click();
  await page.waitForTimeout(600);
  const sources = await page.locator("figure img").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  const labels = await page.locator("figure figcaption").allInnerTexts();
  sources.forEach((src, i) => {
    if (!src?.includes(",")) return;
    writeFileSync(join(OUT, `pass-${(labels[i] ?? i).toLowerCase()}.png`), Buffer.from(src.split(",")[1], "base64"));
  });

  // A presentation sheet, end to end.
  let sheetLayout = null;
  await time("sheet", async () => {
    await page.getByRole("tab", { name: "Sheets" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Build sheets" }).click();
    await waitFor(page, () => page.locator(".sheet").count(), 30);
  });

  if (await page.locator(".sheet").count()) {
    await page.locator(".sheet").first().screenshot({ path: join(OUT, "sheet-concept.png"), timeout: 60_000 });
    sheetLayout = await page.locator(".sheet").first().evaluate((el) => {
      const foot = el.querySelector(".sheet-foot");
      return {
        rendered: Math.round(el.scrollHeight),
        // The sheet is authored at a fixed 17x11 at 96dpi. If content pushes it
        // past that, the footer walks off the printed page.
        designed: 1056,
        overflowing: el.scrollHeight > 1060,
        footerPresent: Boolean(foot && foot.textContent.trim().length > 40),
      };
    });
  }

  // Read back the settings actually in effect, so a run that silently drove a
  // control to its limit is visible in the report rather than only in the image.
  const settings = await page.evaluate(() => {
    const read = (label) => {
      const el = document.querySelector(`input[aria-label="${label}"]`);
      return el ? Number(el.value) : null;
    };
    return { exposure: read("Exposure"), samples: read("Viewport samples"), hour: read("Hour of day") };
  }).catch(() => null);

  const report = {
    passes: labels,
    timings,
    sheetLayout,
    settings,
    errors: [...new Set(errors)].slice(0, 10),
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();

  const failed =
    labels.length < 4 || !sheetLayout?.footerPresent || sheetLayout?.overflowing || report.errors.length > 0;
  process.exit(failed ? 1 : 0);
}

/**
 * Set a labelled range input.
 *
 * Assigning `el.value` directly is not enough for a controlled React input:
 * React keeps its own value tracker, sees no change against it, and swallows
 * the event, so the control silently keeps its old value. Going through the
 * prototype's native setter updates the tracker too.
 *
 * Verified afterwards rather than assumed — a slider that quietly refuses to
 * move is exactly the failure this tool exists to catch, and it is no use if
 * the tool itself cannot tell.
 */
async function setSlider(page, label, value) {
  const slider = page.getByLabel(label);
  await slider.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

  const applied = Number(await slider.inputValue());
  if (applied !== value) {
    throw new Error(`Slider "${label}" would not accept ${value} — it reads ${applied}`);
  }
}

/** Poll until a count goes non-zero, so slow software rendering is tolerated. */
async function waitFor(page, count, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if (await count()) return true;
    await page.waitForTimeout(4000);
  }
  return false;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
