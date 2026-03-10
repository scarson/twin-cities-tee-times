// ABOUTME: Cloudflare Workers environment bindings declaration.
// ABOUTME: Augments CloudflareEnv with DB, secrets, and OAuth credentials.
interface CloudflareEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
}
