# Joy8 Known Issues

This document contains only confirmed, currently relevant limitations, risks, and deferred launch decisions. It is not a work queue by itself; do not implement an item unless the user places it in scope.

Current implementation facts are in `../../README.md`. Resolved issues belong in Git history, commits, and migrations instead of this file.

Last reviewed: 2026-09-20.

## Status Summary

The current Lobby, Loader, Admin, Gateway, and database boundaries are usable and do not require an architectural rewrite.

The deployed launch path has origin checks, rate limits, request limits,
timeouts and protected RPC grants. Settlement requires a game-bound backend key;
each product must still implement and verify authoritative gameplay before activation.

## Product-Readiness Decisions

### Operational Accounting and Cutover

- The deployed foundation implements scope, backend authority, reservation,
  atomic settlement, product adapters and renewal. Browser amount RPCs are removed.
  Mahjong has verified identity-only configuration and a restricted hosted
  connection; full gameplay/settlement acceptance remains unverified. Passing
  local fixture tests does not authorize funded operation.
- Operational opening credit is decided: 0 POINT pending a later grant decision.
  The approved reset removed test accounting; no old balance was transferred.
- Each product still needs reviewed scope/limits, keys, its authoritative backend
  and any accounting adapter. Mahjong's installed policy and exchange/renew key
  support identity checks only; financial scopes and funding remain pending.
- No general compensation/funding API exists. Define the reviewed linked
  compensation procedure before funded operation; immutable records cannot be
  edited to repair an accounting discrepancy.

The requirements and acceptance cases belong in
[GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md#operational-protocol-v1).
POINT purchase policy and release timing belong in
[PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md#wallet-and-point-direction).

### Mahjong Activation

The continuous-settlement extension, ledger cleanup and 22-table Mahjong private
schema are installed. Private entry and the hosted `joy8-gateway` using product
protocol `server-v1` are active with an
identity-only game policy and zero opening credit. The restricted TLS database
connection passed; the game has only an expiring exchange/renew key. Test entry
uses ordinary member/guest authentication without per-player approval.
Real sign-in/game acceptance and funded-play policy/key
scopes remain incomplete. The test page ships with Joy8, but Mahjong entry is
configured only for localhost and its public release is not activated.
See [the activation review](../../supabase/drafts/MAHJONG_REVIEW.md).

The three original `2026091609...` Mahjong drafts remain superseded, unapplied
reference material under `supabase/drafts/mahjong-clash/`; never bulk-apply them
alongside the installed product schema. The product owns future gameplay SQL.

Mahjong's installed `runtime_balance()` reports the stored wallet balance, while
the Gateway reports available balance after subtracting locked POINT. The runtime
value must not be treated as spendable balance during an active hold. Its economy
operations also lock one singleton `economy_state` row, serializing those
operations across matches. Correct the balance contract and measure this capacity
before funded or public activation.

### Member and Persistent Guest Direction

Hosted member settings have been inspected and the authorized entry changes are
recorded in [README.md](../../README.md#hosted-auth-configuration). Google sign-in,
guest entry and production Turnstile verification passed hosted acceptance.
The public Email/password flow is disabled. Cloudflare Email Sending is disabled,
both SMTP credentials were deleted, and Workers Paid was canceled.

Current behavior:

- Google/guest entry, persistent guest restoration, guest promotion and
  enrollment checks are implemented. The member migrations and Gateway are
  active. Guest-to-Google linking still needs real hosted conflict and
  preservation acceptance.
- `/account/` is a callback trampoline back to the Lobby dialog. It is not a
  standalone account, password or recovery page.
- Branded cross-origin handoff and account-deletion requests remain unimplemented.
- Wallet scope is resolved by trusted platform/game policy. Mahjong's enabled
  zero-credit identity policy does not establish funded-play readiness.

Risk:

- Hosted guest entry, Google sign-in and the earlier launch flow passed the
  acceptance recorded in [README.md](../../README.md#verification). Cross-browser
  continuity and real provider promotion remain unverified. Isolated SQL tests, including native
  PostgreSQL 17.6 races, do not prove real provider linking.

The identity design and unresolved choices are owned by `../platform/MEMBER_AUTH_PLAN.md`. The approved wallet direction is in `../product/PRODUCT_SCOPE.md`, and current runtime behavior remains in `../platform/GAME_PLATFORM_INTEGRATION.md`. Do not treat the planned behavior as implemented or invent a wallet classification, guest-retention, or currency-conversion policy in this document.

## Scale and Operations

### Guest Data Growth

Guest entry creates a persistent Auth identity and enrolled player; game launch
reuses that player's wallet and creates a session. Auth entry is protected by
Cloudflare Turnstile. Retention, cleanup and broader public-signup abuse controls
are not finalized.

Before volume grows materially:

- Verify guest continuity across the supported browsers and devices.
- Define retention for guest players, wallets, sessions, matches, settlements,
  and transactions.
- Define which records may be deleted and which must remain auditable.
- Verify member conversion and account linking preserve the correct guest data.

### Public Player ID Capacity

`player_accounts.public_id` is a unique six-digit number from `100000` through
`999999`, so the current namespace contains 900,000 values. The allocator tries
at most 128 random candidates and cannot create an ID after the namespace is
exhausted; collision pressure can cause failures before absolute exhaustion.

Before the platform approaches that capacity, approve and migrate to a larger
public namespace. Public IDs must not be recycled, accepted as credentials, or
used in place of the internal player UUID for authorization, wallets, settlement,
or game-owned identity mapping.

The allocator uses indexed collision checks and nonblocking candidate-specific
transaction locks. A crowded namespace or extreme candidate contention can
still reject allocation within the 128-attempt limit. It does not promise
unlimited throughput or increase the six-digit capacity.

### Product DDL and Adapter Availability

Product schema and policy registration validate isolation before commit.
Supported subsequent DDL and object grants are automatically validated at commit.
PostgreSQL event triggers exclude shared objects such as roles; role membership
and attribute changes still require explicit all-adapter preflight in their
transaction. Disabling the guard or skipping role preflight can stop adapters at
runtime. Every product schema must be registered before runtime access, including
products without an adapter. The registration and DDL contract belongs to
[GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md#product-schema-registration).

### Synchronous Gateway Runtime Cleanup

After a successful `create-session`, the Gateway calls `joy8_cleanup_gateway_runtime` synchronously.

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

Cloudflare Turnstile now protects anonymous guest Auth entry but does not prove identity
for Gateway session issuance. If production evidence shows Gateway abuse,
evaluate edge protection, device attestation, or a stronger issuance design with
a privacy review.

### Forwarded Client Address Trust Is Unverified

The Gateway selects `cf-connecting-ip`, then `x-real-ip`, then the first
`x-forwarded-for` value, falling back to `unknown`. Local tests cannot establish
which headers the hosted ingress overwrites or whether a caller can influence
the selected rate-limit key. This is an unverified boundary, not a confirmed bypass.

[Cloudflare documents](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
that it can append to an existing forwarded chain and that Worker subrequests
have distinct client-IP behavior. The [Supabase example](https://supabase.com/docs/guides/functions/examples/cloudflare-turnstile)
uses the first forwarded address, but does not establish Joy8's complete ingress
trust contract. Neither source proves the hosted fallback branches safe.

Before changing this selection, verify the managed ingress contract or run a
separately approved, bounded hosted diagnostic using conflicting synthetic values
in all three headers, including multi-hop and IPv6 cases. Confirm the selected
key comes from the trusted ingress; do not log credentials or add a public header
echo endpoint. Local mocked headers and IP-format validation cannot prove this.

## Test Gaps

### Automation Coverage

Current local checks cover the static build and production security-header artifact,
key pages, iframe restrictions, credential-free launch URLs, load timeout,
Joy8-managed cover validation and fallback, error presentation, member service logic, Gateway
membership authorization, safe return paths, and responsive member UI. The
isolated member SQL suite loads the current platform migrations and checks roles,
rollback, zero-POINT provisioning and promotion preserving both wallet scopes,
ledger and reservations. Its engine and fixture limits are documented in
[README.md](../../README.md#verification). Native PostgreSQL 17.6 also passes
15 competing-connection cases against that schema. Hosted guest and Google
sign-in acceptance and production Turnstile verification are recorded in README.
Public-ID checks cover stable allocation and service-role-only profile
resolution. Hosted guest-to-Google linking, cross-browser guest continuity and
production load remain unverified.

Not fully automated:

- Loader success from session creation through a real game iframe.
- Admin create, edit, delete, publish, and ordering flows.
- Full browser-level admin-form validation.
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

### Same-Origin Sandbox Handoff

Cross-origin games use an exact message target. A same-origin game is sandboxed
without `allow-same-origin`, so it has a `null` origin and the Loader sends the
response with target `*` after checking the exact iframe window and `null` origin.
This is a deliberate current exception but remains weaker and more difficult to
reason about than exact-origin delivery.

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
- Joy8 does not modify a game repository during platform work.
- Gambling products do not ship to CrazyGames.
