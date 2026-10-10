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

- Hosted allowlist add/remove followed by session denial still needs a
  designated disposable Google identity. Catalog draft editing does not verify
  allowlist management; automated access/RLS tests cover the database boundary.
- Catalog publication is not completion of a game's own release acceptance.
  Each game tracks its open items in its repository, for example
  `D:/Studio/Project-Gaming/production/slot/products/monster-lab/docs/STATUS.md`.
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

### Game Credentials

Game Backend Keys and restricted product database logins have no expiry; they
stay valid until revoked. Replacement requires a reviewed operator action through
the [credential workflow](../../integrations/third-party/README.md#platform-operator-flow);
never write plaintext credential files into this repository. To withdraw a game,
disable its entry and keys first and preserve committed matches and audit data.

## Member Risks

Account closure and retention remain product decisions. Google is the only
supported member provider; Guest/Facebook/linking implementations are removed.


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

Three verified limits block slot-scale traffic. Each game may open 120 matches
per minute, about two slot Spins per second across all players. Server-route
ingress is counted by client address, and every Cloudflare Worker reaches the
Gateway from the same Cloudflare address, so Worker-hosted games share one
10,000-per-minute bucket. Counter rows are updated at the start of the server
transaction and stay locked until commit, so one game's server requests queue
behind each other. The unapplied redesign is
[RATE_LIMIT_REDESIGN.md](../../supabase/drafts/RATE_LIMIT_REDESIGN.md).

### Hosted Database Tail Latency

On the current compute, `joy8_server_request_v1` takes a median of about 56 ms
in PostgREST and the database, but its p90 is about 0.5 s and single calls
reached 5.6 s with one player and no lock contention (2026-10-09 Supabase
logs). The cause is not established; compare after a compute upgrade.

### Cloudflare Routing and Request Quota

From Taiwan HiNet, Free-plan custom hostnames such as `joy8.cc` and
`workers.dev` enter Cloudflare at San Jose, adding about 0.14 s per connection;
`*.pages.dev` and the Supabase Gateway enter at Taipei. Games therefore proxy
their browser traffic through their own Pages origin
([execution region](../platform/GAME_PLATFORM_INTEGRATION.md#execution-region)).
The Lobby on `joy8.cc` still loads through San Jose; gameplay calls do not.
Those proxies count against the account-wide Workers Free quota of 100,000
requests per UTC day; Baccarat's polling alone uses about 5,400 per player-hour.
When the quota runs out, proxied game traffic fails until the reset, so add
Workers Paid or reduce polling before wider play.

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
| Financial gameplay | Hosted Monster Lab rounds and a real Mahjong hand settled and reconciled with Joy8; isolated snapshot capacity and retry checks | Hosted production capacity |
| Baccarat raises | One hosted raise of an open bet, its single final settlement and platform reconciliation | Hosted timeout retry, cancel at betting close, cancel before arrival, rejected raise and void after a raise; Joy8 and Baccarat automated tests cover them, and the user will test them once the game is more complete |
| Identity and mailbox | Real inside-list Google signup and outside-list rejection; automated Google-only access guards and atomic mail claim/retry checks | Hosted allowlist add/remove with session denial, a real member's Lobby balance display, and hosted mail reward send/read/claim |
| Operations | Direct hosted IP-header probe and local snapshot restore described in this document | Production capacity, Worker/native IPv6 paths and managed backup/PITR recovery |

The temporary catalog draft used for hosted checks was removed. Those checks did
not publish test games, issue rewards or play a new hand. Browser smoke remains
mocked; manual coverage is not an automated end-to-end release gate. Modal focus
and keyboard accessibility also remain unverified.

On Windows, `npm run verify:release` has twice ended one PGlite suite with
exit code `0xC0000409` (a process crash, not an assertion). The suite passed
alone and the gate passed on rerun; the cause is not established.

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

### Temporary Trial-Link URL

釣魚大亨 (`fishing-ace`) launches from a Cloudflare quick tunnel
(`*.trycloudflare.com`). The address changes whenever that tunnel restarts,
and the Lobby card then opens a dead frame until the catalog URL is updated.
A fixed deployment such as `*.pages.dev` removes this. Its in-game BET and
test points are the game's own and never touch POINT.

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
