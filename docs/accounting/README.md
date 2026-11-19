# Accounting dashboard (static snapshot)

A rendered copy of the project's cost and funding dashboard, published so the community
can read it without running anything.

Open `index.html`. It is self-contained except for Plotly, loaded from its CDN.

## What this snapshot is

A point-in-time capture, not a live view. The quota figures, token counts and costs are
frozen at the moment of capture; the funding map is as current as its last round.

The live dashboard reads session transcripts, a local `usage.db` and the plan's quota
endpoint, and needs an access token. None of that works without the author's own data, so
this page is the version worth publishing: same layout, same numbers, no access.

## Updating it

`accounting/web_dashboard.py` renders the page. Capture a new snapshot with:

```bash
curl -s "http://127.0.0.1:8799/?token=$DASHBOARD_TOKEN" > docs/accounting/index.html
```

The token never appears in the rendered HTML — verified on the committed copy.

## A note on the inventory

The hardware table names the maintainer's own machines, with their measured CPU, GPU,
memory and disk usage. It is published deliberately: it makes the cost figures auditable,
and it is the kind of transparency this project asks of others.
