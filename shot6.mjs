import { chromium } from "playwright";
const outDir = process.argv[2];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
await page.getByRole("tab", { name: "Render" }).click();
await page.waitForTimeout(300);
const q = page.locator('input[type="range"]').last();
await q.evaluate((el) => { el.value = "16"; el.dispatchEvent(new Event("input", { bubbles: true })); });
await page.waitForTimeout(500);
await page.getByRole("tab", { name: "Sheets" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Build sheets" }).click();
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(5000);
  const n = await page.locator(".sheet").count();
  if (n) break;
  const label = await page.getByRole("button", { name: /Build sheets|Framing|Rendering/ }).innerText().catch(() => "?");
  console.log(`  t+${(i+1)*5}s: ${label}`);
}
const sheets = await page.locator(".sheet").count();
console.log("sheets rendered:", sheets);
if (sheets) await page.locator(".sheet").first().screenshot({ path: `${outDir}/sheet-0.png`, timeout: 60000 });
console.log("ERRORS:", JSON.stringify(errs.slice(0,5)));
await browser.close();
