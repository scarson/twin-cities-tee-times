// ABOUTME: Cross-provider TLS diagnostic for CPS Golf 525 investigation.
// ABOUTME: Tests TLS handshake details, HTTP connectivity, and CPS token endpoint from any Node.js environment.

/**
 * Diagnostic script to isolate why CPS Golf returns HTTP 525 from Cloudflare Workers.
 *
 * Tests performed:
 * 1. DNS resolution for CPS Golf hostname
 * 2. Raw TLS handshake with detailed cipher/protocol/cert info
 * 3. HTTPS request to CPS token endpoint (same as our adapter)
 * 4. Comparison against ForeUp (known working) to verify connectivity
 *
 * Run locally:   npx tsx scripts/diag-cps-tls.ts
 * Run on Lambda:  zip and deploy as handler (see exports at bottom)
 */

import * as tls from "tls";
import * as dns from "dns/promises";
import * as https from "https";

const CPS_HOST = "jcgsc5.cps.golf";
const CPS_TOKEN_PATH = "/identityapi/myconnect/token/short";
const FOREUP_HOST = "foreupsoftware.com";
const FOREUP_TEST_PATH = "/index.php/api/booking/times";

// Also test a TC CPS host to see if all CPS subdomains behave the same
const TC_CPS_HOST = "minneapolistheodorewirth.cps.golf";

interface TlsResult {
  host: string;
  connected: boolean;
  protocol: string | null;
  cipher: { name: string; version: string } | null;
  peerCert: {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    subjectAltNames: string;
  } | null;
  error: string | null;
  handshakeTimeMs: number;
}

interface DnsResult {
  host: string;
  addresses: string[];
  error: string | null;
}

interface HttpResult {
  host: string;
  path: string;
  statusCode: number | null;
  statusMessage: string | null;
  headers: Record<string, string | string[] | undefined>;
  bodyPreview: string;
  error: string | null;
  totalTimeMs: number;
}

async function resolveDns(host: string): Promise<DnsResult> {
  try {
    const addresses = await dns.resolve4(host);
    return { host, addresses, error: null };
  } catch (err: unknown) {
    return { host, addresses: [], error: String(err) };
  }
}

function testTls(host: string, port = 443): Promise<TlsResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = tls.connect(
      {
        host,
        port,
        servername: host, // explicit SNI
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
      () => {
        const elapsed = Date.now() - start;
        const cipher = socket.getCipher();
        const cert = socket.getPeerCertificate();
        resolve({
          host,
          connected: true,
          protocol: socket.getProtocol(),
          cipher: cipher ? { name: cipher.name, version: cipher.version } : null,
          peerCert: cert
            ? {
                subject: JSON.stringify(cert.subject),
                issuer: JSON.stringify(cert.issuer),
                validFrom: cert.valid_from,
                validTo: cert.valid_to,
                subjectAltNames: cert.subjectaltname ?? "",
              }
            : null,
          error: null,
          handshakeTimeMs: elapsed,
        });
        socket.end();
      }
    );

    socket.on("error", (err) => {
      resolve({
        host,
        connected: false,
        protocol: null,
        cipher: null,
        peerCert: null,
        error: String(err),
        handshakeTimeMs: Date.now() - start,
      });
    });

    socket.setTimeout(10000, () => {
      socket.destroy(new Error("TLS handshake timeout (10s)"));
    });
  });
}

function testHttp(
  host: string,
  path: string,
  method = "GET",
  body?: string,
  contentType?: string
): Promise<HttpResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const options: https.RequestOptions = {
      hostname: host,
      port: 443,
      path,
      method,
      headers: {
        "User-Agent": "tee-times-diag/1.0",
        ...(contentType && { "Content-Type": contentType }),
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        if (data.length < 500) data += chunk.toString();
      });
      res.on("end", () => {
        resolve({
          host,
          path,
          statusCode: res.statusCode ?? null,
          statusMessage: res.statusMessage ?? null,
          headers: res.headers as Record<string, string | string[] | undefined>,
          bodyPreview: data.substring(0, 500),
          error: null,
          totalTimeMs: Date.now() - start,
        });
      });
    });

    req.on("error", (err) => {
      resolve({
        host,
        path,
        statusCode: null,
        statusMessage: null,
        headers: {},
        bodyPreview: "",
        error: String(err),
        totalTimeMs: Date.now() - start,
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("HTTP request timeout (10s)"));
    });

    if (body) req.write(body);
    req.end();
  });
}

async function runDiagnostics() {
  const results: Record<string, unknown> = {};
  const hosts = [CPS_HOST, TC_CPS_HOST, FOREUP_HOST];

  console.log("=== CPS Golf TLS Diagnostic ===");
  console.log(`Runtime: Node.js ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`OpenSSL: ${process.versions.openssl}`);
  console.log();

  // Phase 1: DNS
  console.log("--- Phase 1: DNS Resolution ---");
  const dnsResults: DnsResult[] = [];
  for (const host of hosts) {
    const result = await resolveDns(host);
    dnsResults.push(result);
    console.log(`  ${host}: ${result.addresses.join(", ") || result.error}`);
  }
  results.dns = dnsResults;

  // Phase 2: TLS Handshake
  console.log("\n--- Phase 2: TLS Handshake ---");
  const tlsResults: TlsResult[] = [];
  for (const host of hosts) {
    const result = await testTls(host);
    tlsResults.push(result);
    if (result.connected) {
      console.log(`  ${host}: OK (${result.handshakeTimeMs}ms)`);
      console.log(`    Protocol: ${result.protocol}`);
      console.log(
        `    Cipher: ${result.cipher?.name} (${result.cipher?.version})`
      );
      console.log(`    Cert issuer: ${result.peerCert?.issuer}`);
      console.log(`    Cert valid: ${result.peerCert?.validFrom} → ${result.peerCert?.validTo}`);
      console.log(`    SANs: ${result.peerCert?.subjectAltNames}`);
    } else {
      console.log(`  ${host}: FAILED (${result.handshakeTimeMs}ms)`);
      console.log(`    Error: ${result.error}`);
    }
  }
  results.tls = tlsResults;

  // Phase 3: HTTP — CPS Token Endpoint
  console.log("\n--- Phase 3: CPS Token Request ---");
  for (const host of [CPS_HOST, TC_CPS_HOST]) {
    const result = await testHttp(
      host,
      CPS_TOKEN_PATH,
      "POST",
      "client_id=onlinereswebshortlived",
      "application/x-www-form-urlencoded"
    );
    console.log(`  ${host}${CPS_TOKEN_PATH}`);
    console.log(`    Status: ${result.statusCode} ${result.statusMessage}`);
    console.log(`    Time: ${result.totalTimeMs}ms`);
    if (result.error) console.log(`    Error: ${result.error}`);
    // Check for interesting response headers
    const interestingHeaders = ["server", "x-powered-by", "set-cookie", "content-type"];
    for (const h of interestingHeaders) {
      if (result.headers[h]) console.log(`    ${h}: ${result.headers[h]}`);
    }
    if (result.statusCode && result.statusCode >= 200 && result.statusCode < 300) {
      // Parse token to confirm it works
      try {
        const parsed = JSON.parse(result.bodyPreview);
        console.log(
          `    Token: ${String(parsed.access_token).substring(0, 20)}...`
        );
      } catch {
        console.log(`    Body: ${result.bodyPreview.substring(0, 100)}`);
      }
    } else {
      console.log(`    Body: ${result.bodyPreview.substring(0, 200)}`);
    }
    (results[`http_cps_${host}`] as unknown) = result;
  }

  // Phase 4: ForeUp control test
  console.log("\n--- Phase 4: ForeUp Control Test ---");
  const foreupResult = await testHttp(
    FOREUP_HOST,
    `${FOREUP_TEST_PATH}?booking_class=default&schedule_id=1470&date=03-13-2026&time=all&holes=all&players=0&specials_only=0&api_key=no_limits`,
    "GET"
  );
  console.log(`  ${FOREUP_HOST}${FOREUP_TEST_PATH}`);
  console.log(
    `    Status: ${foreupResult.statusCode} ${foreupResult.statusMessage}`
  );
  console.log(`    Time: ${foreupResult.totalTimeMs}ms`);
  if (foreupResult.error) console.log(`    Error: ${foreupResult.error}`);
  results.http_foreup = foreupResult;

  // Summary
  console.log("\n=== Summary ===");
  const cpsTls = tlsResults.find((r) => r.host === CPS_HOST);
  const foreupTls = tlsResults.find((r) => r.host === FOREUP_HOST);
  console.log(
    `CPS Golf TLS: ${cpsTls?.connected ? "OK" : "FAILED"} | Protocol: ${cpsTls?.protocol} | Cipher: ${cpsTls?.cipher?.name}`
  );
  console.log(
    `ForeUp TLS:   ${foreupTls?.connected ? "OK" : "FAILED"} | Protocol: ${foreupTls?.protocol} | Cipher: ${foreupTls?.cipher?.name}`
  );

  return results;
}

// Direct execution
runDiagnostics().catch(console.error);

// Lambda handler export
export const handler = async () => {
  const results = await runDiagnostics();
  return {
    statusCode: 200,
    body: JSON.stringify(results, null, 2),
  };
};
