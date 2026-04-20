// ABOUTME: Load Chronogolf city/state listing pages and capture the clubs API call.
// ABOUTME: Output: array of { slug, name, city } entries.
import { chromium } from "playwright";

const urls = [
  "https://www.chronogolf.com/clubs/Minneapolis--Minnesota--United-States",
  "https://www.chronogolf.com/clubs/Saint-Paul--Minnesota--United-States",
  "https://www.chronogolf.com/clubs/Bloomington--Minnesota--United-States",
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
});

const allClubs = new Map();

for (const url of urls) {
  const page = await ctx.newPage();
  const apiResponses = [];
  page.on("response", async (res) => {
    try {
      const u = res.url();
      if (u.includes("/marketplace") && (u.includes("clubs") || u.includes("search"))) {
        const ct = res.headers()["content-type"] || "";
        if (ct.includes("json")) {
          const body = await res.json().catch(() => null);
          if (body) apiResponses.push({ url: u, body });
        }
      }
    } catch {}
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000);
    // Scroll to trigger lazy-load
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    console.log("\n===", url, "===");
    console.log("API calls captured:", apiResponses.length);
    for (const resp of apiResponses) {
      console.log("  URL:", resp.url.slice(0, 120));
      const clubs = resp.body?.clubs || resp.body?.results || resp.body;
      if (Array.isArray(clubs)) {
        for (const c of clubs) {
          if (c.slug) allClubs.set(c.slug, { slug: c.slug, name: c.name, city: c.city || c.address?.city, province: c.province || c.address?.province });
        }
      }
    }
  } catch (e) {
    console.log("ERROR:", e.message);
  } finally {
    await page.close();
  }
}

await browser.close();

console.log("\n=== All unique slugs found ===");
const sorted = Array.from(allClubs.values()).sort((a, b) => (a.slug || "").localeCompare(b.slug || ""));
for (const c of sorted) console.log("  ", c.slug, "|", c.city, "|", c.name);
console.log("Total unique:", allClubs.size);
