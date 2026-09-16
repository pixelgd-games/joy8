# Looty Known Issues

This document contains only confirmed, currently relevant limitations, risks, and deferred launch decisions. It is not a work queue by itself; do not implement an item unless the user places it in scope.

Current implementation facts are in `../../README.md`. Resolved issues belong in Git history, commits, and migrations instead of this file.

Last reviewed: 2026-09-16.

## Status Summary

The current Lobby, Loader, Admin, Gateway, and database boundaries are usable and do not require an architectural rewrite.

The Demo launch path has origin checks, rate limits, request limits, timeouts,
and protected RPC grants. Those controls do not validate a game result or make
browser-selected payout amounts safe for operational POINT. The trust and
accounting gaps below must be closed before operational launch.

## Product-Readiness Decisions

### Operational Accounting and Cutover

- Current browser game tokens include payout/refund scopes and accept submitted
  amounts. A trusted server-only settlement boundary is not implemented.
- Current wallets are shared by player/currency, without product scope.
- Active-status wallet uniqueness does not alone prevent replacement wallets
  or repeated grants after freezing; lifecycle/provisioning needs explicit tests.
- Current one-session wallet calls do not implement atomic multi-account game
  settlement, product-account participation, or long-match credential renewal.
- Existing Demo data and automatic test credit need an explicit cutover decision.
  Preserve evidence; do not silently relabel test funds as operational balances
  or clear records during documentation work.

The requirements and acceptance cases belong in
[GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md#target-operational-contract).
POINT purchase policy and release timing belong in
[PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md#wallet-and-point-direction).

### Product SQL Drafts

The three `2026091609...` Mahjong SQL files are review-only, not applied and not
an approved deployable set. They have incomplete account coverage and mismatches
with product identifiers and occupancy. The product owns the detailed corrections
in [its data plan](../../../../Project-Gaming/production/table/products/mahjong-clash/docs/DATA_AND_LOOTY_INTEGRATION_PLAN.md#sql-draft-corrections).
Review them before any database push; their presence in the migration directory
is not authorization to apply them.

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
- Looty-controlled branded game entry and persistent guest behavior are still a plan, not implemented features.
- The current Demo `POINT` wallet is keyed by player and currency without an explicit product scope. Multiple games therefore share one balance today whether or not the product should use an independent game wallet.

Risk:

- Player continuity is weak and guest data grows with launches.
- Current wallet behavior cannot yet distinguish an independent game's wallet from the shared wallet approved for Looty-native games.

The identity design and unresolved choices are owned by `../platform/MEMBER_AUTH_PLAN.md`. The approved wallet direction is in `../product/PRODUCT_SCOPE.md`, and current runtime behavior remains in `../platform/GAME_PLATFORM_INTEGRATION.md`. Do not treat the planned behavior as implemented or invent a wallet classification, guest-retention, or currency-conversion policy in this document.

## Scale and Operations

### Guest Data Growth

Guest launches currently create platform player, wallet, and session records. Retention and cleanup policy is not finalized.

Before volume grows materially:

- Implement the approved persistent-guest requirement using the mechanism reviewed in the member plan.
- Define retention for guest players, wallets, sessions, rounds, and transactions.
- Define which records may be deleted and which must remain auditable.
- Verify member conversion and account linking preserve the correct guest data.

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
- The selected local-test/hosted-operation direction now requires a reproducible
  local fixture/bootstrap before platform integration tests. Prepare it as a small,
  reviewed setup without importing production secrets or personal data. Do not
  turn it into an unconfirmed baseline or reset the hosted database.

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
