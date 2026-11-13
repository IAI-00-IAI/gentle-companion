## Summary

Tracker PR for the integration of `pi-companion` `v0.4.0` through `v0.4.2` into Gentle Companion.

This PR is intentionally left as a **draft / no-merge** tracker. Child PRs in this chain target this branch.

## Changes

- Adds the companion bridge for localhost servers and agent-mentioned files.
- Preserves Gentle Companion identity, bilingual UI, existing design decisions, and the `gentle-companion-server` release binary.
- Keeps the internal Rust crate name where required and renames user-facing daemon/artifact references to Gentle Companion.

## Test Plan

- `npm run check` passed.
- `npm run test:extension` passed: `359` tests, `0` failures.
- `npm run ui:build` passed.
- `cargo test --manifest-path server/Cargo.toml` passed: `128` tests, `0` failures.

## Chain Context

| Field | Value |
|-------|-------|
| Chain | `upstream-v0.4.2` |
| Tracker PR | This PR |
| Position | tracker |
| Base | `main` |
| Depends on | None |
| Follow-up | Child PR `feat/upstream-v0.4.2-01-integration` |
| Review budget | pending |
| Starts at | `origin/main` |
| Ends with | A mergeable integration branch after all child PRs are reviewed and merged |

### Chain Overview

```text
main
 └── feat/upstream-v0.4.2
      ↑ Child PR: feat/upstream-v0.4.2-01-integration
```
