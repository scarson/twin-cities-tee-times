// ABOUTME: Discover TeeItUp facility IDs by loading booking pages in Playwright.
// ABOUTME: Intercepts outbound API calls to phx-api-be-east-1b.kenna.io and extracts facilityIds.
import { chromium } from "playwright";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("Usage: node discover-teeitup.mjs <booking-url> [<booking-url> ...]");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
});

for (const url of urls) {
  const page = await ctx.newPage();
  const apiCalls = [];
  const headers = {};
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("kenna.io") || u.includes("api-be")) {
      apiCalls.push({ method: req.method(), url: u });
      const h = req.headers();
      if (h["x-be-alias"]) headers["x-be-alias"] = h["x-be-alias"];
    }
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    console.log("\n=== ", url, " ===");
    console.log("x-be-alias:", headers["x-be-alias"]);
    // Print unique API URLs (stripped of query params for readability, then with params)
    const seen = new Set();
    for (const c of apiCalls) {
      const key = c.url.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(" ", c.method, c.url);
    }
  } catch (e) {
    console.log("ERROR for", url, ":", e.message);
  } finally {
    await page.close();
  }
}

await browser.close();
