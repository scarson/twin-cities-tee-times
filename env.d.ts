// Augment the global CloudflareEnv interface with our D1 binding
interface CloudflareEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
}
