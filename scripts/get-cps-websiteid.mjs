// ABOUTME: Extract the webSiteId + course list from CPS Golf's GetAllOptions response.
// ABOUTME: Uses Playwright because the endpoint requires an OAuth bearer the SPA obtains at load.
import { chromium } from "playwright";

const subdomains = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0",
});

for (const sub of subdomains) {
  const page = await ctx.newPage();
  const finds = {};
  page.on("response", async (res) => {
    const u = res.url();
    if (u.includes("GetAllOptions")) {
      try {
        const body = await res.json();
        finds.webSiteId = body.webSiteId;
        finds.courseOptions = body.courseOptions;
      } catch {}
    }
    if (u.includes("OnlineCourses")) {
      try {
        finds.onlineCourses = await res.json();
      } catch {}
    }
  });
  try {
    await page.goto(`https://${sub}.cps.golf/onlineresweb/search-teetime`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(7000);
    console.log(`\n=== ${sub}.cps.golf ===`);
    console.log("webSiteId:", finds.webSiteId);
    console.log("courseOptions:", JSON.stringify(finds.courseOptions, null, 2));
    console.log("onlineCourses:", JSON.stringify(finds.onlineCourses, null, 2));
  } catch (e) {
    console.log("ERROR:", e.message);
  } finally {
    await page.close();
  }
}

await browser.close();
