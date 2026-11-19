# Accounting and funding dashboard

The money side of Gentle Companion: what the project spends, what the subscription
plan allows, and every funding route worth applying to.

It runs as a small local HTTP server that renders one page of plain HTML with Plotly
charts. No framework, no build step, no authentication middleware — one token, read
from the environment.

## Running it

```bash
export DASHBOARD_TOKEN=some-long-random-value
python3 accounting/web_dashboard.py
# http://127.0.0.1:8799/?token=<the same value>
```

Without the token every request answers 401 and no data is rendered. A missing or
wrong token is logged with its timestamp and path, never the value.

## What it reads

| Source | Purpose |
| --- | --- |
| `~/.gentle-shell/agent/sessions/**/*.jsonl` | Per-message `usage` blocks: tokens and cost |
| `usage.db` | Aggregated consumption per day, model and account |
| The plan's quota endpoint | Allowance used in the current billing cycle |

Nothing here is hand-maintained: the figures come from the session transcripts and the
gateway's own counters, so a dashboard refresh reflects what actually happened.

## What is not published

- `dashboard.token` — the live access token
- `auth_fails.log` — rejected attempts, including client IPs
- `usage.db`, `gateway.env` — operational data and credentials

## The funding map

`mapa_financiacion.md` collects every route considered, with source and date of
consultation, and keeps the discarded ones with the reason. A route rejected today is
often valid six months later, and the reason is the useful part.

Each entry is recorded as a fact with a source, never as a verdict. What to apply to is
a decision for the maintainers.
