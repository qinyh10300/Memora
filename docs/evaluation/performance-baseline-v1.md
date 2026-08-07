# Performance baseline v1

Measured on 2026-08-07 against the local production Compose deployment at `http://localhost:19082`.
The database contained 72 memories across the deployment; the measured personal account exposed three
workspaces. Docker Desktop reported 7.737 GiB available memory. Raw, machine-generated reports live in
the ignored `artifacts/` directory and can be regenerated with `make performance-baseline`.

## Release budgets

These are regression gates for the current single-user/small-team stage, not internet SLA claims:

| Surface | Budget |
| --- | ---: |
| Local authenticated API p95 | less than 100 ms |
| End-to-end hybrid search p95, including provider embedding | less than 2,500 ms |
| Desktop/mobile LCP | less than 2,500 ms |
| Desktop/mobile CLS | less than 0.1 |
| Initial transferred resources | less than 350 KiB |
| Initial JavaScript transfer | less than 300 KiB |
| Idle Compose memory, all five long-running services | less than 512 MiB |
| Idle memory, any one service | less than 256 MiB |

## API results

Local endpoints used 30 measured samples after three warmups. Hybrid search used five samples after one
warmup to respect the user-facing AI rate limiter.

| Operation | p50 | p95 | max |
| --- | ---: | ---: | ---: |
| Web health | 1.84 ms | 2.51 ms | 2.51 ms |
| API health | 1.43 ms | 1.86 ms | 1.96 ms |
| Workspace list | 2.97 ms | 3.78 ms | 3.94 ms |
| Memory list | 4.35 ms | 5.08 ms | 5.38 ms |
| Hybrid search | 1,545.57 ms | 1,929.81 ms | 1,929.81 ms |

Hybrid search is dominated by the external embedding round trip. The PostgreSQL-only quality runner is
separately gated by `make eval-retrieval-postgres`; this avoids attributing provider latency to the
database ranking path.

## Browser results

Chromium ran with a direct local connection. Each navigation waited for network idle plus a 500 ms
stabilization period; `wall_ms` therefore includes that intentional wait and is not a paint metric.

| Scenario | TTFB | load | LCP | CLS | transfer | JavaScript |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop public, 1440x900 | 23.8 ms | 89.3 ms | 132 ms | 0 | 270,673 B | 234,486 B |
| Desktop app, 1440x900 | 5.0 ms | 47.7 ms | 108 ms | 0 | 280,349 B | 234,486 B |
| Mobile public, 390x844 | 10.4 ms | 60.8 ms | 104 ms | 0 | 277,147 B | 234,486 B |
| Mobile app, 390x844 | 3.9 ms | 47.0 ms | 136 ms | 0 | 280,349 B | 234,486 B |

All four scenarios stayed within the release budgets. These local LCP values are a regression baseline;
they do not replace throttled field telemetry on a public deployment.

## Resource snapshot and hard bounds

The post-sample idle snapshot used approximately 273 MiB total: API 79.25 MiB, database 59.11 MiB,
worker 70.08 MiB, Web 47.36 MiB, and proxy 17.2 MiB. No service exceeded 80 MiB.

Application-level work is bounded independently of host capacity:

- Images are limited to 8 MiB and PDFs to 20 MiB.
- Search queries are limited to 500 characters and responses to 200 records; reranking considers at most
  20 authorized candidates with a 3 second timeout.
- Chat/provider calls default to 60 seconds, web search to 90 seconds, and chat output to 2,400 tokens.
- A PDF is limited to 100 pages and 500,000 extracted characters, with a 120 second parse timeout, three
  attempts, one concurrent parse, and 30 seconds of OCR per page.
- Document context is limited to 16 chunks/12,000 characters and a saved memory to 24 document
  citations.

Compose does not impose per-container CPU or memory quotas in v0.1. The worker concurrency and parser
limits are the primary protection for this single-server stage. Add host-level quotas before opening a
multi-tenant public service and rerun this baseline under representative OCR load.
