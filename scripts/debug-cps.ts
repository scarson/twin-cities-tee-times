// ABOUTME: Diagnostic script to test CPS Golf adapter against live API.
// ABOUTME: Usage: npx tsx scripts/debug-cps.ts [date]

const subdomain = "jcgsc5";
const courseIds = "6";
const websiteId = "94ce5060-0b39-444f-2756-08d8d81fed21";
const siteId = "16";
const terminalId = "3";
const timezone = "America/Los_Angeles";

function getTimezoneOffset(tz: string): number {
  const now = new Date();
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return (utc.getTime() - local.getTime()) / 60000;
}

function formatCpsDate(isoDate: string, tz: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  return d
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
      timeZone: tz,
    })
    .replace(/,/g, "");
}

async function main() {
  const date = process.argv[2] ?? "2026-03-13";
  const searchDate = formatCpsDate(date, timezone);
  console.log(`\n=== CPS Golf Debug: ${subdomain} ===`);
  console.log(`Date: ${date} → searchDate: "${searchDate}"`);
  console.log(`Timezone offset: ${getTimezoneOffset(timezone)}`);

  // Step 1: Get token
  console.log("\n--- Step 1: Token ---");
  const tokenUrl = `https://${subdomain}.cps.golf/identityapi/myconnect/token/short`;
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "client_id=onlinereswebshortlived",
  });
  console.log(`Token response: ${tokenRes.status} ${tokenRes.statusText}`);
  if (!tokenRes.ok) {
    console.log("Body:", await tokenRes.text());
    return;
  }
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  console.log(`Token: ${token.substring(0, 20)}...`);

  // Step 2: Register transaction
  console.log("\n--- Step 2: Register Transaction ---");
  const baseUrl = `https://${subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation`;
  const transactionId = crypto.randomUUID();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "client-id": "onlineresweb",
    "x-websiteid": websiteId,
    "x-siteid": siteId,
    "x-terminalid": terminalId,
    "x-componentid": "1",
    "x-moduleid": "7",
    "x-productid": "1",
    "x-ismobile": "false",
    "x-timezone-offset": String(getTimezoneOffset(timezone)),
    "x-timezoneid": timezone,
  };

  const regRes = await fetch(`${baseUrl}/RegisterTransactionId`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "x-requestid": crypto.randomUUID(),
    },
    body: JSON.stringify({ transactionId }),
  });
  console.log(`Registration response: ${regRes.status} ${regRes.statusText}`);
  const regResult = await regRes.json();
  console.log(`Registration result:`, regResult);

  // Step 3: Fetch tee times
  console.log("\n--- Step 3: Fetch Tee Times ---");
  const params = new URLSearchParams({
    searchDate,
    courseIds,
    transactionId,
    holes: "0",
    numberOfPlayer: "0",
    searchTimeType: "0",
    teeOffTimeMin: "0",
    teeOffTimeMax: "23",
    isChangeTeeOffTime: "true",
    teeSheetSearchView: "5",
    classCode: "R",
    defaultOnlineRate: "N",
    isUseCapacityPricing: "false",
    memberStoreId: "1",
    searchType: "1",
  });

  const teeTimesUrl = `${baseUrl}/TeeTimes?${params}`;
  console.log(`URL: ${teeTimesUrl}`);

  const ttRes = await fetch(teeTimesUrl, {
    headers: { ...headers, "x-requestid": crypto.randomUUID() },
  });
  console.log(`Tee times response: ${ttRes.status} ${ttRes.statusText}`);

  const ttData = await ttRes.json();
  console.log(`\nFull response:`);
  console.log(JSON.stringify(ttData, null, 2));

  if (Array.isArray(ttData.content)) {
    console.log(`\n=== ${ttData.content.length} tee times found ===`);
    for (const tt of ttData.content) {
      console.log(`  ${tt.startTime} | ${tt.holes}h | ${tt.maxPlayer} slots | ${JSON.stringify(tt.shItemPrices?.map((p: { shItemCode: string; price: number }) => `${p.shItemCode}: $${p.price}`))}`);
    }
  } else {
    console.log("\n=== content is NOT an array ===");
    console.log("content:", ttData.content);
  }
}

main().catch(console.error);
