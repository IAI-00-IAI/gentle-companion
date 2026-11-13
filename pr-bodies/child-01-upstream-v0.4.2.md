## Summary

Integrates the `pi-companion` `v0.4.0` through `v0.4.2` bridge functionality into Gentle Companion.

This PR includes:

- Localhost server bridge and agent-mentioned file previews.
- Bridge lease renewal, revocation, expiry, and quota handling.
- Fullscreen preview support and framing-blocker fallback.
- Local file link handling and safer file actions.
- Gentle Companion user-facing naming, i18n keys, UI design preservation, and `gentle-companion-server` release artifacts.

## Changes

| Area | Change |
|------|--------|
| `server/src/bridge.rs` | Adds the Rust bridge implementation, permits, leases, quota, and safety checks |
| `server/src/bridge_shim.js` | Adds the Node shim used by the bridge frontend |
| `server/src/bridge_tests.rs` | Adds Rust integration tests for bridge behavior |
| `server/src/main.rs` | Adds bridge routes, AppState fields, and user-facing daemon output |
| `ui/src/lib/BridgePreview.svelte` | Adds the bridge preview UI |
| `ui/src/lib/bridge-lease.ts` | Adds client-side lease handling |
| `ui/src/lib/artifact-preview.ts` | Adds bridge/preview target types and helpers |
| `ui/src/lib/companion.svelte.ts` | Adds bridge file/endpoint helpers |
| `ui/src/routes/sessions/[id]/+page.svelte` | Wires preview actions into the session page |
| `ui/src/routes/settings/+page.svelte` | Adds/adjusts settings UI for usage and bridge behavior |
| `i18n.svelte.ts` | Adds bilingual UI keys |
| Release workflow | Keeps `gentle-companion-server` as the released daemon binary |

## Test Plan

- `npm run check` passed.
- `npm run test:extension` passed: `359` tests, `0` failures.
- `npm run ui:build` passed.
- `cargo test --manifest-path server/Cargo.toml` passed: `128` tests, `0` failures.

## Chain Context

| Field | Value |
|-------|-------|
| Chain | `upstream-v0.4.2` |
| Tracker PR | [#6](https://github.com/IAI-00-IAI/gentle-companion/pull/6) |
| Position | 1 of 1 |
| Base | `feat/upstream-v0.4.2` |
| Depends on | Tracker PR #6 |
| Follow-up | Merge tracker after this child PR is reviewed |
| Review budget | `4876` / `400` |
| Starts at | `origin/main` plus Gentle Companion fork changes |
| Ends with | Integrated bridge, i18n, tests, release naming, and task documentation |

### Chain Overview

```text
main
 └── #6 feat/upstream-v0.4.2 (tracker)
      ↑ 📍 This PR: feat/upstream-v0.4.2-01-integration
```

### Scope

- Includes:
  - `pi-companion` `v0.4.0` through `v0.4.2` bridge integration
  - Gentle Companion naming, i18n, and release artifact adjustments
  - Rust, UI, extension, and build verification
- Excludes:
  - Upstream-only branding changes
  - Changes unrelated to the companion bridge
  - Merge of the tracker PR

### Autonomy

- [x] CI is expected to pass for this PR branch
- [x] This PR has one deliverable scope
- [x] This PR can be rolled back without unrelated changes
- [x] Tests, docs, or manual verification cover this unit
