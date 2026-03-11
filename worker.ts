// Custom Cloudflare Worker entry point.
// Wraps OpenNext for HTTP requests + adds scheduled() for cron triggers.

import { runWithCloudflareRequestContext } from "./.open-next/cloudflare/init.js";
import { handler } from "./.open-next/server-functions/default/handler.mjs";
import { runCronPoll } from "./src/lib/cron-handler";

const worker = {
  async fetch(request: Request, env: any, ctx: any) {
    return runWithCloudflareRequestContext(request, env, ctx, async () => {
      return handler(request, env, ctx);
    });
  },

  async scheduled(event: any, env: any, ctx: any) {
    ctx.waitUntil(runCronPoll(env.DB));
  },
};

export default worker;
