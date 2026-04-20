// ABOUTME: Discover CPS Golf platformConfig by intercepting API calls from onlineresweb.
// ABOUTME: Loads {subdomain}.cps.golf/onlineresweb/search-teetime in Playwright and captures headers/params.
import { chromium } from "playwright";

const subdomains = process.argv.slice(2);
if (subdomains.length === 0) {
  console.error("Usage: node discover-cps.mjs <subdomain> [<subdomain> ...]");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
});

for (const sub of subdomains) {
  const page = await ctx.newPage();
  const captured = { apiCalls: [], headers: {} };
  page.on("request", (req) => {
    let parsed;
    try {
      parsed = new URL(req.url());
    } catch {
      return;
    }
    // Strict host match on the expected subdomain, plus path prefix check.
    if (parsed.hostname === `${sub}.cps.golf` && parsed.pathname.startsWith("/onlineres")) {
      captured.apiCalls.push({ method: req.method(), url: req.url() });
      const h = req.headers();
      for (const key of ["x-siteid", "x-terminalid", "x-apikey", "authorization"]) {
        if (h[key] && !captured.headers[key]) captured.headers[key] = h[key];
      }
    }
  });
  page.on("response", async (res) => {
    const u = res.url();
    if (u.includes("GetAllOptions") || u.includes("/website/") || u.includes("getwebsite") || u.includes("courseInfo") || u.includes("getcoursesinfo")) {
      try {
        const ct = res.headers()["content-type"] || "";
        if (ct.includes("json")) {
          const body = await res.json().catch(() => null);
          if (body) captured.apiCalls.push({ url: u, responseBody: body });
        }
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
    console.log("headers:", JSON.stringify(captured.headers));
    for (const c of captured.apiCalls) {
      if (c.responseBody) {
        console.log("  RESPONSE:", c.url.slice(0, 100));
        console.log("    body keys:", Object.keys(c.responseBody).slice(0, 10).join(", "));
        if (Array.isArray(c.responseBody)) {
          console.log("    array length:", c.responseBody.length);
          if (c.responseBody.length > 0) console.log("    [0]:", JSON.stringify(c.responseBody[0]).slice(0, 300));
        } else {
          console.log("    body:", JSON.stringify(c.responseBody).slice(0, 400));
        }
      } else {
        console.log(" ", c.method, c.url.slice(0, 100));
      }
    }
  } catch (e) {
    console.log("ERROR:", e.message);
  } finally {
    await page.close();
  }
}

await browser.close();
