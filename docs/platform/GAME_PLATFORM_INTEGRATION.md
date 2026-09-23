# Joy8 Game Platform Integration

This document is the authoritative runtime contract between Joy8 and a game. It defines platform selection, launch parameters, Gateway requests, wallet behavior, and responsibility boundaries.

It does not own member-entry design, CrazyGames submission rules, repository setup, or deployment history.

Current source reviewed: 2026-09-23. The server-authorized base and continuous
per-hand settlement extension are installed in the hosted database. The Gateway
function `joy8-gateway` includes private entry, branded entry and the
settlement-error mappings; the service-only branded-entry resolver is installed.
The current product protocol is `server-v1`.
The full-balance table reservation policy is installed in the hosted database.
See [README.md](../../README.md) for verification and product-activation limits.
There is no
old/new compatibility path in the replacement. Existing game clients must adopt
this protocol in their own repositories before activation.

## Core Rule

Repository entry cleanup removes `branded-session` and route-less session
creation; both branded and explicit test entry call `private-session`.
The frontend and Gateway changes await coordinated release. Hosted origin bindings
and the pending safety migrations are tracked in README and `supabase/drafts/README.md`.

The current `server-v1` contract still asserts `wallet_scope: platform` and the
read-only `balance` token scope. These are fixed authority checks, not selectable
wallet modes or fallback behavior. Removing them would change the game-facing
protocol and requires coordinated game-repository work. The service-only database
session issuer still has its historical currency, expiry and display-name
parameters; Gateway supplies fixed POINT, 3600 seconds and null. They are not
accepted from the browser. Database signature/column removal remains a separate
reviewed migration; applied SQL history is never rewritten for cleanup.

A game owns gameplay. Joy8 owns platform identity, session authorization, wallet authority, the Loader shell, and platform-level errors.

A game must never:

- Log a player into Joy8.
- Receive identity-provider credentials.
- Receive a Supabase anonymous key, member JWT, or service-role key from the Loader.
- Write Joy8 player, wallet, session, match, settlement, or transaction tables.
- Change a player balance directly.
- Store a Joy8 launch code or Gateway token in local storage, session storage, IndexedDB, logs, Analytics, or save data.

## Platform Clients

A non-gambling game that targets multiple platforms should keep one gameplay core and use an explicit platform client:

| Client | Use |
| --- | --- |
| Joy8 Client | Joy8 launch parameters and Joy8 Gateway |
| CrazyGames Client | CrazyGames SDK, ads, saves, and platform lifecycle |
| Local Client | Local development and contract simulation only |

Only one platform client may be active during a session.

Selection must use an explicit build target or an equally reliable platform signal. Iframe presence is not enough because Joy8 and CrazyGames may both embed games.

The Local Client must never activate automatically after a production client fails to initialize. A real-platform failure must produce a visible error.

Gambling products do not receive a CrazyGames Client or build. Every product in `D:\Studio\Project-Gaming` remains gambling unless the user explicitly moves and reclassifies it.

CrazyGames-specific requirements are in `CRAZYGAMES_INTEGRATION.md`.

## Responsibility Matrix

| Concern | Joy8 Platform | Game |
| --- | --- | --- |
| Game catalog and published status | Owns | Does not own |
| Member or guest identity | Owns | Does not own |
| Session and token issuance | Owns | Consumes |
| Wallet balance and transactions | Owns | Reads through authorized sessions; operational mutations require a trusted backend |
| Loader iframe shell | Owns | Does not own |
| Sandbox and `allow` permissions | Owns | Must remain compatible |
| Platform load timeout and error screen | Owns | Installs the credential receiver before loading its runtime; gameplay readiness remains separate |
| CSP and `X-Frame-Options` | Reports failures | Owns |
| Rendering and resources | Does not own | Owns |
| Gameplay rules | Does not own | Owns |
| Financial match and settlement summary | Owns | Supplies stable match references through authorized calls |
| Authoritative rooms, matches, hands, actions, results, and history | Does not own | Owns in its game database |
| Game-specific save data | Provides a platform adapter when applicable | Owns the payload |

Do not modify a game repository from a Joy8 repository task. Switch to the named game repository for game-side changes.

## Official SDK and Provider Kit

Joy8 supplies two maintained integration artifacts in this repository:

- [`@joy8/game-sdk`](../../packages/joy8-game-sdk/README.md), with separate
  browser and trusted-server entry points.
- The [third-party integration kit](../../integrations/third-party/README.md),
  including a non-secret game profile, concise API reference, examples, an
  acceptance checklist and an independent-AI handoff template.

Until a registry release is approved, Joy8 distributes a versioned npm tarball
built from this repository. The SDK validates and maps the current contract; it
does not own gameplay state, invent match references, retry financial requests
automatically or replace this authoritative wire specification.

## Joy8 Launch Flow

1. A player opens `/game/?slug=<slug>`.
   The Lobby checks membership before navigating there. Missing member
   session/enrollment on a direct link returns to `/?play=<slug>`, where the
   published game is selected and the shared member dialog opens over the Lobby.
   Entry UX and cancellation rules belong to `MEMBER_AUTH_PLAN.md`.
2. The Loader reads the published game from `public_games_v1`.
3. It normalizes the `launch_url`. Root-relative platform paths and HTTPS URLs are accepted. HTTP is accepted only between loopback hosts during local development.
4. It calls `joy8-gateway/create-session`.
5. The Gateway requires a verified Supabase user session and existing enrollment,
   including a persistent anonymous Auth session for guests.
6. The reviewed session RPC resolves the enrolled platform player and configured wallet.
7. The Loader creates the iframe from the catalog URL without launch parameters.
8. The game announces a ready Joy8 Client from an approved parent origin; the
   Loader verifies that frame and delivers the launch payload once in memory.
9. The game backend exchanges the launch code once, then gives the client a balance-only token.
10. The client keeps that token in memory; financial operations belong to the game backend.

The current Loader requests `POINT` with a one-hour session expiry.

## Loader In-Memory Handoff

### Private test entry

Joy8's `/play-test/?slug=...` uses the same member flow and iframe shell.
`POST /private-session` accepts only `{ "slug": "..." }` with a verified member
bearer and an allowed browser Origin. Its service-only RPC checks backend entry
configuration, exact Origin and hidden catalog status. Every active enrolled
member, including a persistent guest, can enter; there is no per-player allowlist.
Only then does the shared internal session issuer resolve a wallet and issue a
one-use launch code. The response additionally includes backend-owned `game_name`
and `launch_url`; the browser cannot select the URL or identity. It uses no-store.
The public `create-session` path remains restricted to published games.

Here “private” means a hidden catalog integration entry, not tester-only access.
Any enrolled member or guest can request it when enabled. Origin validation is a
browser boundary, not unforgeable identity proof; localhost bindings do not isolate
the hosted database. Public access requires explicit entry activation review.

The current local Mahjong binding uses Joy8 `http://localhost:5173` and game
`http://localhost:4391/`. Entry configuration remains backend-controlled. The
private entry and Gateway are installed; real game acceptance remains pending.
See the [review](../../supabase/drafts/MAHJONG_REVIEW.md).

### Branded H5 entry

Joy8's `/entry/?slug=...` is a platform-controlled shell with no visible Joy8
lobby. It loads the game iframe first so the player sees the game's login art.
The iframe may send only `{type:"joy8-entry-request-v1",method:"google"}` or the
same message with `method:"guest"`, from the configured frame window and origin.
Joy8 performs Auth, Turnstile, enrollment and OAuth callback completion in the
parent. The game never receives provider or member tokens.

`POST /branded-entry` resolves only `game_id`, `game_name`, `launch_url` and
`protocol` from trusted backend configuration and exact Origin. After verified
membership, `POST /private-session` uses the same hidden-game session authority
as the private entry. The resulting launch is delivered through the normal
`joy8-launch-v1` message. Both responses are no-store. Migration
`20260920180000_branded_game_entry.sql` and the matching Gateway routes are
installed. The exact current origin/launch binding is localhost-only, so this is
not a public Mahjong deployment or completed provider/game acceptance.

### Shared launch parameters

| Parameter | Meaning | Handling |
| --- | --- | --- |
| `joy8_session_id` | Public session reference | May be used for correlation; not authorization |
| `joy8_launch_code` | One-time exchange credential | Exchange immediately; keep in memory; never log |
| `joy8_game_id` | Joy8 game identifier | Treat as platform metadata |
| `joy8_currency` | Session currency | Currently `POINT` |
| `joy8_protocol` | Protocol version | Must be `server-v1` |
| `joy8_gateway_url` | Gateway base URL | Use for wallet routes |

The Joy8 Client installs its message listener before loading the game runtime,
rejects any retired `joy8_*` query transport and sends
`{type:"joy8-launch-ready-v1",protocol:"server-v1"}` to its configured Joy8
parent origins. The Loader accepts that readiness message only from the mounted
iframe and expected game origin, then sends exactly one
`{type:"joy8-launch-v1",launch:{...}}` response. The game accepts it only from
`window.parent` at an approved Joy8 origin, validates the exact field set and
trusted Gateway/game configuration, removes the listener and exposes the launch
code to its runtime once. There is no Local Client fallback. The Loader waits for
both document load and credential delivery before hiding its loading display.
Document load and credential delivery share one 30-second deadline from mounting.
Neither event restarts that deadline; readiness after 10 seconds is still accepted.
At the deadline, a missing document load reports a load timeout; a loaded document
without credential delivery reports a handshake timeout. Failed delivery removes
the iframe, clears credentials/listeners and
shows `JOY8-GAME-006` with a reload action. Reload requests a fresh session; it
does not reuse the expired credential. Late readiness cannot restart that frame.

For a cross-origin game, both sides require the exact approved origin. A
same-origin game runs in a sandbox without `allow-same-origin`, so its message
origin is `null`; the Loader therefore validates the exact iframe window and the
`null` origin, but must use `*` as the response target. Do not describe this
same-origin exception as exact-origin delivery.

No launch field is appended to the iframe URL. The launch code therefore never
enters the initial HTTP request, CDN/access log, browser storage or Analytics.
Identity, game, wallet and permissions still come only from the trusted exchange
result, never from message claims. There is no query-parameter compatibility path.

## Iframe Contract

The current Loader sets:

```text
sandbox="allow-forms allow-orientation-lock allow-pointer-lock allow-scripts"
allow="autoplay; fullscreen; gamepad"
referrerpolicy="no-referrer"
```

For a cross-origin game, the Loader also adds `allow-same-origin`. The Loader uses
eager loading and the shared 30-second launch deadline described above.

The credential-ready message only proves that the game installed its Joy8 Client;
it is not gameplay readiness. The current 30-second timeout still observes the
iframe `load` event. A future gameplay-ready or heartbeat signal must extend this
contract explicitly rather than treating credential delivery as readiness.

The game is responsible for allowing Joy8 to embed it and for functioning under this sandbox. If CSP, `X-Frame-Options`, resource loading, or in-game rendering fails, diagnose and report the game-side problem; do not weaken the platform shell without a security review.

## Gateway Base URL

```text
https://lsazydefvnuqglultqii.supabase.co/functions/v1/joy8-gateway
```

All routes accept `POST` JSON. The Gateway adds `X-Joy8-Request-Id` to responses.

## Session Creation

Endpoint:

```text
POST /create-session
```

Request:

```json
{
  "slug": "game-slug"
}
```

Rules:

- `slug` must identify an available published game.
- The browser sends only `slug`; unknown fields are rejected. Currency is fixed to `POINT` and session lifetime to one hour by the Gateway. The internal database issuer remains service-only; its arguments are not browser configuration.
- A valid Supabase bearer token and explicit player enrollment are required.
- A missing bearer token or anonymous-key bearer returns 401. A Supabase anonymous
  user's own verified session is supported and remains a guest. Missing enrollment
  or an inactive player blocks launch; it never creates a replacement guest.
- The route requires an allowed Joy8 origin. Localhost development ports are accepted.

Relevant response fields:

```json
{
  "session_id": "...",
  "game_id": "...",
  "player_account_ref": "...",
  "launch_code": "...",
  "launch_code_expires_at": "...",
  "account_type": "guest",
  "currency": "POINT",
  "protocol": "server-v1",
  "expires_at": "..."
}
```

The launch code is valid for two minutes and can be used once.

## Operational Protocol v1

Status: base deployed through the platform migrations and the hosted
`joy8-gateway` using product protocol `server-v1`;
continuous settlement is installed. Every integrated game uses the player's one
shared POINT wallet. There is no browser payout or legacy Demo path.

The hosted platform includes the Seamless Wallet settlement extension
`20260921110000_seamless_wallet_settlement.sql`. It separates the bet limit from
the payout guard and supports platform-funded games without a game-owned point
account. The migration is installed and locally verified. Product-specific
policy, credentials and acceptance are still required before a game can use it.

### Configuration and Credentials

Joy8 selects the shared POINT wallet from trusted `joy8_game_policies` and
`joy8_wallet_policies` configuration. All enabled games reference the same POINT
policy, and each player/currency pair has one durable wallet. A wallet cannot be
replaced by freezing or closing it. A missing or disabled game policy denies launch/open. The replacement
has one accounting flow; test execution uses isolated local data. Disable a policy
to pause new activity while retaining durable references for existing matches.

Joy8's wallet model is **Seamless Wallet**: player POINT never moves into a
separate game wallet. "Shared POINT wallet" only means that all Joy8 games use
the same Joy8-owned player balance. The current platform has no Transfer Wallet
deposit, withdrawal, or game-balance reconciliation flow.

The extension adds two internal settlement modes without changing that
wallet model:

- `participants`: human, product/AI, and fee entries supplied by the game must
  balance to zero. A reviewed product adapter commits product-owned accounts.
- `platform`: intended for slots and other player-versus-platform games. The
  game supplies only player and optional fee results. Joy8 adds the opposite
  internal `platform` audit entry itself. This entry has no wallet balance and
  is not a point pool, banker wallet, or game account.

Trusted game policy has separate `max_bet_amount` and `max_payout_amount`
values. The first limits a capped opening reserve; the second limits the
absolute size of any settlement entry. Both values and `funding_mode` are
snapshotted when a match opens, so a later policy edit cannot change an existing
match. The database constrains
`max_bet_amount` to **10,000 POINT** for every policy. The product rule assigns
that single-bet ceiling to Slot games.

The reservation policy separates capped openings from a full-wallet table
reservation. A trusted game policy may use `reservation_mode='full_balance'`
only with participant funding and a
product adapter. Joy8 then requires each human reserve to equal that wallet's
entire available balance while holding the wallet lock. An optional
`max_reserve_amount` can retain a temporary product guard. The default `capped`
mode continues to enforce `max_bet_amount`, including the 10,000 POINT Slot bet
ceiling. Mahjong selects `full_balance` but retains a 1-POINT reserve guard and
its exchange/renew-only key; funded play remains
inactive.

Backend routes use `Authorization: Bearer <64 lowercase hex characters>`, with
`Content-Type: application/json` and no browser Origin. Joy8 stores a SHA-256
hash, game ID, allowed actions, expiry and revocation time for each key. The key
authorizes one game; no request can select another game or wallet. Origin
checks are additional protection, not proof of identity. Products never receive
the project service-role key or direct platform table grants.

Before provider implementation begins, Joy8 creates a hidden integration record
with its non-secret Game ID and a restricted, expiring test Backend Key. The
authoritative operator path is `npm run key:backend`: it uses a cryptographically
secure random source, registers only the SHA-256 hash in Joy8, and passes the
plaintext through standard input directly to an explicitly named Cloudflare
Worker secret. The plaintext is never a command argument, profile value,
temporary SQL value or terminal result. The command verifies the linked Joy8
project before each database operation, requires an enabled POINT policy and
refuses a published game. Cloudflare installation deploys immediately. If
delivery fails, the new database key is revoked; rotation installs the new key
before revoking the specifically selected old key.

This direct path is used only when the operator is authorized for the provider
backend. An external provider receives the same platform-generated value through
an approved one-time secret channel and installs it in its own secret manager;
chat, email and source control are not secret channels. A provider-generated
value is invalid unless Joy8 separately registers its hash, so the normal
contract keeps key generation under Joy8. Joy8 does not edit the provider's
frontend or source repository. No self-service credential UI is required for
the initial workflow.

A test key enables only the reviewed private integration work. It does not
publish a catalog entry or authorize public release. Before release, review the
production URLs, policy, action scope and expiry, then either rotate to a
production key or explicitly approve the existing key. Revoke every obsolete or
compromised key. Replacement credentials must retain status/retry access for
existing matches.

All routes below use POST and a 16 KiB body limit. Admission limits and their
deployment boundary are defined in the security section below. Unknown request fields are rejected. Amounts are decimal
**strings**, such as `"100.00"`, with at most two decimal places; JSON numbers,
exponents and extra precision are rejected. Player IDs in entries use canonical
lowercase UUID strings. Request hashes are computed by Joy8 from PostgreSQL
JSONB text, not supplied by the caller. JSON object order is irrelevant; array
order and value spelling are part of the retry identity.

### Exchange, Renewal and Re-entry

The Loader supplies `joy8_protocol=server-v1`, the one-use launch code and public
correlation IDs through the in-memory handoff. There is no browser exchange endpoint.
The game sends the code to its own authenticated backend handoff; that backend
is the sole redeemer through `server-exchange-v1`:

```json
{"version":1,"launch_code":"<one-use 64-character code>"}
```

The backend must validate its configured Joy8 Gateway host and use only the
exchange result for player/game binding. Return fields are `version`,
`session_id`, `game_id`, `player_account_ref`, `account_type`, `wallet_scope`
(`platform`), `currency` (`POINT`),
`gateway_token`, `gateway_token_expires_at`, `expires_at`, and `scopes:["balance"]`.
The game may receive the short-lived balance token, never the backend key. Keep
game credentials only in memory. Reject any launch credential found in a URL;
do not retain a compatibility parser for the retired query transport.

`server-renew-v1` takes `{"version":1,"session_id":"<UUID>"}` and returns the
same shape with a new balance token. Renewal invalidates the previous token;
the backend serializes renewal per session. Tokens last at most 15 minutes and
never outlive the original game session (the Loader currently requests one hour).
Renewal does not extend the game session. Expired/revoked sessions and inactive
players/wallets cannot renew or start a new match.

For re-entry, obtain a new platform launch, exchange it and match the trusted
`player_account_ref` to the product's existing match participant. Do not create a
replacement player/wallet or reopen the financial match. Product gameplay state
and its own connection authentication are product-owned. A lost exchange response
needs a fresh platform launch; a used code cannot be redeemed a second time.

Operational browser `balance` reports available POINT (`balance - locked_balance`)
and the locked amount. Browser `bet`, `payout`, `refund` and `close-round` cannot
be called: those routes and their database functions are removed.

### Open and Settle

`server-open-v1` takes:

```json
{
  "version":1,"match_ref":"product-match-123","rule_version":"rules-v1",
  "participants":[{"session_id":"<UUID>","reserve":"100.00"}],
  "product_participants":[{"account_ref":"bot-1","reserve":"100.00"}]
}
```

`product_participants` is optional. There must be at least one human participant;
the combined count must fit the trusted per-game limit (default 16, maximum 64).
Reserve the maximum authorized loss. For a single-player slot spin, this is the
spin's total bet. A capped reserve must be positive and within the configured
`max_bet_amount`. Product/AI reserves use `max_payout_amount`. Joy8 checks
redeemed live sessions, active players/wallets, available funds and scope. A
wallet can occupy only one open match across all integrated titles. This prevents
simultaneous games from spending POINT already reserved elsewhere.
In full-balance mode, a configured table game instead reserves the exact
available wallet balance, subject to its separate reserve guard. Slot
openings continue to use the capped rule.
The opening locks funds without moving the balance. Its response is
`{version:1,match_id:<UUID>,state:"open"}`. An identical retry returns that match's
current state; changing the opening under the same game/match reference conflicts.

`server-settle-v1` takes the authoritative result from the game backend. The
following request uses the installed continuous-settlement fields `settlement_no`
and `final`. A game still needs an authorized financial backend key and funded-play
configuration; the current Mahjong identity-only key cannot settle:

```json
{
  "version":1,"match_ref":"product-match-123","rule_version":"rules-v1",
  "operation_key":"settle:product-match-123",
  "settlement_no":1,"final":true,
  "entries":[
    {"kind":"player","account_ref":"<player UUID>","amount":"80.00","source":"gameplay"},
    {"kind":"product","account_ref":"bot-1","amount":"-90.00","source":"gameplay"},
    {"kind":"fee","account_ref":"<game UUID>","amount":"10.00","source":"fee"}
  ],
  "product_commit":{}
}
```

Entries are signed changes, unique by kind/account, nonzero and limited to 65
entries. In `participants` mode their exact sum must be zero. In `platform`
mode the game cannot submit a `platform` entry; Joy8 creates the exact opposite
audit entry after validating the request. Omit participants whose change is zero;
an empty list records a draw; `final` determines reservation release. Players and product
accounts must belong to the opening. Loss cannot exceed the recorded reserve;
every absolute entry must fit the opening's snapshotted `max_payout_amount`.
Fee entries are
positive, game-bound and separate from player or AI funding.

For example, a platform-funded slot sends no `product_participants` when opening:

```json
{
  "version":1,"match_ref":"spin-123","rule_version":"rules-v1",
  "participants":[{"session_id":"<UUID>","reserve":"10000.00"}]
}
```

If the player loses 1,000 POINT, the game submits only the player's result:

```json
{
  "version":1,"match_ref":"spin-123","rule_version":"rules-v1",
  "operation_key":"spin-123:1","settlement_no":1,"final":true,
  "entries":[
    {"kind":"player","account_ref":"<player UUID>","amount":"-1000.00","source":"gameplay"}
  ]
}
```

Joy8 records the player change and an internal `platform` `+1000.00` audit line.
A player win reverses those signs. The game never receives a Joy8 balance to
hold and never submits that internal line.

Joy8 validates authority, rules reference, account binding and accounting;
the game backend and its adapter validate the actual gameplay result. All human
wallet changes, product-account changes, fee entries, immutable settlement rows,
product commit marker and reservation updates commit in one transaction.
Wallets lock in UUID order. A frozen wallet or adapter failure rolls back all
participants. Player suspension, browser logout or session expiry after opening
does not erase the authorized match obligation; trusted settlement may complete.

Response fields are `version`, `settlement_id`, `match_id`, `state`,
`settlement_no`, `final`, `request_hash` and `settled_at`.
Exact retries return the saved response.
Every wallet transaction stores `game_id` from this trusted match configuration,
so per-game reporting never depends on a game-supplied wallet choice. The operation
key is unique within a game; changed content conflicts. Another
operation key cannot settle an already finalized match.

### Continuous Settlement

`supabase/migrations/20260918010100_continuous_settlement.sql` is deployed and extends the same settlement RPC,
without a second wallet or legacy request fallback. `settlement_no` is a required
JSON integer from 1 through 999,999,999; `final` is a required JSON boolean.
A single-hand game uses number 1 and `final:true`. A multi-hand game opens one
financial match for the entire table and posts each completed hand in order:

- Number must equal the match's committed count plus one. A skipped number or
  a repeated number under another operation key returns `JOY8_SETTLEMENT_SEQUENCE`.
- `final:false` posts human, product and fee movements immediately, keeps the
  match open and retains every participant's occupancy. For each account the
  remaining reserve becomes prior reserve plus that hand's signed net movement.
  Winnings therefore remain usable in this same match. A zero reserve still
  occupies the participant; it does not authorize a further loss or another table.
- `final:true` posts the last hand and releases remaining reservations atomically.
  An explicit empty final posting can close a table with no additional transfer;
  products must validate the corresponding durable result/close marker.
- Entry limits remain the opening's snapshotted per-entry limit. New losses are
  checked against the current reserve. No new session or wallet is created
  between hands. Session expiry, logout or suspension cannot erase an already
  opened obligation; backend authorization and active-wallet checks still apply.
- Exact historical retries return their original response, even after a later
  hand or closure. Read `server-status-v1` for the current state, latest result
  and `settlement_count`; never roll the product back to the retried response.
- Cancel ends only the unfinished remainder, releases current holds and retains
  all earlier payments, fees and immutable hand records. A cancelled table may
  have a non-null last result. Disconnection alone still never authorizes cancel.

Human and AI adapter mutations share the same transaction. The trusted settle
payload additionally supplies `next_product_participants`, computed by Joy8
from the current product reserves and validated signed entries. An adapter must
apply these rolling holds, retain its open state for `final:false`, validate the
hand number and result, and release on final/cancel. An adapter implementing only
the previous close-on-settle behavior is not suitable for activation.

The installed extension follows the wallet-ledger cleanup and refuses application
while a platform match is open. It retains finalized accounting and performs no
balance reset or grant. Mahjong's private adapter/schema, Gateway error mapping
and identity-only entry configuration are installed. Financial key scopes, funded
limits, human/AI funding and real-service acceptance remain activation gates in
[the Mahjong review](../../supabase/drafts/MAHJONG_REVIEW.md).

### Product Accounting Adapter

Trusted configuration may register one `regprocedure` per game, snapshotted at
opening. The signature is `(text,uuid,jsonb) returns jsonb` in a product schema.
It must be SECURITY DEFINER under a non-superuser, non-BYPASSRLS owner with no
platform/Auth table access; it must use a fixed empty search path and fully
qualified objects. The product runtime cannot own, replace or invoke it directly.
Review owner grants, schema CREATE grants, EXECUTE grants and dependencies before
registration. Do not grant the runtime membership in its deployment owner role.
The platform validates the registered signature/owner boundary and requires
`{"committed":true}`; the caller cannot select a function or table.

The automated privilege check rejects adapter-owner access to `public`, `auth`,
or another schema in `joy8_product_schemas`. Cross-product checks cover schema
creation, tables, views, materialized views, sequences and function execution.
The registry includes products without configured adapters. Review these grants
before registration and retain product-specific permission tests; automated
catalog checks do not replace review of application behavior or external services.

Actions are `open`, `settle` and `cancel`; the second argument is the Joy8 match
UUID. Payload always includes `version:1`, trusted `game_id` and `request`.
Settlement also supplies `settlement_id`, `request_hash` and, under continuous settlement, `next_product_participants`. The adapter validates
its game binding and authoritative product state, reserves/reconciles product
accounts in deterministic order, and writes its durable commit marker. It must
throw on any mismatch. It cannot make external HTTP side effects or commit a
separate transaction. Product-only locks follow platform wallet/fee locks; no
other product path may hold those locks and then call back into Joy8.

The fixture adapter demonstrates rollback and permission isolation only. Each
product still implements/reviews its own gameplay and AI accounting invariants.
There is no distributed-transaction promise for products in another database.

### Product Schema Registration

`joy8_product_schemas` is an operator-owned registry with no browser, service-role
or product-runtime grants. The operator registers each product schema before
runtime access or adapter configuration. Registry and game-policy changes run
`joy8_validate_product_adapters()` before commit, so an unsafe new registration
is rolled back without changing existing registrations. Registry entries are
independent of adapters; a product without an adapter must still be registered.

Every product DDL, function ownership or grant transaction must also call
`select public.joy8_validate_product_adapters();` before commit, as the authorized
operator. The validator reads metadata and does not execute gameplay or settle
a match. Runtime checks remain active; never remove them to make unsafe grants pass.

The installed `supabase/migrations/20260920120000_product_ddl_guard.sql`
adds a deferred DDL validation queue: supported DDL changes validate automatically
at transaction commit, allowing function creation and PUBLIC revocation in the
same transaction. Unsafe changes roll back with `JOY8_PRODUCT_DDL_REJECTED` before
another product uses the changed privileges. The queue grants no runtime access.
PostgreSQL event triggers do not cover shared objects such as roles;
role membership/attribute changes still need explicit
preflight. Runtime isolation checks remain necessary. See the
[PostgreSQL event-trigger limits](https://www.postgresql.org/docs/17/event-trigger-definition.html)
and [Supabase event-trigger support](https://supabase.com/docs/guides/database/postgres/event-triggers).

The installed scoped replacement is
`supabase/migrations/20260920140000_scoped_product_ddl_guard.sql`.
It skips index/comment maintenance, inspects changed catalog objects and cascaded
drops, and serializes schema changes with registration using schema-specific locks.
Only relevant product changes or newly unsafe protected-table privileges enqueue
the full deferred check. Safe Auth table maintenance does not take the global lock.
GRANT and REVOKE retain conservative global validation because PostgreSQL omits
their target object identifiers from event metadata; the guard does not parse SQL
text. Schema, registration and grant transactions require READ COMMITTED semantics
so validation sees changes committed while waiting for a lock. REPEATABLE READ and
SERIALIZABLE are rejected for those changes; comments and index maintenance remain
unaffected. Role changes still need explicit operator preflight.

Revoke PUBLIC EXECUTE on each product function in its creation transaction.
Schema-scoped default revocation cannot remove globally granted default PUBLIC
EXECUTE, and defaults belong to the creating role. See
[PostgreSQL default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).
Even without schema USAGE, a PUBLIC function grant fails this strict boundary.

Use [member-product preflight](../../scripts/sql/member-product-preflight.sql)
for aggregate identity/accounting snapshots and schema inventory, and
[postflight](../../scripts/sql/member-product-postflight.sql) for registry and
permission checks through the Joy8 wrapper. Management API reads run as
`supabase_read_only_user`, which cannot execute the internal validator; do not
grant it execution to bypass this boundary. Migration/operator transactions run
the validator directly. Account/catalog/player snapshots must remain unchanged
when installing platform-only permission changes.

### Platform SQL Fixtures

`scripts/fixtures/platform-sources.json` is the authoritative integration fixture
inventory. Every active migration must be either ordered runtime input or excluded
with a reason. New unclassified migrations fail `test:platform-bundle` and `verify`.
Hosted catalog edits, account cleanup, activation/key data and product-owned schema
installation are excluded. Each product owns its schema source and registration contract. In isolated fixtures the consumer installs and registers that schema. In the shared hosted Supabase project, Joy8 applies reviewed product SQL as incremental deployment migrations; this does not transfer gameplay ownership to Joy8.

`node scripts/export-platform-fixture.mjs` exports the contract and ordered SQL
sources with normalized-LF SHA-256 hashes. Consumers must compare the exact ordered
path list as well as every hash; checkout-based verification must also compare the
contract and source content to the selected Joy8 checkout. A bundle with drafts is
a proposed-schema test artifact, not evidence of hosted deployment. The full bundle
is exercised on PGlite and PostgreSQL 17; focused historical tests may deliberately
load smaller subsets for migration regressions.

### Recovery and Errors

`JOY8_PAYOUT_BUDGET_EXCEEDED` is reserved for the tested payout-budget proposal;
the local Gateway maps it to 409, but hosted SQL does not enforce that budget yet.
The proposal reserves each platform-funded match's maximum cumulative positive
player/fee payout against an operator-approved per-game issuance quota. Losses
do not replenish it, exact retries do not spend twice, and final/cancel releases
unused exposure. It is a risk ceiling, not a game wallet or Transfer Wallet.

`server-status-v1` and `server-cancel-v1` take only
`{"version":1,"match_ref":"product-match-123"}` and return
`{version,match_id,state,result,settlement_count}` under continuous settlement.
Result is null before the first posting, then contains the most recent committed
settlement even while open or after cancellation. After a timeout,
query status and retry the same operation/content; never invent a new operation
key or assume failure. Cancellation releases reservations without changing
balances, calls the adapter atomically, and is repeatable. It cannot reverse a
settled match. Only cancel when the product confirms the match is void; age,
browser disconnection and token expiry do not authorize cancellation.

| HTTP | Stable errors |
| --- | --- |
| 400 | `JOY8_INVALID_REQUEST`, `JOY8_INVALID_AMOUNT`, `JOY8_INVALID_ENTRY`, `JOY8_LIMIT_EXCEEDED`, `JOY8_UNBALANCED_SETTLEMENT` |
| 401 | `JOY8_BACKEND_UNAUTHORIZED` |
| 403 | `JOY8_GAME_NOT_READY`, `JOY8_PLAYER_INACTIVE`, `JOY8_WALLET_INACTIVE`, `JOY8_SESSION_INVALID` |
| 404 | `JOY8_MATCH_NOT_FOUND` |
| 409 | `JOY8_IDEMPOTENCY_CONFLICT`, `JOY8_MATCH_FINALIZED`, `JOY8_SETTLEMENT_SEQUENCE`, `JOY8_RULE_MISMATCH`, `JOY8_WALLET_OCCUPIED`, `JOY8_INSUFFICIENT_BALANCE`, `JOY8_ADAPTER_REJECTED`, `JOY8_PAYOUT_BUDGET_EXCEEDED` |
| 429 | Existing Gateway rate-limit response with `Retry-After` |
| 502/503 | Invalid/upstream-unavailable response; `JOY8_UPSTREAM_UNAVAILABLE` or `JOY8_ADAPTER_UNAVAILABLE` |

Internal database diagnostics are not returned. No generic player compensation,
purchase or funding endpoint is enabled. Correcting a committed result requires
a separately reviewed linked compensating transaction; never edit immutable
history or restore a browser payout route as a correction tool. Complete that operating procedure
before activating a funded operational product.

## Security and Failure Behavior

Gateway safeguards:

- Route and HTTP method validation.
- Origin and CORS checks.
- A 16 KiB streamed body limit.
- Launch-code and Gateway-token hashing in the database.
- Token scope, session, wallet, and game binding.
- Database-backed per-route rate limits.
- A 5-second external authentication timeout.
- An 8-second database RPC timeout.
- Public error normalization that does not expose internal database detail.

The deployed Gateway uses verified-subject limits from
`supabase/migrations/20260920160000_scoped_gateway_limits.sql`.
For changes to this admission contract, apply SQL first,
verify its restricted grants, then deploy the function; the new Gateway fails
closed if admission SQL is unavailable. Git upload alone does not deploy it.

| Operation | Verified counting identity | Requests | Fixed window |
| --- | --- | ---: | ---: |
| Member lookup | Auth user UUID + route | 120 | 60 seconds |
| Enroll / create public session / create private session | Auth user UUID + route | 30 | 300 seconds |
| Balance | Player's Auth user UUID resolved from the active Gateway token | 120 | 60 seconds |
| Backend exchange and renewal together | Existing game-bound Session UUID | 30 | 60 seconds |
| Open a table | Verified backend game UUID + open | 120 | 60 seconds |
| Settle | Existing match UUID belonging to the verified game | 30 | 60 seconds |
| Cancel | Existing match UUID belonging to the verified game | 30 | 60 seconds |
| Match status | Existing match UUID belonging to the verified game | 120 | 60 seconds |
| All backend requests combined | Verified backend game UUID | 6,000 | 60 seconds |
| Coarse ingress across gameplay/member routes | Client address | 10,000 | 60 seconds |
| Health monitoring only | Client address | 30 | 60 seconds |

The 30 settlement requests per table are independent: 100 tables can each issue
30 requests through one backend/address. The backend and ingress ceilings are
initial coarse abuse limits, not measured production-capacity guarantees. Backend
identity is stable across key rotation: multiple valid keys for the same game
share its backend budget. Other games have independent backend budgets. Creating
a session is player-limited because no trusted game Session exists yet; exchanging
or renewing it uses the verified Session limit.

Never use a caller-supplied player ID, random match reference, unverified JWT claim
or raw API key as a trusted counting identity. The service-role-only admission RPC
verifies backend key scope/revocation/expiry and resolves existing game-owned
Sessions/matches. Unknown or other-game resources are rejected. Token/key rotation,
IP changes and new operation keys cannot reset a subject's budget. Launch-code
lookup uses the game/hash index without persisting the raw code in a counter.

Admission is committed in its own RPC before business processing, so invalid
business requests and exact retries consume budget without rolling back the
counter. Settlement idempotency remains enforced by the settlement RPC. The
backend counter also counts invalid requests after backend authentication, while
invalid credentials only reach coarse ingress protection. Counters use the existing
atomic SQL upsert and fixed wall-clock windows; a boundary can permit a burst across
two windows, so these are not rolling-window or requests-per-second guarantees.

A 429 response includes `Retry-After`. Clients must wait, preserving the original
idempotency key. Unavailable or malformed admission results fail closed with 503.
Do not fall back to the old per-IP policy.

The Gateway is deployed with `verify_jwt=false` because it performs these checks itself. Protected RPCs remain granted only to `service_role`.

On failure:

- Do not activate the Local Client.
- Do not mint a local balance.
- Do not retry a non-idempotent operation with a new idempotency key.
- Display a clear platform or game error.
- Keep secrets out of logs and analytics events.

## Member and Direct Entry Boundary

The source requires an authenticated, enrolled Joy8 player before launch, whether
registered or a persistent guest. Authentication, provider login, guest identity,
linking and branded entry are platform responsibilities.

Their plan is owned by `MEMBER_AUTH_PLAN.md`. Game integration work should consume the resulting Joy8 session contract without copying identity-provider logic into the game.

The Lobby may display the platform's six-digit `public_id` as `Player 123456`.
That value is presentation-only and is not part of the launch payload or product
authorization contract. Games and trusted backends correlate players with the
internal `player_account_ref` returned by the Gateway; they must not authenticate,
authorize, settle, or create product mappings from a public player ID.

This member contract applies only when the Joy8 Client is active. CrazyGames and other external platform clients must use their own identity services and must not initialize Joy8 Auth, sessions, or wallets.

## Database Boundary

The Gateway currently operates through protected RPCs over:

- `player_accounts`
- `wallet_accounts`
- `wallet_transactions`
- `game_sessions`
- `joy8_matches`, `joy8_match_participants`
- `joy8_settlements`, `joy8_settlement_entries`, `joy8_fee_accounts`
- `joy8_wallet_policies`, `joy8_game_policies`, `joy8_backend_keys`
- `gateway_rate_limits`

Joy8 stores match reservations and platform accounting results, not authoritative
rooms, gameplay actions, progression or rankings. Products correlate their own
records using stable game/match and player references. Their schema and runtime
roles remain isolated even inside the same physical Supabase project.

The browser and game do not receive direct table access. Legacy `players`, `player_balances`, and `ensure_my_player_v1()` must not be restored.

Database operation rules and the current schema summary are in `../../README.md` and `../../AGENTS.md`.

## Integration Checklist

The platform fixture verifies the protocol, not a product's actual gameplay or
hosted integration. Complete the owning product's integration before activation.

Before provider implementation:

1. Complete the non-secret game profile, rule version, wallet policy, URLs and
   exact parent origins.
2. Create the hidden Game ID and restricted, expiring test Backend Key.
3. Deliver the Game ID, SDK/contract and Backend Key at integration kickoff;
   keep the key outside chat, source control and browser code.
4. The provider implements and tests its own game and backend, then supplies a
   private build and checklist evidence to Joy8.

Before listing a game through the Joy8 Lobby:

1. Confirm the product is allowed on Joy8 and classify whether it is gambling.
2. Confirm the game has a stable HTTPS `launch_url`.
3. Confirm CSP and `X-Frame-Options` allow Joy8 embedding.
4. Verify the game runs with the documented iframe sandbox and permissions.
5. Implement an explicit Joy8 Client; do not detect Joy8 from iframe presence.
6. Implement the origin-checked ready/launch message handoff, use the designated
   single launch-code redeemer, keep client game tokens in memory and validate
   the server handoff.
7. Use a stable `match_ref` that correlates with the authoritative game-database record and an idempotency key strategy.
8. Handle Gateway errors without falling back to fake success.
9. Verify launch, balance, open/settle/status/cancel, renewal, retries, isolation, frozen wallets, and insufficient balance.
10. Confirm no launch code, Gateway token, member JWT, or provider credential reaches storage, logs, analytics, or save data.
11. Add the Joy8-managed `750 x 1000` WebP cover in this repository.
12. Test Lobby to Loader to iframe on the target production origin.

For a dual-platform non-gambling game, also complete the CrazyGames checklist in `CRAZYGAMES_INTEGRATION.md`.

## Contract Changes

Any change to parameter names, token lifetime, endpoint shape, wallet semantics, iframe permissions, platform selection, or error behavior is a contract change. Update this document with the implementation and verify both the Joy8 Loader and the affected game client.
