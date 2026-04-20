// ABOUTME: One-off research probe — does a booking SPA honor URL-based date params?
// ABOUTME: Takes URL cases via argv (--url "URL|LABEL") and prints the rendered state post-load.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const cases = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--case" && args[i + 1]) {
    const [url, label] = args[i + 1].split("||");
    cases.push({ url, label: label || url });
    i++;
  }
}

if (cases.length === 0) {
  console.error("Usage: node probe-deeplink.mjs --case 'URL||LABEL' [--case 'URL2||LABEL2' ...]");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
});

for (const c of cases) {
  const page = await ctx.newPage();
  try {
    await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    const info = await page.evaluate(() => {
      const visibleHeader = Array.from(
        document.querySelectorAll("h1, h2, h3, .date-selector, .booking-header, .day-header, [class*='date']")
      )
        .map((el) => el.textContent?.trim())
        .filter((t) => t && t.length < 150)
        .slice(0, 10);
      const defaultFilterMatch =
        (document.documentElement.outerHTML.match(/DEFAULT_FILTER\s*=\s*(\{[^}]+\})/) || [])[1] || null;
      const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
        name: i.name,
        type: i.type,
        value: i.value,
      }));
      const teeTimeCount = document.querySelectorAll("[class*='teetime'], [class*='tee-time'], [class*='TeeTime'], [class*='time-row'], [class*='timeslot']").length;
      return {
        url: window.location.href,
        title: document.title,
        defaultFilter: defaultFilterMatch,
        visibleHeader,
        dateInputs: inputs.filter((i) => /date/i.test(i.name) || i.type === "date"),
        teeTimeCount,
      };
    });
    console.log("\n=== CASE:", c.label, "===");
    console.log("Input URL:", c.url);
    console.log("URL after load:", info.url);
    console.log("Title:", info.title);
    console.log("DEFAULT_FILTER:", info.defaultFilter);
    console.log("Date inputs:", JSON.stringify(info.dateInputs));
    console.log("Visible headers:", info.visibleHeader);
    console.log("Tee-time-like elements:", info.teeTimeCount);
  } catch (e) {
    console.log("\nERROR for", c.label, ":", e.message);
  } finally {
    await page.close();
  }
}

await browser.close();
