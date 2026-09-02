#!/usr/bin/env node
/**
 * Programme check.
 *
 * Drives the specific thing that was asked for: put an ambulatory surgery
 * centre inside a medical office building, and control the grossing factor.
 *
 * Three things have to be simultaneously true, and only the browser can say
 * so. The programme has to appear, the drawn box has to grow to hold it, and
 * the money has to move. A programme that changes the panel and not the
 * estimate is this project's signature defect wearing a new coat.
 *
 * Usage:
 *   npm run preview            # in one shell
 *   node tools/program-check.mjs [url]
 */

import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:4173/";
const LAUNCH = {
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ok " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

const kpis = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".dock .kpi")].map((el) => [
        el.querySelector(".label")?.textContent ?? "",
        el.querySelector(".kpi-value")?.textContent ?? "",
      ]),
    ),
  );

const scale = (s) => (/M/.test(s) ? 1e6 : /K/.test(s) ? 1e3 : 1);
const value = (s) => Number(String(s).replace(/[^0-9.]/g, "")) * scale(s);

/** The Program tab's own text, for reading the panel's reconciliation lines. */
/** Wait out the debounced recompute so a KPI is the new number, not the old one. */
const settle = async (page) => {
  await page.waitForFunction(
    () => ![...document.querySelectorAll(".dock .label")].some((el) => el.textContent === "Pricing"),
    null,
    { timeout: 20000 },
  ).catch(() => {});
  await page.waitForTimeout(400);
};

const panelText = (page) =>
  page.evaluate(() => document.querySelector(".inspector")?.textContent ?? document.body.textContent ?? "");

async function main() {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });

  await page.addInitScript(() => localStorage.clear());
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);

  // Healthcare, medical office building.
  await page.getByLabel("Market").selectOption("healthcare");
  await page.waitForTimeout(900);
  await page.getByLabel("Building type").selectOption("hc_mob");
  await page.waitForTimeout(1600);

  await page.getByRole("tab", { name: "Program" }).click();
  await page.waitForTimeout(600);

  const drivers = page.locator(".section-head", { hasText: "Program drivers" });
  check("the MOB opens with a driver chain", (await drivers.count()) > 0);

  await settle(page);
  const before = await kpis(page);
  const beforeCost = value(before["Project total"] ?? "0");
  const beforeGsf = value(before["Gross area"] ?? "0");
  check("baseline reads a cost and an area", beforeCost > 0 && beforeGsf > 0,
    `$${beforeCost.toLocaleString()} · ${beforeGsf.toLocaleString()} GSF`);

  // Add the surgery centre.
  await page.getByLabel("Add a programme").selectOption("hc_asc");
  await page.waitForTimeout(1800);

  const text = await panelText(page);
  check("the surgery centre appears as its own programme", text.includes("Ambulatory Surgery Center"));
  check("the panel switches to the combined heading", text.includes("Programmes"));
  check("it reports the programme against the drawn box", text.includes("Programme vs. drawn box"));

  const fit = page.getByRole("button", { name: "Fit the box" });
  check("it offers to fit the box", (await fit.count()) > 0);

  await settle(page);
  const midCost = value((await kpis(page))["Project total"] ?? "0");
  check("the blended rates move the estimate before any resize", midCost !== beforeCost,
    `$${beforeCost.toLocaleString()} → $${midCost.toLocaleString()}`);

  if (await fit.count()) {
    await fit.first().click();
    await page.waitForTimeout(2200);
  }

  await settle(page);
  const after = await kpis(page);
  const afterCost = value(after["Project total"] ?? "0");
  const afterGsf = value(after["Gross area"] ?? "0");
  check("the box grows to hold the surgery centre", afterGsf > beforeGsf * 1.05,
    `${beforeGsf.toLocaleString()} → ${afterGsf.toLocaleString()} GSF`);
  check("the estimate follows the programme", afterCost > beforeCost * 1.05,
    `$${beforeCost.toLocaleString()} → $${afterCost.toLocaleString()}`);
  check("fitting closes the gap it was reporting",
    !(await panelText(page)).includes("prices the box, not the programme"));

  // Remove it again and confirm nothing is stranded.
  const remove = page.getByRole("button", { name: "Remove" });
  if ((await remove.count()) > 1) {
    await remove.nth(1).click();
    await page.waitForTimeout(1500);
    check("removing the programme takes it out of the building",
      (await page.getByRole("button", { name: "Remove" }).count()) === 0);
    await page.getByLabel("Add a programme").selectOption("hc_asc");
    await page.waitForTimeout(1500);
  }

  // The grossing factor.
  const massing = page.locator(".section-head", { hasText: "Massing" });
  if (await massing.count()) await massing.first().click();
  await page.waitForTimeout(500);

  const grossing = page.getByLabel("Grossing (gross / net)");
  check("the grossing factor is editable", (await grossing.count()) > 0);
  if (await grossing.count()) {
    const was = await grossing.first().inputValue();
    await grossing.first().fill("1.85");
    await grossing.first().press("Enter");
    await page.waitForTimeout(1500);
    const t = await panelText(page);
    check("the override sticks", (await grossing.first().inputValue()) === "1.85", `was ${was}`);
    check("it announces itself as an override", t.includes("Overridden — the type runs"));
    check("it offers a way back to the type default",
      (await page.getByRole("button", { name: "Reset grossing" }).count()) > 0);

    await page.getByRole("button", { name: "Reset grossing" }).first().click();
    await page.waitForTimeout(1200);
    check("resetting restores the type's own factor",
      (await grossing.first().inputValue()) === was, `back to ${was}`);
  }

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
