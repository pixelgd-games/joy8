# Looty Known Issues

This document contains only confirmed, currently relevant limitations, risks, and deferred launch decisions. It is not a work queue by itself; do not implement an item unless the user places it in scope.

Current implementation facts are in `../../README.md`. Resolved issues belong in Git history, commits, and migrations instead of this file.

Last reviewed: 2026-09-17.

## Status Summary

The current Lobby, Loader, Admin, Gateway, and database boundaries are usable and do not require an architectural rewrite.

The deployed launch path has origin checks, rate limits, request limits,
timeouts and protected RPC grants. Settlement requires a game-bound backend key;
each product must still implement and verify authoritative gameplay before activation.

## Product-Readiness Decisions

### Operational Accounting and Cutover

- The deployed foundation implements scope, backend authority, reservation,
  atomic settlement, product adapters and renewal. Browser amount RPCs are removed.
  Per-product configuration and real backend integration remain unverified;
  passing local fixture tests does not activate products.
- Operational opening credit is decided: 0 POINT pending a later grant decision.
  The approved reset removed test accounting; no old balance was transferred.
- Each product still needs reviewed scope/limits, keys, its authoritative backend
  and any accounting adapter. No product policy or key is installed by the platform migrations.
- No general compensation/funding API exists. Define the reviewed linked
  compensation procedure before funded operation; immutable records cannot be
  edited to repair an accounting discrepancy.

The requirements and acceptance cases belong in
[GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md#operational-protocol-v1).
POINT purchase policy and release timing belong in
[PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md#wallet-and-point-direction).

### Product SQL Drafts

The three `2026091609...` Mahjong SQL files are review-only, not applied and not
an approved deployable set. They have incomplete account coverage and mismatches
with product identifiers and occupancy. The product owns the detailed corrections
in [its data plan](../../../../Project-Gaming/production/table/products/mahjong-clash/docs/DATA_AND_LOOTY_INTEGRATION_PLAN.md#sql-draft-corrections).
They are preserved under `supabase/drafts/mahjong-clash/`, outside active migration
discovery. See [draft review instructions](../../supabase/drafts/README.md).

### Member and Persistent Guest Direction

Hosted member settings have been inspected and the authorized entry changes
saved through the dashboard. The exact current settings and remaining CLI
configuration-access limitation are recorded in
[README.md](../../README.md#hosted-auth-configuration). Do not treat that CLI
limitation as inability to inspect the project or replace the working token
without evidence. SMTP, hosted password/abuse policy, and real provider acceptance
remain release gates.

Current behavior:

- Member entry, persistent guest, promotion, recovery and enrollment checks are
  implemented. The member migrations and Gateway are active; the matching front
  end is released from main. Real provider acceptance remains outstanding.
- Branded cross-origin handoff and account-deletion requests remain unimplemented.
- Wallet scope is resolved by trusted platform/game policy. No product policy is
  enabled until its integration is reviewed.

Risk:

- Hosted guest entry and the earlier launch flow passed the limited acceptance in
  [README.md](../../README.md#verification). Cross-browser continuity and real
  provider promotion remain unverified. Isolated SQL tests, including native
  PostgreSQL 17.6 races, do not prove real provider linking.

The identity design and unresolved choices are owned by `../platform/MEMBER_AUTH_PLAN.md`. The approved wallet direction is in `../product/PRODUCT_SCOPE.md`, and current runtime behavior remains in `../platform/GAME_PLATFORM_INTEGRATION.md`. Do not treat the planned behavior as implemented or invent a wallet classification, guest-retention, or currency-conversion policy in this document.

## Scale and Operations

### Guest Data Growth

Guest entry creates a persistent Auth identity and enrolled player; game launch
reuses that player's wallet and creates a session. Retention, cleanup and
public anonymous-signup abuse controls are not finalized.

Before volume grows materially:

- Verify guest continuity across the supported browsers and devices.
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

### External Monitoring Not Configured

POST /health and its protected dependency RPC are deployed and passed the hosted
health/rejection checks. No external monitor, notification destination or
alerting vendor has been configured.

Impact:

- No automatic alert currently reports Gateway dependency failures. The health
  route checks dependencies, not a complete gameplay or settlement flow.

Direction:

- Connect a reviewed monitor to the existing health route; do not poll session
  creation. Verify alerts with an approved outage simulation.
- Follow the minimum runbook and reconciliation checks in `ANALYTICS_MONITORING.md`.

### Origin Checks Are Not Identity Proof

`create-session` requires an allowed Origin and all routes use database-backed IP rate limits. This blocks common cross-origin misuse but does not make Origin an unforgeable client identity.

If production evidence shows abuse, evaluate edge protection, CAPTCHA, device attestation, or a stronger issuance design. Do not add these preemptively without an observed need and a privacy review.

## Test Gaps

### Automation Coverage

Current local checks cover the static build, key pages, iframe restrictions,
load timeout, cover fallback, error presentation, member service logic, Gateway
membership authorization, safe return paths, and responsive member UI. The
isolated member SQL suite also executes both migrations and checks roles, rollback,
player/wallet preservation and initial credit. Its engine and fixture limits are
documented in [README.md](../../README.md#verification). Native PostgreSQL 17.6
also passes eight competing-connection cases. Hosted guest acceptance is limited
to the checks in README; Google/email, linking, recovery and production load
remain unverified.

Not fully automated:

- Loader success from session creation through a real game iframe.
- Admin create, edit, delete, publish, and ordering flows.
- URL-helper and admin-form validation.
- Every Gateway request validator and public error mapping.
- Browser-level member-versus-guest session behavior.
- Accessibility behavior for modal focus and keyboard navigation.

`npm run smoke:gateway` now checks only replacement health and rejected requests. It does not create business records, but changes rate counters and requires explicit hosted execution approval. Its hosted health/rejection checks have passed.

## Database Recovery Limitation

The repository intentionally has no baseline migration. Existing migrations assume earlier catalog and admin objects already exist. `supabase/config.toml` also points to the default `./seed.sql`, but that file is absent.

Impact:

- A fresh local project cannot be reconstructed from this repository alone.
- Disaster recovery depends on external Supabase backup and restore capability.

Direction:

- Do not create a large baseline migration automatically.
- Before production launch, document and test backup, restore, and disaster-recovery procedures.
- The selected local-test/hosted-operation direction now requires a reproducible
  full local bootstrap before platform integration tests. A minimal member SQL
  fixture now exists, using synthetic data and selected existing migrations; it
  does not recreate the full Supabase stack or prove backup restoration. Do not
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
