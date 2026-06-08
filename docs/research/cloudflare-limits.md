# Cloudflare Workers Paid Plan Limits

**Plan:** Workers Paid ($5/month)
**Updated:** 2026-03-29

## Included Monthly Usage

| Resource | Included | Overage |
|----------|----------|---------|
| Workers requests | 10M/month | $0.30/million |
| CPU time | 30s per request, 30M ms/month | — |
| D1 rows read | 25B/month | $0.001/million |
| D1 rows written | 50M/month | $0.001/million |
| D1 storage | 5 GB | — |
| KV reads | 10M/month | $0.50/million |
| KV writes | 1M/month | $0.50/million |
| Durable Objects requests | 1M/month | $0.15/million |
| Durable Objects storage | 1 GB | — |
| Workers AI | 10K/day | varies by model |
| Queues | 1M/month | $0.40/million |
| Workers Builds slots | 6 concurrent | — |
| Workers Builds minutes | 6,000/month | $0.005/minute |
| Workers Logs events | 20M | — |
| Workers Logs retention | 7 days | — |
| Vectorize queried dimensions | 50M/month | $0.01/million |
| Vectorize stored dimensions | 10M | — |
| Hyperdrive | Unlimited daily queries | — |

## Key Limit Changes from Free Tier

| Limit | Free | Paid |
|-------|------|------|
| Subrequests per invocation | 50 | 10,000 (configurable up to 10M) |
| CPU time per request | 10ms | 30s |
| D1 rows read | 5M/day | 25B/month |
| D1 storage | 5 GB | 5 GB |
| Workers requests | 100K/day | 10M/month |

## Subrequest Configuration

The paid plan default is 10,000 subrequests per invocation. This can be increased up to 10M in wrangler.jsonc:

```jsonc
{
  "limits": {
    "subrequests": 50000
  }
}
```

Subrequests (outbound fetches from Workers) are free — Cloudflare only bills for inbound requests.
