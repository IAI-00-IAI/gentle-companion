# Integrate pi-companion v0.4.2 into Gentle Companion

Feature: `upstream-v0.4.2`. Merge `upstream/main` from `v0.4.2` into the Gentle Companion fork while preserving Gentle Shell identity, bilingual UI, design decisions, and `gentle-companion-server` release artifacts.

## Specs

1. `S1` — Integrate the upstream companion bridge functionality from `pi-companion` `v0.4.0` through `v0.4.2`, including localhost server bridges, agent-mentioned file previews, lease renewal/revocation, fullscreen previews, embedding fallback, and local file link handling.
2. `S2` — Preserve the Gentle Companion identity: user-facing text, UI copy, i18n keys, release artifacts, and documentation must remain Gentle Companion, not `Pi Companion` or generic `Pi`.
3. `S3` — Preserve existing Gentle Companion UI design: theme, layout, components, `PullToRefresh`, `PageHero`, cards, buttons, iconography, and copy style.
4. `S4` — Keep the internal Rust crate name `pi-companion-server` where Pi compatibility requires it, but release the daemon binary artifact as `gentle-companion-server`.
5. `S5` — Verify the integration with `npm run check`, `npm run test:extension`, `npm run ui:build`, and `cargo test --manifest-path server/Cargo.toml`.

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1 | Merge `upstream/main` and resolve conflicted files | `b432dcc` |
| T2 | S2, S3 | Rebrand user-facing Rust errors, tools, docs, and i18n strings | `b432dcc` |
| T3 | S4 | Keep `gentle-companion-server` in release workflow and local build scripts | `b432dcc` |
| T4 | S5 | Run type checks, UI build, extension tests, and Rust tests | `07cf02f` |

## Log

- `L1` — User request: integrate the new `pi-companion` upstream functionality into `gentle-companion`, preserving Gentle Shell/Gentle Companion identity, bilingual behavior, UI design decisions, release artifacts, and daemon binary naming.
- `L2` — Upstream range: merge-base `410b85a73260f78b5cd2efb2d339e8d6a16dd779` through `upstream/main` at `v0.4.2`.
- `L3` — Integration branch: `integration/upstream-v0.4.2`.
- `L4` — Recommended version: `0.4.3`, because Gentle Companion already carries changes from `0.3.15` through `0.3.17`.
- `L5` — Slice boundary: commit `b432dcc` on `integration/upstream-v0.4.2` contains `4720 authored changed lines` in `18 commits` since `origin/main`, excluding lock files. This is above the ~400-line review slice heuristic, so the delivery strategy must be confirmed before PR creation or further work-unit commits.
- `L6` — Verified after `b432dcc`:
  - `npm run check` passed.
  - `npm run test:extension` passed: `359` tests, `0` failures.
  - `npm run ui:build` passed.
  - `cargo test --manifest-path server/Cargo.toml` passed: `128` tests, `0` failures.
- `L7` — Delivery decision: selected `feature-branch-chain` with an over-budget integrated child PR after a single honest slicing pass showed no cohesive split below the review budget.
- `L8` — Remote delivery:
  - Tracker PR: [#6](https://github.com/IAI-00-IAI/gentle-companion/pull/6) — draft/no-merge tracker for `feat/upstream-v0.4.2`.
  - Child PR: [#7](https://github.com/IAI-00-IAI/gentle-companion/pull/7) — integrated bridge slice targeting the tracker branch.
