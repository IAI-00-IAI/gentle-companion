# architecture-knowledge-bundle

Deep, verifiable architecture documentation of gentle-companion as an OKF bundle, in English
and Spanish, with diagrams and cross-linked pages.

## Specs

- **S1** — The bundle lives in `knowledge/` and conforms to OKF v0.2: every concept has YAML
  frontmatter with at least `type`; `index.md` and `log.md` are reserved and carry no
  frontmatter (the root `index.md` may carry `okf_version: "0.2"`).
- **S2** — Every concept links to related concepts with bundle-absolute markdown links
  (`/architecture/overview.md`). No broken links.
- **S3** — Every concept has a Spanish counterpart in the same directory with the `_es-ES`
  suffix (`overview_es-ES.md`), and the Spanish version links to the Spanish siblings.
- **S4** — Diagrams are Mermaid fenced blocks, which render on GitHub.
- **S5** — Claims are anchored: `path:line` for source, or a named test file/count. No claim
  without an anchor.
- **S6** — The bundle covers: architecture (overview, process model, HTTP surfaces, auth,
  state), subsystems (extension, daemon lifecycle, protocol, bridge, automation, tailcat,
  TLS, assets, UI, tunnel shims), flows (pairing, live session, tunnel fallback), and
  operations (daemon scripts, deployment).
- **S7** — Known debt and unproven paths are documented rather than omitted.
- **S8** — The review is verifiable: the test suites were run and their counts recorded.

## Tasks

| ID | Spec | What | Route | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S2, S4, S5, S6 | Write the English bundle (20 concepts + index + log) | inline | pending |
| T2 | S3 | Write the Spanish counterparts | workers, disjoint surfaces | pending |
| T3 | S1, S2, S3 | Validate: frontmatter, links, parity EN/ES | inline | pending |
| T4 | S8 | Record suite results as evidence | inline | pending |

## Log

**L1** — User request, verbatim:

> cuando acabes de integrar, realiza una revision en profundidad de todo el projecto, y genera documentación detallada de toda la arquitectura, subsitemas, diagramas, flujos,..., de toda la implementación y lo mas completa posible, en inglés y español, con formato OKF y páginas enlazadas de las secciones que desgloses.(repito: revisión verificable y documentada en profundidad)(orquesta y paraleliza todo lo que se pueda)

**L2** — Three read-only explorers mapped `server/src`, `src/` + protocol, and `ui/src` +
`bridge/` in parallel. Their maps are the source for every anchor in the bundle. Explorer 1
reported 182 Rust tests by summing per-file counts; the real `cargo test` run reports
**154**, because the five `*_tests.rs` modules are included in that figure rather than
additional to it. The 154 figure is the one recorded everywhere.

**L3** — Suites run before writing: cargo 154/154 in the default suite, `test:extension`
402/402, `ui:check` clean, `ui/tests/tailcat-tunnel.test.ts` 32 tests, `bridge/http_test.mjs`
42 checks, `bridge/ws_test.mjs` OK.

**L4** — A3 (static client host) was integrated inline after the worker stalled at 777 turns
with a provider error: `tools/publish-client.mjs`, `.github/workflows/pages.yml`,
`BASE_PATH` support in `ui/vite.config.ts`, `docs/static-client-host.md` + `_es-ES.md`,
commit `5b3df02`. Verified: assemble + `--check` over a real build (40.5 MB, all required
files), workflow YAML parses, `ui:check` clean, `test:extension` 402.

**L5** — Debt recorded rather than hidden: orphaned `tailcat serve` children, duplicated
DERP map policy, uploads and blob downloads unsupported over the tunnel, reload off-LAN
impossible without HTTPS + a service worker, and the destructive daemon script paths
unexercised.

**L6** — Bundle delivered: 44 files (20 concepts × 2 languages + index + log), commit
`4999945`. `npm run knowledge:check` reports 0 errors, 0 warnings. Verification found and
fixed three defects the workers' own reports had missed: a translated literal
(`[::1]:puerto`), a missing `:637` anchor, and `tailcat_es-ES.md` stale against the English
page after the mirror correction. All 20 EN/ES pairs now carry byte-identical code anchors.

**L7** — Slice boundary: this round is 4 commits and ~5944 authored lines on
`feat/daemon-tls` since `origin/main` — well past a single reviewable slice. Delivery shape
must be decided at publish time: either chained PRs (TLS surface, static host, knowledge
bundle) or one PR with the knowledge bundle called out as documentation-only.
