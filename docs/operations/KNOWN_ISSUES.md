# Looty Known Issues

This document contains only confirmed, currently relevant limitations, risks, and deferred launch decisions. It is not a work queue by itself; do not implement an item unless the user places it in scope.

Current implementation facts are in `../../README.md`. Resolved issues belong in Git history, commits, and migrations instead of this file.

Last reviewed: 2026-09-15.

## Status Summary

The current Lobby, Loader, Admin, Gateway, and database boundaries are usable and do not require an architectural rewrite.

The main launch path is protected by origin checks, database-backed rate limits, request-size limits, upstream timeouts, iframe restrictions, and protected RPC grants. The remaining items below are operational, scale, test, or product-readiness gaps.

## Product-Readiness Decisions

### Demo Test Credit

Current behavior:

- A new Demo `POINT` wallet receives 10,000 points.
- The credit is recorded as a deposit transaction.
- It is test behavior and does not represent production money.

Before production money or a public launch that requires production economics:

- Decide when the automatic credit is disabled.
- Decide how existing test players, wallets, sessions, rounds, and transactions are cleared or isolated.
- Verify the final wallet initialization path.

Do not close or redesign this behavior without a user decision.

### Database-Level Demo Currency Constraint

Current behavior:

- Gateway version 5 rejects a Demo session whose currency is not `POINT`.
- The additional database constraint and trigger were deliberately placed on hold.
- No unapplied hold migration should remain in the active migration directory.

Risk:

- Gateway enforcement is correct for the current public path, but the database does not independently express the same invariant.

Action boundary:

- Revisit before production launch.
- Do not recreate or apply the database rule without a new user decision.

### Member and Persistent Guest Direction

Current behavior:

- The public member login entry is disabled.
- Most Loader launches therefore create guest platform records.
- Direct Mahjong entry and persistent guest behavior are still a plan, not an implemented feature.

Risk:

- Player continuity is weak and guest data grows with launches.

The design and unresolved choices are owned by `../platform/MEMBER_AUTH_PLAN.md`. Do not invent an identity merge or guest-retention policy in this document.

## Scale and Operations

### Guest Data Growth

Guest launches currently create platform player, wallet, and session records. Retention and cleanup policy is not finalized.

Before volume grows materially, decide:

- Whether and how a guest identity is reused.
- How long guest players, wallets, sessions, rounds, and transactions are retained.
- Which records may be deleted and which must remain auditable.
- How member conversion or account linking affects existing guest data.

### Synchronous Gateway Runtime Cleanup

After a successful `create-session`, the Gateway calls `looty_cleanup_gateway_runtime` synchronously.

Risk:

- Cleanup cost becomes part of session-creation latency.
- Larger session and rate-limit tables may turn a small request into a wider scan.

Direction when evidence shows scale pressure:

- Move cleanup to a scheduled or lower-frequency process.
- Add indexes for the actual cleanup predicates.
- Measure the cleanup cost before changing the design.

### No Operational Health Endpoint

The repository has no dedicated health endpoint that verifies the deployed Gateway and its critical database dependency without creating player data.

Impact:

- External uptime checks can verify static pages but cannot cleanly distinguish Gateway availability from a full session flow.

Direction:

- Design a non-mutating health check with no secrets in the response.
- Rate-limit it and keep it separate from business KPI collection.
- Add it only with the monitoring implementation described in `ANALYTICS_MONITORING.md`.

### Origin Checks Are Not Identity Proof

`create-session` requires an allowed Origin and all routes use database-backed IP rate limits. This blocks common cross-origin misuse but does not make Origin an unforgeable client identity.

If production evidence shows abuse, evaluate edge protection, CAPTCHA, device attestation, or a stronger issuance design. Do not add these preemptively without an observed need and a privacy review.

## Test Gaps

### Dependency Audit Finding

On 2026-09-15, `npm audit --audit-level=low` reported one high-severity advisory:

```text
vite 7.3.6 -> postcss 8.5.25 -> nanoid 3.3.16
GHSA-2v37-7h3g-55p8
```

The production build, local smoke check, and Gateway unit check still pass. Treat this as dependency-maintenance work, not evidence that the runtime flow is currently broken.

When dependency maintenance is in scope:

- Apply the smallest compatible lockfile or dependency update.
- Review the resulting dependency tree instead of running a blind major upgrade.
- Rerun `npm audit`, `npm run build`, `npm run smoke`, and `npm run test:gateway`.

### Automation Coverage

Current local checks cover the static build, key pages, iframe restrictions, load timeout behavior, cover fallback, basic error presentation, and selected Gateway validation paths.

Not fully automated:

- Loader success from session creation through a real game iframe.
- Admin create, edit, delete, publish, and ordering flows.
- URL-helper and admin-form validation.
- Every Gateway request validator and public error mapping.
- Browser-level member-versus-guest session behavior.
- Accessibility behavior for modal focus and keyboard navigation.

`npm run smoke:gateway` targets the deployed Gateway and may create Demo runtime data. Do not run it as a routine local check without reading the script and confirming its mode.

## Database Recovery Limitation

The repository intentionally has no baseline migration. Existing migrations assume earlier catalog and admin objects already exist. `supabase/config.toml` also points to the default `./seed.sql`, but that file is absent.

Impact:

- A fresh local project cannot be reconstructed from this repository alone.
- Disaster recovery depends on external Supabase backup and restore capability.

Direction:

- Do not create a large baseline migration automatically.
- Before production launch, document and test backup, restore, and disaster-recovery procedures.
- If a reproducible local database becomes a requirement, design it as a reviewed project rather than an incidental cleanup.

## User Experience and Maintainability

### Iframe Load Is Not Game Readiness

The Loader's 30-second timeout observes the iframe `load` event. A game can load its document and then stall internally.

A more accurate signal requires an explicit game-ready handshake in the game integration contract. This is cross-repository work and must not be simulated only in the Looty shell.

### Error Modal Accessibility

The shared Error Modal does not yet provide a complete focus trap and focus restoration after close.

Address this when accessibility work is in scope. Preserve the existing error codes and plain fallback content.

### Repeated Admin Form Metadata

Create and edit flows repeat some field and game-type option definitions.

Do not refactor only for aesthetic reuse. Centralize the definitions when a real catalog change needs both paths or when the options become inconsistent.

### Mixed User-Facing Language

Some public and error UI strings are Chinese while a few fallback paths are English.

This documentation cleanup does not change product copy. Decide the intended product language and localization model before normalizing UI strings.

## Stable Constraints

These are not issues:

- Vanilla JavaScript and Vite are intentional.
- Cloudflare Pages static hosting is intentional.
- The database is the game catalog source; no local allowlist is needed.
- The iframe sandbox is intentionally restrictive.
- Cross-origin games currently receive `allow-same-origin` for their own storage compatibility; same-origin games do not.
- Games own CSP, `X-Frame-Options`, rendering, and resource failures.
- Looty does not modify a game repository during platform work.
- Gambling products do not ship to CrazyGames.
