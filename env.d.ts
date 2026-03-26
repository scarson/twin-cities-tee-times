// ABOUTME: Cloudflare Workers environment bindings declaration.
// ABOUTME: Augments CloudflareEnv with DB, secrets, and OAuth credentials.
interface CloudflareEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  FETCH_PROXY_URL?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  CPS_V4_API_KEY?: string;
}
