// ABOUTME: AWS Lambda diagnostic for CPS Golf 525 investigation.
// ABOUTME: Tests CPS token endpoint from non-Cloudflare infrastructure.

/**
 * AWS Lambda handler for CPS Golf connectivity test.
 *
 * Deploy as a Lambda function (Node.js 22 runtime) to test
 * CPS Golf connectivity from outside Cloudflare infrastructure.
 *
 * Quick deploy with AWS CLI:
 *   zip diag-cps-lambda.zip diag-cps-lambda.mjs
 *   aws lambda create-function \
 *     --function-name cps-diag \
 *     --runtime nodejs22.x \
 *     --handler diag-cps-lambda.handler \
 *     --role <your-lambda-execution-role-arn> \
 *     --zip-file fileb://diag-cps-lambda.zip \
 *     --timeout 30
 *   aws lambda invoke --function-name cps-diag output.json && cat output.json
 *
 * Or create a function URL for browser access:
 *   aws lambda create-function-url-config \
 *     --function-name cps-diag \
 *     --auth-type NONE
 */

const CPS_HOSTS = [
  { name: "CPS Golf SD (jcgsc5)", host: "jcgsc5.cps.golf" },
  { name: "CPS Golf TC (T. Wirth)", host: "minneapolistheodorewirth.cps.golf" },
  { name: "CPS Golf TC (Phalen)", host: "phalen.cps.golf" },
];

const TOKEN_PATH = "/identityapi/myconnect/token/short";

async function testCpsToken(name, host) {
  const url = `https://${host}${TOKEN_PATH}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "client_id=onlinereswebshortlived",
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    return {
      name,
      host,
      url,
      status: res.status,
      statusText: res.statusText,
      bodyPreview: body.substring(0, 300),
      error: null,
      timeMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      host,
      url,
      status: null,
      statusText: null,
      bodyPreview: "",
      error: String(err),
      timeMs: Date.now() - start,
    };
  }
}

async function testForeup() {
  const url = "https://foreupsoftware.com/index.php/api/booking/times?booking_class=default&schedule_id=1470&date=03-13-2026&time=all&holes=all&players=0&specials_only=0&api_key=no_limits";
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return {
      name: "ForeUp (control)",
      url,
      status: res.status,
      error: null,
      timeMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "ForeUp (control)",
      url,
      status: null,
      error: String(err),
      timeMs: Date.now() - start,
    };
  }
}

export const handler = async (event) => {
  const results = [];

  for (const { name, host } of CPS_HOSTS) {
    results.push(await testCpsToken(name, host));
  }
  results.push(await testForeup());

  const output = {
    diagnostic: "CPS Golf 525 Investigation - AWS Lambda",
    timestamp: new Date().toISOString(),
    runtime: `Node.js ${process.version}`,
    region: process.env.AWS_REGION ?? "local",
    results,
    summary: {
      cpsWorking: results.filter((r) => r.name?.includes("CPS")).some((r) => r.status === 200),
      foreupWorking: results.filter((r) => r.name?.includes("ForeUp")).some((r) => r.status === 200),
    },
  };

  // If invoked via function URL, return HTTP response
  if (event?.requestContext?.http) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(output, null, 2),
    };
  }

  return output;
};

// Also support direct execution: node diag-cps-lambda.mjs
if (typeof process !== "undefined" && process.argv[1]?.endsWith("diag-cps-lambda.mjs")) {
  handler({}).then((r) => console.log(JSON.stringify(r, null, 2)));
}
