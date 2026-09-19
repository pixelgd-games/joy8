# Joy8

Joy8 is a lightweight H5 game platform. This repository contains the public Lobby, the Game Loader, the game administration pages, and the Joy8 Gateway Edge Function.

This file is the source of truth for the repository's current implementation. Product decisions, integration contracts, operational risks, and analytics plans live in the specialized documents listed below.

Last implementation review: 2026-09-20.

The platform includes public Lobby browsing, Google/guest member entry,
persistent player enrollment, six-digit public player IDs and one
server-authorized wallet/settlement flow.
The member migrations, four platform foundation migrations, session-scope
correction, Joy8 object rebrand, read-only member lookup, public-ID allocation
and product-schema registration are applied; the hosted `joy8-gateway` is active with the `server-v1`
product protocol.
The matching front end is released through main. Cloudflare Turnstile protects
anonymous Auth entry; real Google sign-in and guest entry passed hosted
acceptance. Public Email/password entry is disabled. Cloudflare Email Sending is
disabled, its two SMTP credentials were deleted, and the Workers Paid
subscription was canceled. Guest-to-Google linking and cross-browser guest
continuity remain outstanding.

Wallet-ledger cleanup, continuous per-hand settlement and the Mahjong private
schema are installed in Supabase. Mahjong has 22 product tables and a hidden
catalog entry. The private-entry migrations and identity-only activation are
installed; the game-scoped wallet opens at 0 POINT. Runtime login and a seven-day
exchange/renew backend key are configured in the game's ignored local environment.
TLS certificate/hostname verification and restricted access passed against hosted
Supabase. No wallet, AI funding or public entry was created by installation.
The key cannot open or settle matches; funded-play configuration remains pending.
Joy8's local `/play-test/` entry is available at `http://localhost:5173` and uses
normal member/guest authentication and backend entry configuration, with no
per-player test allowlist. The hosted `joy8-gateway` is active with the private
session route and continuous-settlement error mapping. Hosted health, rejection
and identity-key scope checks passed. The test-entry page is part of the standard
Cloudflare front-end build, but Mahjong's backend entry remains bound to localhost;
publishing this page does not publish or enable the Mahjong game. See the
[identity connection review](supabase/drafts/MAHJONG_REVIEW.md#identity-only-connection).
The [integration contract](docs/platform/GAME_PLATFORM_INTEGRATION.md#continuous-settlement)
owns the protocol; [Mahjong activation](supabase/drafts/MAHJONG_REVIEW.md) owns
the remaining configuration gates.

## Current Scope

Joy8 currently provides:

- A public mobile-first game Lobby.
- A database-backed game catalog exposed through `public_games_v1`.
- A Game Loader that creates a Joy8 session and embeds a selected game in an iframe.
- A reusable Lobby dialog for Google and persistent guest entry, with explicit
  player enrollment. `/account/` is a narrow Auth return trampoline back to that
  dialog. Google sign-in and guest entry passed real hosted acceptance;
  guest-to-Google linking remains unverified.
- A stable six-digit public player ID displayed as `Player 123456`, separate
  from the internal player UUID used by trusted platform and product backends.
- Google OAuth for game administration, with server-side administrator verification.
- CRUD pages for the `games` catalog.
- A Supabase Edge Function for trusted game backend authorization, scoped wallets, atomic settlement and runtime rate limits.
- Cloudflare Pages static deployment from the `main` branch.
- PWA metadata and install support for the Lobby.

Joy8 does not currently provide:

- Public Email/password signup, sign-in, verification, or recovery.
- Verified guest-to-Google linking or branded cross-origin handoff.
- Production money movement.
- Full analytics, dashboards, or unattended alerting.
- A game runtime or game-specific business logic.
- CrazyGames integration inside this repository.

See [PRODUCT_SCOPE.md](docs/product/PRODUCT_SCOPE.md) for the H5 release,
both product models, operational POINT direction, and platform -> product ->
integration order. The member foundation starts the platform stage; scoped wallets,
trusted settlement and health are deployed. Mahjong has identity-only activation;
no product has completed hosted gameplay/settlement acceptance. Real product
integration and guest-to-Google provider-linking acceptance remain outstanding.

### Platform Foundation

The platform has one deployed server-authorized accounting flow. It removes browser exchange/bet/payout/
refund/close-round routes, their RPCs, automatic Demo credit and the obsolete
wallet-mode branch. Tests use isolated local data with the same protocol.
There is no runtime fallback for an unconfigured game.

It includes both wallet scopes, default 0 POINT provisioning, game-scoped backend
keys, one-time backend exchange, balance-only client tokens, renewal, reservations,
atomic settlement, cancellation/status and dependency health. Product policy and
keys are configured separately; Mahjong currently has an identity-only policy
and exchange/renew key. Financial activation requires product configuration and
acceptance. Game clients must adopt this contract; the Lobby and member UI remain
available independently.

The approved reset removed test wallets, ledger, sessions and old rounds. Auth
identities, player records, catalog and administrator records matched their
pre-deployment count/hash snapshots. No test balance was carried forward.
The four platform foundation migrations and the incremental session-scope
correction are in supabase/migrations/.
Protocol details belong in [GAME_PLATFORM_INTEGRATION.md](docs/platform/GAME_PLATFORM_INTEGRATION.md#operational-protocol-v1).

## Architecture

```text
Browser
  ├─ Lobby ─────────────── public_games_v1
  ├─ Member entry ──────── Supabase Auth + Gateway member/enroll-member
  ├─ Admin pages ───────── games + is_joy8_admin()
  └─ Game Loader
       ├─ published entry: public_games_v1 + Gateway create-session
       ├─ test entry: Gateway private-session + backend entry configuration
       └─ game iframe
            ├─ Gateway balance (in-memory balance token, if supplied)
            └─ game backend (one-use launch exchange and financial requests)
                 └─ Gateway server-*-v1
                      └─ service-role database RPCs
```

The front end is a Vite multi-page application written in vanilla JavaScript and
CSS. Admin/catalog use the existing Supabase client. Member entry and launch use
a separate PKCE client with storage key `joy8-member-auth-v1`; Auth session
storage is platform-owned and never passed into games. The Gateway is the only
public path to protected player, game-session, and wallet RPCs. Separate browser
storage does not grant administrator or player eligibility.

### Browser Entries

| Route | Entry | Responsibility |
| --- | --- | --- |
| `/` | `index.html` | Public Lobby |
| `/account/` | `account/index.html` | Auth return trampoline that restores the Lobby member dialog |
| `/game/` | `game/index.html` | Published-game Loader and iframe shell |
| `/play-test/` | `play-test/index.html` | Local test entry using normal membership and the shared Loader; no player allowlist |
| `/admin/login/` | `admin/login/index.html` | Google OAuth entry |
| `/admin/games/` | `admin/games/index.html` | Game list |
| `/admin/games/new/` | `admin/games/new/index.html` | Create game |
| `/admin/games/edit/` | `admin/games/edit/index.html` | Edit game |

Vite declares these entries in `vite.config.js`.

### Source Map

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Lobby bootstrap |
| `src/pages/lobby/` | Lobby data loading, rendering, and layout |
| `src/pages/game/` | Game lookup, session creation, and iframe handling |
| `src/admin/` | Admin authentication and game CRUD |
| `src/admin/login.js` | Explicit admin login-page bootstrap; shared auth imports have no page startup side effects |
| `src/lib/supabaseClient.js` | Shared browser Supabase client |
| `src/lib/memberClient.js` | Separate member Auth session and Gateway client |
| `src/member/` | H5 member UI and testable authentication flow |
| `src/lib/urls.js` | URL helpers |
| `src/ui/error-modal.js` | Shared error presentation |
| `src/styles/` | Shared tokens plus theme, Lobby, Loader and error-modal styles |
| `supabase/functions/joy8-gateway/index.ts` | Gateway Edge Function |
| `supabase/migrations/` | Incremental database migrations |
| `supabase/drafts/` | Unapproved SQL excluded from automatic migration discovery |
| `scripts/` | Local verification and Supabase routing helpers |
| `public/games/<slug>/cover.webp` | Joy8-managed Lobby covers |

## Runtime Flows

`src/styles/tokens.css` owns the shared font and palette. Loader and error-modal
styles consume those tokens without applying the Lobby's page layout to Admin.
Lobby account/game entry shares one pending guard, including lazy dialog loading.

### Lobby

1. The Lobby reads published games from `public_games_v1`.
   The platform entry is `/`: browsing the Lobby does not require login or open
   an authentication page. The top-bar account control shows `登入` when signed
   out. An enrolled player with a public ID sees `Player 123456`; the account-type
   label is only a temporary fallback while membership is unavailable or resolving.
   The label follows Auth session changes and does not grant player eligibility.
   The control opens the shared member UI
   in a dismissible dialog; the Lobby remains visible and its URL is unchanged.
   The dialog offers Google entry and explicit guest play. `/account/` safely
   returns Auth callbacks to the same Lobby dialog instead of rendering a second
   standalone account page.
2. Cards are rendered from database metadata.
3. Selecting a game checks membership. Enrolled registered players and persistent
   guests continue to `/game/?slug=<slug>`. Other visitors see the member dialog
   over the Lobby, with the chosen game named in the dialog. Google or
   explicit guest entry preserves that game destination. Closing cancels it;
   another game or the top-bar login starts a new selection.
4. Missing cover images use the platform fallback behavior.

The responsive Lobby uses four columns on touch devices with a low-height landscape viewport. Desktop and mobile portrait layouts remain separate.

### Game Launch

1. The Loader reads `slug` from the URL.
   A direct link with missing member session/enrollment redirects to `/?play=<slug>`.
   The Lobby validates that the game is published, clears the temporary query,
   and opens the member dialog. Backend failures stop launch visibly.
2. It loads the matching published game from `public_games_v1`.
3. It normalizes `launch_url` as an HTTPS URL or a root-relative platform path. HTTP is accepted only between loopback hosts during local development.
4. It calls `joy8-gateway/create-session`.
5. It creates the iframe from the catalog URL without putting launch credentials in that URL.
6. The game announces its Joy8 Client from an approved parent origin, then the
   Loader delivers the session parameters once through an origin-checked in-memory message.

The iframe receives this launch payload through `postMessage`:

- `joy8_session_id`
- `joy8_launch_code`
- `joy8_game_id`
- `joy8_currency`
- `joy8_protocol` (`server-v1`)
- `joy8_gateway_url`

The launch code is single-use and valid for two minutes. It never enters the
game URL, HTTP request, browser storage or Analytics. The trusted game backend
exchanges it for an in-memory, balance-only token valid for at most 15 minutes
and no later than session expiry. The Loader never passes a Supabase anonymous
key, member JWT, or service-role key into the iframe.

The full game-facing contract is in `docs/platform/GAME_PLATFORM_INTEGRATION.md`.

### Member Entry

Google uses PKCE and explicit callback exchange. The public member UI does not
offer Email/password signup, sign-in, verification, or recovery. Guest creation
uses Cloudflare Turnstile and Web Locks across tabs, and fails closed without the
required browser capability. Logout is local to the selected Auth session and
does not create a replacement guest. Clearing storage can lose guest access.
Guest-to-Google linking must preserve the original player and every wallet scope;
hosted linking acceptance is still pending.

The local member client bounds Turnstile script loading to 15 seconds and the
complete token attempt to 45 seconds. Failure removes the failed script/widget,
unlocks the controls and permits an explicit retry. Closing the dialog cancels
its attempt; late callbacks cannot complete a newer attempt. This local change
still requires front-end release and hosted acceptance.

The Auth trampoline currently forwards the one-use OAuth code from `/account/`
to the Lobby callback query. The Lobby removes that query before loading the
member dialog. This does not remove the initial request from infrastructure
logs; do not collect callback queries in analytics or access-log exports.

`POST /member` resolves existing enrollment; `POST /enroll-member` explicitly
enrolls the authenticated identity. Both take an empty JSON object, require an
allowed Origin and server-verified bearer token, and return
`{ "member": { "player_account_ref": "...", "public_id": "482731", "account_type": "guest|registered" } }`.
`player_account_ref` is the internal UUID used for authorization and backend
mapping. `public_id` is a unique six-digit presentation identifier rendered as
`Player 482731`; it is not a credential, launch field, or settlement key.
The read route may return `{ "member": null }`. The member migrations preserve player
IDs, derive guest status from Auth, reject inactive accounts, and grant RPC
execution only to the service role. Neither member route provisions a wallet.

### Administration

1. An administrator signs in with Google OAuth.
2. The browser calls `is_joy8_admin()`.
3. Authorized users can list, create, edit, publish, and unpublish catalog records.
4. Public users read only the safe fields exposed by `public_games_v1`.

The front end does not write player, wallet, match, settlement, or session tables directly.

## Gateway

The hosted `joy8-gateway` implements these POST routes:

- member, enroll-member, create-session, private-session, balance, health.
- server-exchange-v1, server-renew-v1, server-open-v1,
  server-settle-v1, server-status-v1, server-cancel-v1.

The public base URL is:

```text
https://lsazydefvnuqglultqii.supabase.co/functions/v1/joy8-gateway
```

Current safeguards include:

- Route and HTTP method validation.
- Origin and CORS validation.
- A 16 KiB streamed request-body limit.
- Launch-code and Gateway-token hashing.
- Token scope and session validation.
- Database-backed runtime rate limits.
- A 5-second authentication timeout and an 8-second RPC timeout.
- POINT validation and trusted per-game wallet policy.
- Idempotent atomic match settlement.
- Game-scoped backend keys and reservation/participant isolation.
- `Cache-Control: no-store` on every JSON response, including launch and renewed tokens.

The Gateway uses `verify_jwt=false` because it performs its own launch-code, token, origin, scope, session, and rate-limit checks. Its protected database RPCs are granted only to `service_role`.

## Database

The Joy8 Supabase project is `Joy8`, ref `lsazydefvnuqglultqii`.

The replacement retains games, admin_users, public_games_v1, player_accounts,
wallet_accounts, wallet_transactions, game_sessions and gateway_rate_limits.
It introduces trusted policies/backend keys, matches, participants, settlements,
settlement entries and fee accounts. The old game_rounds table has been removed.

The deployed ledger uses `wallet_transactions.match_ref`; the unused `metadata`
column is removed. The incremental cleanup preserves ledger values and grants.
Continuous settlement retains occupancy between hands and releases on final/cancel.
Historical single-posting fixtures remain useful for migration regression tests.

Protected tables use RLS and service-only RPCs. Products receive no project-wide
service-role key. A wallet belongs to one trusted platform/game policy and remains
unique even if frozen or closed. POINT starts at 0 pending a later grant decision.
There is no conversion, purchase or withdrawal API. Product gameplay data and any
AI accounting adapter remain in a permission-separated product schema.

The hosted prelaunch dataset has two retained Auth accounts and no player,
wallet, game-session, transaction, match or settlement rows. Retained Auth
identities and login sessions, the administrator allowlist, eight catalog entries
and system configuration are unchanged. A retained account receives a new player
profile and public ID on its next explicit enrollment. Mahjong has an identity-only
policy and expiring exchange/renew key. Before funded product activation, review
its scope, limits, key and adapter against the integration contract.

The repository has no baseline migration. Existing migrations are incremental
and cannot reconstruct the full local database alone. Three incomplete Mahjong
drafts are in `supabase/drafts/mahjong-clash/` and remain superseded and unapplied.
Do not promote them alongside the installed schema; see the
[installation review](supabase/drafts/MAHJONG_REVIEW.md).
All 46 local and hosted migration records match, including the Joy8 rebrand,
the eight Mahjong
installation migrations, two private-entry/identity-activation migrations and
the removal of the empty test-player allowlist, read-only membership lookup and
cross-product adapter isolation, public player IDs, candidate-scoped ID allocation,
first-enrollment profile visibility, product-schema registration, automatic DDL
validation, rejected-candidate lock cleanup, optimized adapter validation and
the authorized prelaunch player/account cleanup. The cleanup checks verified
both retained Auth accounts and their login records against the local backup,
with all eleven catalog/admin/configuration tables unchanged. Its backup remains
local and is excluded from Git. Mahjong's private schema and effective permissions
passed hosted postflight; live game/provider acceptance is still pending.
Review blockers are tracked in [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md).

## Local Development

Requirements:

- Node.js 22, using the version in `.node-version`.
- A local `.env.local` containing:

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Do not commit or quote real credentials. A local Vite server still uses the
database configured in `.env.local`; localhost alone does not isolate data.
The full local Supabase stack is not yet reproducible from this repository.
The member SQL checks below use a small isolated fixture and synthetic data.
See the environment direction in [PRODUCT_SCOPE.md](docs/product/PRODUCT_SCOPE.md)
and the recovery limitation in [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md).

Install and run:

```powershell
npm install
npm run dev
```

Production build and local preview:

```powershell
npm run build
npm run preview
```

## Verification

Use the checks that match the change:

`npm run verify` is the combined local acceptance command: it checks literal SQL
dependency paths, runs member/captcha/iframe and deployed-schema suites, checks the
Gateway, builds production assets and runs browser smoke. It fails on the first
unsuccessful stage. Chrome or Edge is required for smoke. It does not apply SQL or
publish code; the browser checks read the catalog and mock member/session writes.

```powershell
npm audit
npm run build
npm run smoke
npm run test:gateway
npm run test:member
npm run test:captcha
npm run test:iframe
npm run test:member-db
npm run test:public-id
npm run test:member-product-db
npm run test:product-ddl
npm run test:session-scope
npm run test:ledger-cleanup
npm run test:platform-db
npm run test:continuous-db
node --test scripts/private-entry-check.mjs
node --test scripts/player-cleanup-check.mjs
```

`test:member-db` loads the member migrations, four platform foundation migrations
and deployed session-scope correction, member-read hardening, adapter isolation
and current public-ID allocation and schema-registration migrations in an in-memory PGlite database with pgcrypto
and a minimal Auth/catalog fixture. It never reads environment credentials or connects to Supabase.
Its 18 checks cover enrollment without wallet creation, read-only membership
lookup, zero-POINT launch without automatic grants, shared and independent wallets, guest promotion preserving both
wallet scopes and actual reservations/ledger, inactive accounts, browser-role denial,
secret hashing/expiry, uniqueness, transaction rollback and disabled/missing policies.
It asserts that the obsolete round table, wallet mode and Demo-credit function are absent.
PGlite 0.5.8 uses PostgreSQL 18.3 and one connection; this is not validation of
hosted PostgreSQL 17 concurrency, Supabase Auth internals, or provider behavior.
The fixture is test-only, not a baseline migration or hosted deployment script.

`test:public-id` has two checks covering stable unique IDs for existing and new
players plus service-role-only member-profile resolution. It does not prove
allocator behavior at the six-digit namespace limit or replace hosted migration
verification.

The shared member/platform fixtures include the deployed public-ID allocator and
product-schema registry, including in their PostgreSQL concurrency suites. `test:captcha`
covers silent callbacks, bounded script loading, retry, cancellation, expired
challenges and stale callbacks. Browser smoke additionally verifies that a
timed-out challenge unlocks member controls and the same panel can retry.

`npm run test:member-product-db` verifies candidate-scoped allocation,
first-enrollment profile visibility and product-schema registration on PGlite.
With `JOY8_TEST_PG_BIN` configured, `npm run test:member-product-pg` runs the same
cases plus competing allocations on native PostgreSQL 17. These commands never
apply hosted SQL. The installed corrections preserve existing public IDs and
use no browser retry workaround or alternate runtime.

`test:iframe` verifies load/handshake ordering, the shared 30-second deadline,
slow readiness without a premature 10-second cutoff, visible timeout, rejected sources,
late messages, failed delivery and the opaque-origin sandbox contract. Browser
smoke verifies the actual timeout error screen and removal of the failed iframe.
The Loader hides its waiting display only after both load and credential delivery.

Automatic DDL validation at commit, collision-lock cleanup and the faster runtime
permission query are installed as incremental migrations. Default member fixtures
load the current allocator; platform fixtures also load DDL and adapter validation
through `scripts/fixtures/platform-hardening.mjs` in migration order.
With PostgreSQL 17 configured, `npm run test:hardening-pg` runs member/platform/
continuous/private acceptance, DDL rollback, competing allocation and prelaunch
cleanup checks. `player-cleanup-check.mjs` verifies rejection of changed cleanup
targets or unexpected gameplay and preservation of retained Auth records,
administrator access, catalog and configuration. It uses isolated fixture data;
it never connects to the hosted database.
`npm run benchmark:adapter` compares the historical baseline and current queries
and committed settlement latency with 1, 5 and 10 synthetic product schemas.
It reports median/P95 over 100 samples after warmup; it is not a hosted Mahjong
capacity test and excludes Gateway and gameplay execution. Historical definitions
are used only by this isolated comparison; there is no runtime fallback.

Hosted postflight verified the installed function bodies, fixed search
paths, protected grants, both registration triggers, the DDL event/deferred
triggers, empty validation queue and Mahjong registry entry.
Identity/catalog/player/public-ID/accounting snapshots matched and all
reconciliation anomalies were zero. No business records were created by these
checks. Real provider entry after this correction remains separate acceptance.

`test:platform-db` uses the same deployed platform schema with its accounting fixtures.
Its 21 SQL cases cover both wallet models, zero credit, one-time provisioning,
server authority, renewal, reservation and available balance, exactly-once
settlement, draws, fees, frozen wallets, immutable accounting, adapter permissions,
cross-product adapter isolation and injected product failure with rollback of player/product/fee/commit records.
They also verify reset boundaries, removed legacy RPCs and missing-policy rejection. The simulated product adapter is test-only, not a Mahjong implementation.

The same command runs three cutover guard checks: non-test sessions, outstanding
reservations and external cascading foreign keys must abort the reset while
retaining the original data and schema (24 PGlite cases in total).

With `JOY8_TEST_PG_BIN` set as below, `npm run test:platform-pg` runs those cases
plus eight actual competing-connection cases on native PostgreSQL 17.6 (29 cases).
They observe database lock waits for launch, occupancy, duplicate/changed
settlement, both freeze orderings, key revocation, and rollback/retry. These
checks do not constitute hosted integration, full Supabase bootstrap, load
testing, or backup restoration. Gateway mock tests cover the six server routes,
browser rejection, body bounds, safe error mapping and dependency health.

`test:ledger-cleanup` has seven isolated checks for metadata/open-match rejection,
migration ordering, data/balance/permission preservation, actual service-role settlement,
exact retries and immutable ledger protections. `test:ledger-cleanup-pg` runs the
same checks on PostgreSQL 17. The cleanup function differs from the deployed
settlement body only in its ledger column name; the test compares the definitions.

`test:continuous-db` explicitly loads the installed ledger cleanup and extension into the isolated
PGlite fixture. Its 18 cases cover per-hand posting, final release, rolling human
and AI reservations, replay/order rejection, zero-reserve occupancy, expired
sessions, backend rotation, cancellation, frozen wallets, permissions, rollback,
immutable records and the open-table application guard. With `JOY8_TEST_PG_BIN`
set as below, `npm run test:continuous-pg` runs the same cases and seven observed
lock-contention cases on PostgreSQL 17.6 (25 cases total). These tests neither apply
hosted SQL nor implement Mahjong's durable adapter; the foundational single-posting
contract remains separately exercised by `test:platform-db`.

`test:member-pg` runs the same 18 checks plus 15 competing-connection checks
against a fresh native PostgreSQL 17 cluster. It has passed on PostgreSQL 17.6.
The race tests observe actual blocked database connections before releasing the
held transaction. They also verify that read-only membership lookup does not wait
on a player-row update. The remaining cases cover simultaneous enrollment, launch/promotion/freeze
orderings separately for both wallet scopes, mixed shared/independent game launches,
enrollment rollback and independent identities. These are deterministic fixture
cases, not a load test or proof of hosted Auth behavior. Historical migrations
remain necessary to construct the fixture and verify cutover; they are not the
schema used for current member acceptance. Nonzero policy grants exist only in
isolated preservation/accounting cases and do not authorize operational credit.

`test:session-scope` uses the deployed platform fixture, including
`supabase/migrations/20260917100000_active_session_scope.sql`, and reapplies that
correction to verify unchanged data and permissions.
Its 12 checks cover the corrected balance default, null/unsupported scopes,
token scope, invalid/expired credentials, revoked sessions, inactive players/wallets,
unchanged stored data and internal-helper permissions. It uses PGlite by default;
with `JOY8_TEST_PG_BIN` configured, run `npm run test:session-scope-pg`
to run the same checks on native PostgreSQL 17.6. Both engines
pass. The same correction is loaded by member/platform acceptance tests.
The internal helper defaults to `balance`; explicit null or other scopes still
return no session. The existing balance caller and internal-only permissions are
unchanged. Hosted definition, grants and before/after record counts were verified
through `scripts/sql/session-scope-verification.sql`. This is not a hosted gameplay
test. Gateway publication was not required for the database-only correction.

Set `JOY8_TEST_PG_BIN` to an absolute directory containing PostgreSQL 17's
`postgres`, `initdb`, and `pg_ctl` executables, then run the relevant `test:*-pg` command.
All PostgreSQL entry scripts use the same runner and set
`JOY8_TEST_ENGINE=postgres17`; no separate member/platform engine setting is used.
The shared database factory accepts only `pglite` or `postgres17` and defaults to
PGlite. Historical cutover guard tests explicitly use PGlite.
The helper creates an isolated temporary cluster, binds only to `127.0.0.1` on
an available port, generates a temporary password, and stops/removes its cluster
after the tests. It takes no database URL and never reads `.env` credentials.
It does not install a Windows service or require Docker. On Windows, the tested
portable runtime can be prepared outside the repository with:

```powershell
$joy8PgTools = Join-Path $env:TEMP 'joy8-pg17-tools'
npm install --prefix $joy8PgTools --ignore-scripts --no-audit --no-fund --save-exact '@embedded-postgres/windows-x64@17.6.0-beta.15'
$env:JOY8_TEST_PG_BIN = Join-Path $joy8PgTools 'node_modules\@embedded-postgres\windows-x64\native\bin'
npm run test:member-pg
npm run test:session-scope-pg
npm run test:ledger-cleanup-pg
npm run test:platform-pg
npm run test:continuous-pg
```

Member unit checks use mocked Auth/Gateway services; browser smoke checks cover
the shared Google/guest member dialog, cancellation/reselection, provider return
destinations, safe direct-link entry, simulated guest controls, public-ID account
labels, and 320/390/1280 px layouts. They do not verify hosted OAuth, actual
database concurrency, grants, wallet preservation, or provider linking.
Private-entry verification additionally covers explicit start, denied access,
retry and the shared Loader credential boundary. Its eleven isolated SQL tests
pass on PGlite and PostgreSQL 17; the latter verifies an actual restricted
password login. Hosted postflight confirms hidden Mahjong, enabled zero-credit policy, restricted
LOGIN and an exchange/renew-only expiring key. Test entry accepts active enrolled
guests and registered members without individual approval. The runtime
TLS/readiness check passed without creating sessions or funding. Credentials
expire on 2026-09-25 at 15:25 Asia/Taipei; renewal requires reviewed provisioning.
`supabase/config.toml` includes local password-provider settings for Auth-stack
testing, but the public product does not expose an Email/password flow and this
file does not change the hosted project. Production provider and abuse settings
remain a release gate.

Hosted acceptance verifies dependency health, browser/server authorization
rejection, removed legacy routes and database grants. Identity/catalog snapshots
matched across cutover; postflight and reconciliation counts passed. Member
acceptance verified real guest enrollment, repeated entry and standalone Google
sign-in. Email/password entry is not part of the current product. After the
accounting reset, game play requires an activated product backend; no product
match has been accepted against hosted settlement yet. Guest-to-Google linking
and cross-browser guest continuity remain unverified.

`npm run smoke:gateway` tests the replacement health and rejection paths only. It creates no business data but changes runtime rate counters. Hosted execution requires `ALLOW_PRODUCTION_GATEWAY_SMOKE=1` and approval. The deployed Gateway health/rejection check passed.

For Markdown-only changes, validate document links, paths, language, and architecture claims; a production build is not required unless implementation files also changed.

## Supabase Operations

Joy8 uses a project-specific wrapper:

```powershell
.\scripts\supabase-joy8.cmd projects list
```

The result must show:

```text
Joy8 / lsazydefvnuqglultqii / linked: true
```

Do not continue if the active CLI state points only to Aura or another project. Database changes require a small user-reviewed migration before application. See `AGENTS.md` for the complete safety rules.

### Hosted Auth Configuration

Verified in the Joy8 dashboard on 2026-09-20 using the user-authorized Chrome
session for `pixelgd.games@gmail.com`, organization Pixel GD, project
`lsazydefvnuqglultqii`:

- The public member UI uses Google and anonymous Auth only. It exposes no
  Email/password signup, sign-in, verification, or recovery action.
- Anonymous sign-in and manual identity linking are enabled and saved.
- Site URL is `https://joy8.cc`.
- Admin redirect allowlist entries are `https://joy8.pages.dev/admin/login/`,
  `https://joy8.cc/admin/login/`, `https://www.joy8.cc/admin/login/`, and
  `http://localhost:5173/admin/login/`.
- Member redirect allowlist entries are `https://joy8.pages.dev/account/*`,
  `https://joy8.cc/account/*`, `https://www.joy8.cc/account/*`,
  `http://127.0.0.1:5173/account/*`, `http://localhost:5173/account/*`,
  `http://127.0.0.1:4173/account/*`, and `http://localhost:4173/account/*`.
  The suffix accommodates the encoded `next` and `flow` query parameters while
  keeping the host and member route fixed. The allowlist contains 11 entries in
  total; all former Looty callback URLs have been removed.
- Cloudflare Email Sending is disabled and its two SMTP credentials were
  deleted. The Workers Paid subscription was canceled because the current
  Google/guest flow does not require outbound authentication email.
- Cloudflare Turnstile Managed protection is enabled for Auth on `joy8.cc` and
  its subdomains. The public site key is used by the member client; the secret
  exists only in Cloudflare and Supabase. Production Turnstile verification,
  Google sign-in and guest entry passed. Guest-to-Google linking and
  cross-browser guest continuity still require end-to-end acceptance.

The CLI wrapper still supports project/migration listing and database reads;
its combined `config diff` read was denied. The authorized dashboard inspection
resolved the member-settings visibility gap without replacing the local token.
It does not establish that the CLI now has configuration read/write access.

## Deployment

- Hosting: Cloudflare Pages.
- Production branch: `main`.
- Production hostnames: `joy8.cc` and `www.joy8.cc`. The Pages deployment URL
  `joy8.pages.dev` redirects to the canonical `https://joy8.cc` host while
  preserving the path, query, and fragment.
- Build command: `npm run build`.
- Output directory: `dist`.
- Required production variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `public/_headers` denies framing of Joy8 pages and supplies the production
  content-type and referrer protections copied into the Cloudflare Pages build.

A push to `main` triggers production deployment. Do not push documentation or code changes unless the user explicitly requests it.

Joy8 remains on Cloudflare Pages. Mahjong H5 is planned for separate static
hosting on Cloudflare, but it is not part of the current Joy8 deployment and
still requires its own asset/readiness review. Godot remains local during
development; GCP/VPS selection and payment are deferred until external
multiplayer testing requires an always-on server.

The Supabase `joy8-gateway` Edge Function is deployed separately from Cloudflare
Pages. The former `looty-gateway` function and `looty-git` Pages project were
removed after the Joy8 production cutover was verified. The production gateway
smoke test passed without creating an identity, wallet, session, or settlement.

## Game and Asset Boundaries

- Joy8 owns the catalog, Loader, iframe shell, platform error states, and Lobby covers.
- A game owns its rendering, assets, CSP, `X-Frame-Options`, and sandbox compatibility.
- Game source changes must be made in the named game repository, not here.
- Lobby covers use `750 x 1000` WebP at `public/games/<slug>/cover.webp`.
- Read `D:\Studio\Project_Art\README.md` before creating, moving, or exporting any asset.

## Documentation Map

| Document | Owns |
| --- | --- |
| `AGENTS.md` | AI workflow, fixed rules, safety, and document routing |
| `CLAUDE.md` | Thin Claude Code entry that points back to `AGENTS.md` |
| `README.md` | Current repository implementation and operation |
| `docs/product/PRODUCT_SCOPE.md` | Product boundaries, approved direction, and priorities |
| `docs/platform/GAME_PLATFORM_INTEGRATION.md` | Joy8-to-game runtime contract |
| `docs/platform/MEMBER_AUTH_PLAN.md` | Platform-wide member, persistent guest, game-wallet relationship, and branded-entry plan |
| `docs/platform/CRAZYGAMES_INTEGRATION.md` | CrazyGames build and submission requirements |
| `docs/platform/FLASH.md` | Stable cross-module Flash context |
| `docs/operations/KNOWN_ISSUES.md` | Active limitations, risks, and launch blockers |
| `docs/operations/ANALYTICS_MONITORING.md` | Analytics, KPI, logging, dashboards, and alerts |

Do not copy whole sections between these documents. Link to the owning document when another subject needs context.
