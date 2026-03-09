// Augment the global CloudflareEnv interface with our D1 binding
interface CloudflareEnv {
  DB: D1Database;
}
