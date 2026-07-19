import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "path";

// Smoke tests run inside the Workers runtime because that is where the cron
// poller runs. Several booking CDNs admit or refuse a client by its TLS
// fingerprint, so the runtime a request originates from decides whether it
// gets real data: Chronogolf answers workerd with 200 and Node's undici with
// 403 from the same IP, same URL, same headers. Running these from Node would
// test a transport no production poll uses.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    globals: true,
    include: ["src/**/*.smoke.test.{ts,tsx}"],
    testTimeout: 30000,
    // Serial: concurrent files would multiply request rate against shared
    // upstream limits (Chronogolf blocks for 60s past roughly 20 req/min per IP).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
