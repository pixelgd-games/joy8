# Joy8 Known Issues

This document contains only confirmed, currently relevant limitations, risks, and deferred launch decisions. It is not a work queue by itself; do not implement an item unless the user places it in scope.

Current implementation facts are in `../../README.md`. Resolved issues belong in Git history, commits, and migrations instead of this file.

## Status Summary

The Lobby, Loader, Admin, Gateway, and database boundaries are usable and do not require an architectural rewrite.

The launch path has origin checks, rate limits, request limits, timeouts and
protected RPC grants. Settlement requires a game-bound backend key; each product
must still implement and verify authoritative gameplay before activation.

## Launch Blockers

### Release Gates

- No game is published and every private entry is paused. Release requires an
  explicitly approved game audience and activation, per-game bet and
  per-round payout limits, and product recovery evidence and procedures.
- No product has completed hosted gameplay and settlement acceptance.
- The hosted Email provider still accepts verified API signup. Disable only the
  Email provider before public release; the user controls the timing and
  [README.md](../../README.md#hosted-auth-configuration) owns the procedure. Do
  not disable all signup, which would also stop Google and guest entry.
- No general compensation or funding API exists. Define the reviewed linked
  compensation procedure before funded operation; immutable records cannot be
  edited to repair an accounting discrepancy.
- The six-digit public-ID capacity and guest abuse/retention policy remain
  explicit release limits. Do not delete identities, recycle IDs or expand the
  namespace without a reviewed product/database change.
- Facebook remains disabled; provider sign-in without an email address is not
  silently accepted.

The integration requirements and acceptance cases belong in
[GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md#operational-protocol-v1).
POINT rules belong in [PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md#wallet-and-point-direction).

### Mahjong Activation

Mahjong Clash (`D:/Studio/Project-Gaming/production/table/products/mahjong-clash`)
has a hidden catalog entry, a 25-table private `mahjong_clash` schema, a
registered accounting adapter and an identity-only game policy: full-balance
table reservation with a 1-POINT `max_reserve_amount` guard. A player with more
than 1 available POINT cannot open a table under this policy; it is not a funded
configuration. Its private entry is paused and bound only to
`http://localhost:5173` -> `http://localhost:4391/`. It has no cloud build,
production URL or public entry.

Its restricted `mahjong_clash_runtime` login and game-scoped exchange/renew-only
Backend Key have no expiry since 2026-09-25; they stay valid until revoked.
Replacement requires a reviewed operator action through the
[credential workflow](../../integrations/third-party/README.md#platform-operator-flow)
or a secret manager; never write plaintext credential files into this repository.

Open items before activation:

- `20260924150000_mahjong_per_table_storage.sql` (applied 2026-09-25) moved the
  schema to 25 tables with per-table storage, the quarantined-table void and the
  operator queue. Its `mahjong_clash_operator` role has no login; an operator
  login needs a separate reviewed credential action.
- Economy operations lock one singleton `economy_state` row, serializing them
  across tables. Measure hosted capacity before funded or public activation.
- Re-enabling the entry needs a reviewed audience and activation change, then:
  real Joy8 sign-in reaching the game with the same player and balance; funded
  limits and financial key scopes; AI funding and full gameplay acceptance; a
  reviewed production origin and launch URL migration; and game hosting.
- To withdraw activation, disable the entry and keys first and preserve
  committed hands and audit data. Verify hosted backup availability before
  operating.

The game owns its runtime verification in its own `server/README.md`.

### Cloudflare Build Environment

The Git-connected Pages build can fail before the project build starts:
Cloudflare's Node installer cannot fetch its GitHub `node-build` repository,
reports `could not read Username for 'https://github.com'`, and then cannot find
the configured Node 22.23.2 definition. The provider-side cause has not been
established; it is not a Joy8 repository permission or application build error.
Until a Git-triggered build succeeds, deploy a verified local build with Wrangler.

## Member and Guest Risks

- Guest-to-Google linking, provider-conflict preservation and cross-browser guest
  continuity have not passed hosted acceptance. Isolated SQL tests do not prove
  real provider linking.
- Account-deletion requests are not implemented.
- The identity design and unresolved choices are owned by
  [MEMBER_AUTH_PLAN.md](../platform/MEMBER_AUTH_PLAN.md). Do not invent a
  game-specific wallet, guest-retention, or currency-conversion policy here.

### Guest Data Growth

Guest entry creates a persistent Auth identity, an enrolled player and a wallet
holding the 100 POINT guest grant; game launch reuses that wallet. Clearing browser
data and entering again creates another funded guest. Turnstile protects Auth
entry, but retention, cleanup and broader abuse controls are not defined.

Before volume grows materially:

- Verify guest continuity across the supported browsers and devices.
- Define retention for guest players, wallets, sessions, matches, settlements,
  and transactions.
- Define which records may be deleted and which must remain auditable.

### Public Player ID Capacity

`player_accounts.public_id` is a unique six-digit number from `100000` through
`999999`, so the namespace contains 900,000 values. The allocator tries at most
128 random candidates with indexed collision checks and candidate-specific locks;
collision pressure can cause failures before absolute exhaustion.

Before the platform approaches that capacity, approve and migrate to a larger
public namespace. Public IDs must not be recycled, accepted as credentials, or
used in place of the internal player UUID for authorization, wallets, settlement,
or game-owned identity mapping.

## Scale and Operations

### Product DDL and Adapter Availability

Supported product DDL and object grants are validated automatically at commit.
PostgreSQL event triggers exclude shared objects such as roles, so role
membership and attribute changes still require explicit all-adapter preflight in
their transaction. GRANT and REVOKE use global validation because event metadata
omits their target objects, and those changes require READ COMMITTED. Disabling
the guard or skipping role preflight can stop adapters at runtime. The contract
belongs to [GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md#product-schema-registration).

### Deployed Gateway Differs From Source

The deployed `joy8-gateway` still maps the removed `JOY8_PAYOUT_BUDGET_EXCEEDED`
error to 409; the source no longer does. The database can no longer raise that
error, so behavior is unaffected. The next reviewed Gateway deployment removes
the difference.

### Synchronous Gateway Runtime Cleanup

After a successful `create-session`, the Gateway also calls
`joy8_cleanup_gateway_runtime` synchronously, in addition to the scheduled
pg_cron run. Cleanup cost is part of session-creation latency and grows with the
session and rate-limit tables. If measurements show pressure, rely on the
scheduled run and add indexes for the cleanup predicates.

### External Monitoring Not Configured

`POST /health` checks Gateway dependencies, not a complete gameplay or
settlement flow. No external monitor, notification destination or alerting
vendor is configured, so no alert reports Gateway dependency failures. Connect a
reviewed monitor to the health route, not to session creation, and follow
`ANALYTICS_MONITORING.md`.

### Origin Checks Are Not Identity Proof

`create-session` requires an allowed Origin and all routes use database-backed
rate limits. This blocks common cross-origin misuse but Origin is not an
unforgeable client identity, and Turnstile protects guest Auth only, not session
issuance. If production evidence shows Gateway abuse, evaluate edge protection,
device attestation, or a stronger issuance design with a privacy review.

### Forwarded Client Address Trust Is Unverified

The Gateway selects `cf-connecting-ip`, then `x-real-ip`, then the first
`x-forwarded-for` value, falling back to `unknown`. Which headers the hosted
ingress overwrites is not established. A bounded hosted probe found no bucket
matching injected addresses, but it did not cover native IPv6 transport or Worker
subrequests. This is an unverified boundary, not a confirmed bypass. Establish the
managed ingress contract before changing the selection; do not add a public
header echo endpoint.

### Scoped Limit Capacity

The Gateway's per-player, Session, table and backend budgets are initial abuse
limits, not measured production capacity. Local tests do not prove hosted header
trust, real Auth or production capacity.

## Test Gaps

Not automated:

- Loader success from session creation through a real game iframe.
- Admin create, edit, publish, and ordering flows and admin-form validation.
- Browser-level member-versus-guest session behavior.
- Accessibility behavior for modal focus and keyboard navigation.
- Hosted Auth, real provider linking, production load and backup restoration.

## Database Recovery Limitation

The repository intentionally has no baseline migration. Existing migrations
assume earlier catalog and admin objects already exist. `supabase/config.toml`
points to a default `./seed.sql` that does not exist. A fresh local project cannot
be reconstructed from this repository, and disaster recovery depends on Supabase
backup and restore.

- Do not create a large baseline migration automatically or reset the hosted database.
- Before production launch, document and test backup, restore, and disaster-recovery procedures.

## User Experience and Maintainability

### Same-Origin Sandbox Handoff

A same-origin game is sandboxed without `allow-same-origin`, so it has a `null`
origin and the Loader sends the launch response with target `*` after checking
the exact iframe window and `null` origin. This deliberate exception is weaker
than exact-origin delivery used for cross-origin games.

### Error Modal Accessibility

The shared Error Modal does not provide a complete focus trap or focus
restoration after close. Preserve the existing error codes and plain fallback
content when accessibility work is in scope.

## Stable Constraints

These are not issues:

- Vanilla JavaScript and Vite are intentional.
- Cloudflare Pages static hosting is intentional.
- The database is the game catalog source; no local allowlist is needed.
- The iframe sandbox is intentionally restrictive.
- Cross-origin games receive `allow-same-origin` for their own storage compatibility; same-origin games do not.
- Games own CSP, `X-Frame-Options`, rendering, and resource failures.
- Joy8 does not modify a game repository during platform work.
- Gambling products do not ship to CrazyGames.
