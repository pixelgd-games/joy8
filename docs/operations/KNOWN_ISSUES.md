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

- The whitelist SQL, reviewed cleanup and Mahjong reserve release are applied;
  the Before User Created Hook, Gateway and Pages controls are deployed.
  Inside-list Google signup is verified for Johnny; fresh outside-list Google
  rejection still needs a designated test account. Acceptance gates are owned by
  [WHITELIST_RELEASE.md](WHITELIST_RELEASE.md).

- Monster Lab is published in the public catalog with its private entry disabled;
  Mahjong is also published with its localhost private entry disabled. Monster Lab's hosted
  launch, bets, win/loss settlement and complete Free Spins rounds were
  verified, with each round's player settlement total matching the game's round
  win minus the bet. Refresh during Free Spins, timeout and restart recovery,
  physical-device QA, and release math/compliance review remain open. Do not treat publication as completion of those checks.
- The hosted Email provider switch remains enabled, but the Hook rejects new
  non-Google signup. Any separate decision to disable only the
  Email provider remains under user control;
  [README.md](../../README.md#hosted-auth-configuration) owns the procedure. Do
  not disable all signup, which would also stop Google entry.
- The mailbox compensation path is deployed; issuing and claiming a real hosted
  test reward still requires a designated player and approved amount. Follow the
  [mailbox operating procedure](../platform/MAILBOX.md#operator-workflow)
  before operational use. There is no purchase/funding API; immutable gameplay
  records cannot be edited to repair an accounting discrepancy.
- The six-digit public-ID capacity and account retention policy remain
  explicit release limits. Do not delete identities, recycle IDs or expand the
  namespace without a reviewed product/database change.
- Facebook remains disabled; provider sign-in without an email address is not
  silently accepted.

The integration requirements and acceptance cases belong in
[GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md#operational-protocol-v1).
POINT rules belong in [PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md#wallet-and-point-direction).

### Mahjong Activation

Mahjong Clash (`D:/Studio/Project-Gaming/production/table/products/mahjong-clash`)
has a published catalog entry, a 25-table private `mahjong_clash` schema, a
registered accounting adapter and capped reservation of each human's maximum
one-hand loss (300 to 10,000 POINT). The 100,000,000-POINT payout safety ceiling and reviewed
financial key scopes are active. Its localhost private entry remains disabled.
The production URL is `https://mahjong-clash.pages.dev/`; the local authority
connects through the Windows Tunnel service at `wss://mahjong-clash.joy8.cc/`.
Correct-Origin WebSocket upgrade and wrong/missing-Origin blocking are verified.

Its restricted database login and game-scoped exchange/renew/open/settle/status/cancel
Backend Key have no expiry; they stay valid until revoked.
Replacement requires a reviewed operator action through the
[credential workflow](../../integrations/third-party/README.md#platform-operator-flow)
or a secret manager; never write plaintext credential files into this repository.

Remaining acceptance:

- `20260924150000_mahjong_per_table_storage.sql` (applied) moved the
  schema to 25 tables with per-table storage, the quarantined-table void and the
  operator queue. Its `mahjong_clash_operator` role has no login; an operator
  login needs a separate reviewed credential action.
- Economy operations lock one singleton `economy_state` row, serializing them
  across tables. A local PostgreSQL 17 snapshot test completed 124 mixed win/draw
  hands across 1/5/25-table scenarios with no accounting mismatch or duplicate
  retry credit. At 25 tables, settlement p95 was 711 ms, maximum 1,279 ms and up
  to 24 connections waited for locks. Throughput rose from 44.64 hands/s at five
  tables to 49.54 at 25; this is a short local SQL measurement, not hosted capacity
  or full game-server throughput. Reproduce with `scripts/mahjong-capacity-check.mjs`.
- Hosted allowlisted Lobby-to-Mahjong launch reached the real iframe and restored
  an existing game screen. The user will verify a newly played hand, player/balance
  continuity and reconciliation of human POINT and product-owned AI funding.
  Reconnecting an existing screen is not proof of a new settlement.
- The game server runs in a visible local terminal and needs manual restart after
  reboot. Only the Tunnel is an automatic Windows service. Per-IP connection
  limits remain deferred until public operation, as explicitly requested.
- To withdraw activation, disable the entry and keys first and preserve
  committed hands and audit data. Verify hosted backup availability before
  operating.

The game owns its runtime verification in its own `server/README.md`.

## Member Risks

Account closure and retention remain product decisions. Google is the only
supported member provider; Guest/Facebook/linking implementations are removed.
Real outside-list Google rejection still needs provider acceptance. Automated
Hook, Gateway and SQL checks do not stand in for that provider interaction.


## Scale and Operations

### Product DDL and Adapter Availability

Supported product DDL and object grants are validated automatically at commit.
PostgreSQL event triggers exclude shared objects such as roles, so role
membership and attribute changes still require explicit all-adapter preflight in
their transaction. GRANT and REVOKE use global validation because event metadata
omits their target objects, and those changes require READ COMMITTED. Disabling
the guard or skipping role preflight can stop adapters at runtime. The contract
belongs to [GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md#product-schema-registration).

### External Monitoring Not Configured

`POST /health` checks Gateway dependencies, not a complete gameplay or
settlement flow. No external monitor, notification destination or alerting
vendor is configured, so no alert reports Gateway dependency failures. Connect a
reviewed monitor to the health route, not to session creation, and follow
`ANALYTICS_MONITORING.md`.

### Origin Checks Are Not Identity Proof

`create-session` requires an allowed Origin and all routes use database-backed
rate limits. This blocks common cross-origin misuse but Origin is not an
unforgeable client identity. If production evidence shows Gateway abuse, evaluate edge protection,
device attestation, or a stronger issuance design with a privacy review.

### Forwarded Client Address Trust Is Unverified

The Gateway selects `cf-connecting-ip`, then `x-real-ip`, then the first
`x-forwarded-for` value, falling back to `unknown`. Which headers the hosted
ingress overwrites is not fully established. A ten-request direct hosted probe
rejected four forged `cf-connecting-ip` variants at Cloudflare (403 before the
Gateway); six accepted requests, including fake `x-real-ip` and forwarded chains,
incremented one common bucket. No injected or `unknown` bucket appeared. The
tested hostname had no AAAA record, so native IPv6 transport was not tested.
Worker subrequests remain untested. These observations support the direct path,
not a guarantee across every managed ingress path. Keep subject-based limits and
do not add a public header echo endpoint.

### Scoped Limit Capacity

The Gateway's per-player, Session, table and backend budgets are initial abuse
limits, not measured production capacity. Local tests do not prove hosted header
trust, real Auth or production capacity.

## Test Gaps

`npm run verify:release` requires native PostgreSQL 17 concurrency coverage and
a production build in addition to normal verification. PGlite alone is not a
release acceptance. Catalog configuration checks cannot certify hosted gameplay;
the real-service cases below remain separate.

Manual hosted coverage and remaining boundaries:

| Area | Verified | Still outside that verification |
| --- | --- | --- |
| Catalog Admin | Unpublished draft creation/readback/edit, sort-value persistence, invalid URL rejection, incomplete readiness blocking, retry after rejection, and ordinary Player Session denied Admin access | Successful publish/unpublish through the hosted UI and visible ordering changes; valid publish transitions are covered by native SQL tests |
| Game entry | Public Lobby browsing and allowlisted Lobby-to-Mahjong iframe launch; disabled `/play-test/` and `/entry/` reject access | Successful enabled independent entry in a hosted browser; native tests cover enabled entry, publication transitions, origin checks and permissions |
| Financial gameplay | Isolated snapshot capacity and retry/reconciliation checks described above | A new real Mahjong hand and reconciliation; the user will perform gameplay acceptance |
| Baccarat raises | One hosted raise of an open bet, its single final settlement and platform reconciliation | Hosted timeout retry, cancel at betting close, cancel before arrival, rejected raise and void after a raise; Joy8 and Baccarat automated tests cover them, and the user will test them once the game is more complete |
| Identity and mailbox | Automated Google-only access guards and atomic mail claim/retry checks | The user will test fresh outside-list Google rejection and hosted mail reward send/read/claim |
| Operations | Direct hosted IP-header probe and local snapshot restore described in this document | Production capacity, Worker/native IPv6 paths and managed backup/PITR recovery |

The temporary catalog draft used for hosted checks was removed. Those checks did
not publish test games, issue rewards or play a new hand. Browser smoke remains
mocked; manual coverage is not an automated end-to-end release gate. Modal focus
and keyboard accessibility also remain unverified.

## Database Recovery Boundary

A current empty-project bootstrap and native schema/data restore verification are
provided. The hosted snapshot tool restores Auth, platform and registered product
data locally and checks accounting and permission boundaries. These tools do not
re-create provider secrets, external game services or managed Supabase backup/PITR.
The Joy8 Dashboard currently shows the Free plan with no scheduled project backups;
PITR and restore-to-new-project are unavailable under that plan. There is no
managed restore point to exercise. A paid plan and suitable isolated restore
target must be arranged before claiming a managed recovery drill.
See [README.md](../../README.md#fresh-database-and-recovery) for commands and limits.


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
