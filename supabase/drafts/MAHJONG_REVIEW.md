# Mahjong database and runtime review

Status: private entry, identity-only connection, and the shared POINT wallet
cutover are installed and verified in the hosted database. Hosted play acceptance,
publication and funding remain pending.

## Installed database boundary

The initial installation was approved. The table below describes that boundary;
it is not a complete migration inventory. README owns the current version check. Do not reapply the source candidates. Future changes
remain incremental migrations through the Joy8 wrapper with project verification.

| Order | Authoritative SQL | Effect |
| --- | --- | --- |
| 1 | [wallet ledger cleanup](../migrations/20260918010000_wallet_ledger_cleanup.sql) | Rename ledger match reference and remove empty metadata; no reset |
| 2 | [continuous settlement](../migrations/20260918010100_continuous_settlement.sql) | Post each hand under one occupied match; retain previous settlements |
| 3 | [product-state.sql](../../../../Project-Gaming/production/table/products/mahjong-clash/server/sql/product-state.sql) | Private schema, seats, snapshots, leases and immutable actions |
| 4 | [product-economy.sql](../../../../Project-Gaming/production/table/products/mahjong-clash/server/sql/product-economy.sql) | AI funding ledger, reservations, fee rules and reconciliation |
| 5 | [product-accounting.sql](../../../../Project-Gaming/production/table/products/mahjong-clash/server/sql/product-accounting.sql) | Restricted atomic platform callback and result/profile records |
| 6 | [product-lifecycle.sql](../../../../Project-Gaming/production/table/products/mahjong-clash/server/sql/product-lifecycle.sql) | Verified bindings, match/hand preparation and recovery |
| 7 | [product-runtime.sql](../../../../Project-Gaming/production/table/products/mahjong-clash/server/sql/product-runtime.sql) | Checkpoints, pending HTTP recovery, scoped reads and narrow backend functions |
| 8 | [Mahjong registration](../migrations/20260918010700_mahjong_registration.sql) | Historical hidden-game registration, operational configuration and non-login runtime role; its wallet-policy shape is superseded by the shared-wallet cutover |
| 9 | [Mahjong shared wallet](../migrations/20260920165000_mahjong_shared_point_wallet.sql) | Resolve Mahjong sessions, available balance and readiness through the platform policy mapping |
| 10 | [Platform shared wallet](../migrations/20260920170000_shared_point_wallet.sql) | One POINT wallet per player, trusted reservations and mandatory transaction source game |

Mahjong source root:
`D:/Studio/Project-Gaming/production/table/products/mahjong-clash`.
The game files remain owned there; applied numbered migrations retain the
installation snapshots. Installation created no human wallet,
POINT credit, AI account, backend key, usable database password or public entry.
The game runtime gets no Auth tables, Joy8 tables, service-role key, callback
execution, direct AI balance writes or accounting-owner membership. Narrow
security-definer bridges validate the configured game before accessing the shared human
balance or binding. Private checkpoint tables allow trusted runtime persistence;
they are not exposed through PostgREST or browser grants.

The applied `20260923110000_mahjong_processed_actions_history_limit.sql` is a
product-owned deployment snapshot in Joy8's hosted migration history. It adds a
100,000 committed-revision guard. Its content is preserved and its fixture
classification is explicit; product-authoritative source remains in Mahjong.
The present task did not verify the earlier approval record for this change.

## Identity-only connection

The user approved and installed these additions:

- [Private entry](../migrations/20260918010800_private_game_entry.sql), updated by
  [allowlist removal](../migrations/20260918011000_remove_test_player_allowlist.sql):
  backend-only entry configuration. Public sessions still require
  a published catalog record. Both routes share one internal session issuer.
  Private entry requires verified membership, the exact Origin, a hidden game,
  and enabled configuration before creating a wallet/session. Every active enrolled
  guest or registered member can enter without individual approval.
- [Mahjong identity activation](../migrations/20260918010900_mahjong_identity_activation.sql):
  enabled zero-credit game access and a four-seat policy with a temporary
  1-POINT reservation ceiling. This is an identity-stage guard, not a gameplay
  limit or point grant. The historical game-policy column is deployment history,
  not a supported wallet mode; the cutover maps Mahjong to the one shared POINT policy.
  Joy8 owns `http://localhost:5173/play-test/?slug=mahjong-clash`;
  Mahjong owns the private frame at `http://localhost:4391/`. Public catalog
  visibility stays false and its public launch URL stays null.
- Restricted `mahjong_clash_runtime` login and a game-scoped exchange/renew-only
  key. Both expire on 2026-09-25 at 15:25 Asia/Taipei. The key cannot open or settle
  matches. Secret values exist only in the game's ignored `.env.joy8.local`.
- The hosted `joy8-gateway` with product protocol `server-v1`, private sessions
  and continuous-settlement error mapping.
  Health/rejection checks and actual identity-key scope checks passed. The local
  test entry is included in Joy8's standard front-end build, with configured browser entry
  bound to localhost. Origin is not proof of tester authorization. Mahjong has no cloud game build, GCP host or public release.

The player allowlist is removed. Use normal Joy8 sign-in or persistent guest
entry; administrator access does not substitute for player enrollment. No human
wallet, session, match, AI account or point credit was created by these migrations.

The hosted full-balance reservation policy moves this temporary 1-POINT guard
to a separate `max_reserve_amount` policy field. The Slot 10,000 POINT bet
ceiling remains separate from Mahjong's table reservation. A player with more than 1 available POINT cannot open under this identity-only
policy. It is not a funded-play configuration. Funded limits and financial key
scopes still require another review; this task does not invent credit or limits.

## Shared POINT wallet cutover review

The 2026-09-20 read-only hosted preflight found two player accounts and exactly
one enabled 0-POINT policy mapped to Mahjong. It found zero wallet, transaction,
session, platform-match, reservation, settlement, fee-account, Mahjong match,
hand, and uncommitted-accounting rows. Balance and locked totals are both zero.
The six functions that depend on the retired policy game column are exactly the
three Joy8 session/open/provision functions and the three Mahjong session/balance/
readiness functions replaced by the reviewed SQL.

No balance merge, sum, grant, reset, player rewrite, or Auth/login change was
required or performed. The platform migration rechecked the empty accounting
set under exclusive locks before changing the wallet identity.

The reviewed SQL was applied in this order:

1. `20260920165000_mahjong_shared_point_wallet.sql` replaces the Mahjong product
   functions while remaining valid against the current policy table.
2. `20260920170000_shared_point_wallet.sql` takes exclusive accounting locks,
   rechecks that the accounting set is empty, maps every game policy to the one
   POINT policy, removes policy game scope, enforces one player/currency wallet,
   requires a source game on transactions, and replaces trusted Joy8 functions.
3. `scripts/sql/shared-point-wallet-postflight.sql` checked the schema, mapping,
   permissions, source-game constraint, reservation reconciliation, Mahjong
   readiness, and unchanged business-row totals.

The SQL is atomic. A concurrent old-schema session either completes before the
lock and makes the guard abort, or waits until the new schema commits. Hosted
postflight retained two players and found zero wallets, balances, holds,
transactions, sessions, platform matches, Mahjong matches, or unfinished work;
the local and remote migration versions match. Rollback after this successful
cutover requires a new reviewed forward migration; do not restore a game-specific
wallet mode. Mahjong stays inactive until its remaining release gates are complete.

## Credentials and connection checks

The retired Mahjong credential generator is removed. It wrote plaintext SQL and
runtime environment files into the Joy8 repository. Its pure SQL builder remains
only in an isolated historical test fixture; it is not an operator tool.

Use the [shared credential workflow](../../integrations/third-party/README.md#platform-operator-flow)
for Backend Keys, with a reviewed operation and a supported secure delivery
target. It does not provision a PostgreSQL runtime login or deliver to a local
Mahjong environment. A runtime-password rotation requires a separate reviewed
operator action and secret-manager delivery; never recreate plaintext credential
files in this repository. Existing credential expiry is not approval to rotate.

The game stores the Supabase CLI's linked CA in ignored `.joy8-db-ca.crt.local`;
`MAHJONG_DB_CA_FILE` points to that stable copy. Keep TLS verification enabled,
including hostname verification, as described by
[Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
The certificate's name contains `Supabase Staging Root 2021 CA`; the trusted
linked CA verifies this project's session-pooler chain and hostname.

`MAHJONG_REVIEW_ROOT=<absolute game root> node scripts/mahjong-connection-check.mjs`
reads the game's ignored `.env.joy8.local` and checks TLS, actual role restrictions
and readiness in a read-only transaction. This passed against hosted Supabase;
it does not start Godot or provision data. Run the wrapper's project check first.
No real-player Godot/iframe acceptance has been performed. The game's `dev:joy8`
authority has not been started against hosted data. Unlike this read-only check,
that runtime can persist product state and invoke rule-bound AI funding; review
the intended effects before starting hosted acceptance.

Eleven isolated private-entry/credential checks pass on PGlite and PostgreSQL 17,
including a real restricted login. Member/Gateway tests and browser smoke cover
safe callbacks, explicit start, rejection/retry and shared iframe handling.
These synthetic identities do not establish real provider or funded-play acceptance.

Two installed runtime limits remain relevant before funded or public play:

- `mahjong_clash.runtime_balance()` separates available, total, locked and this
  Mahjong table's reserved POINT. A reservation owned by another Joy8 game stays
  locked and cannot be spent by Mahjong.
- Economy operations lock the singleton `economy_state` row. This preserves the
  global counters but serializes those operations across matches; measure the
  resulting capacity before public activation.

## Remaining activation

1. Sign in through Joy8 or restore the existing guest. Verify the same player
   reaches the running game with the same shared balance; no test-access grant is required.
2. Define funded-play limits and the human POINT source before changing the
   identity-only reservation ceiling or authorizing financial backend scopes.
3. Review AI funding and full gameplay acceptance before starting funded play.
4. The Joy8-owned `/entry/?slug=mahjong-clash` and Mahjong-side Google/guest
   message contract are implemented. The service-only resolver and Gateway routes
   are installed, while the exact entry/launch binding remains localhost-only.
   Cloudflare game upload, production game URL, GCP/VPS, production launch,
   guest-to-Google linking and hosted provider acceptance remain separate.
   Turnstile protects guest Auth; no Email/password UI is exposed, but the hosted
   Email provider and API signup remain enabled. See the release safety review
   for the pending provider shutdown. Cloudflare Email Sending is disabled.

## Verification and recovery

Use `scripts/sql/wallet-ledger-preflight.sql` and
`scripts/sql/mahjong-readiness.sql` for aggregate read-only hosted checks. Recheck
immediately before applying; prior observations are not deployment guarantees.
Schema-installation postflight verified 22 private tables, isolated roles, zero
legacy ledger columns and continuous settlement. Current identity activation is
verified by `scripts/sql/mahjong-identity-postflight.sql`. Owner roles cannot
CREATE in the schema; temporary operator SET/INHERIT grants are false. The trusted
platform operator can invoke the accounting callback; runtime/browser roles cannot.
Auth/player IDs, existing catalog hashes and all financial row counts matched
before/after installation and allowlist removal.
`mahjong-installation-identity-check.sql` provides the current aggregate snapshot.
`mahjong-installation-postflight.sql` checks only the earlier disabled installation
state and is expected to reject the now-enabled identity configuration; do not use
it as current activation acceptance.

The game owns runtime verification in `server/README.md`. Its fixture must pin
both installed ledger cleanup and continuous extension, in that order. Local
Auth rows and funded fixtures do not establish real provider acceptance.

Each applied SQL file is transactional. Future migrations must stop on a failed precondition or dependency;
do not force through with CASCADE, reset data or erase a pending settlement.
After installation, rollback is a reviewed forward change. Disable entry and
keys first if activation must be withdrawn; preserve committed hands and audit
data. Before operating, verify hosted backup availability and perform the
separate recovery acceptance; isolated local restore is not a hosted backup test.
