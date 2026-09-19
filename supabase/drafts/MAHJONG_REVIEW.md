# Mahjong database and runtime review

Status: private entry and identity-only connection are installed and verified.
Hosted play acceptance, publication and funding remain pending.

## Installed database boundary

The user approved this installation. All eight numbered migrations are applied;
local/hosted history matches. Do not reapply the source candidates. Future changes
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
| 8 | [Mahjong registration](../migrations/20260918010700_mahjong_registration.sql) | Hidden game, disabled 0-POINT wallet policy, operational configuration and non-login runtime role |

Mahjong source root:
`D:/Studio/Project-Gaming/production/table/products/mahjong-clash`.
The game files remain owned there; applied numbered migrations retain the
installation snapshots. Installation created no human wallet,
POINT credit, AI account, backend key, usable database password or public entry.
The game runtime gets no Auth tables, Joy8 tables, service-role key, callback
execution, direct AI balance writes or accounting-owner membership. Scoped
security-definer bridges validate the configured game before accessing a human
balance or binding. Private checkpoint tables allow trusted runtime persistence;
they are not exposed through PostgREST or browser grants.

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
  enabled game-scoped zero-credit wallet and four-seat policy with a temporary
  1-POINT reservation ceiling. This is an identity-stage guard, not a gameplay
  limit or point grant. Joy8 owns `http://localhost:5173/play-test/?slug=mahjong-clash`;
  Mahjong owns the private frame at `http://localhost:4391/`. Public catalog
  visibility stays false and its public launch URL stays null.
- Restricted `mahjong_clash_runtime` login and a game-scoped exchange/renew-only
  key. Both expire on 2026-09-25 at 15:25 Asia/Taipei. The key cannot open or settle
  matches. Secret values exist only in the game's ignored `.env.joy8.local`.
- Gateway version 8 with private sessions and continuous-settlement error mapping.
  Health/rejection checks and actual identity-key scope checks passed. The local
  test entry is included in Joy8's standard front-end build, with backend access
  bound to localhost. Mahjong has no cloud game build, GCP host or public release.

The player allowlist is removed. Use normal Joy8 sign-in or persistent guest
entry; administrator access does not substitute for player enrollment. No human
wallet, session, match, AI account or point credit was created by these migrations.

## Credentials and connection checks

[mahjong-credentials.mjs](../../scripts/mahjong-credentials.mjs) prepares ignored
`.mahjong-provision.sql.local` and `.mahjong-runtime.env.local` files with fresh
random values. It is offline and refuses overwrites. Its SQL is one atomic DO
statement, enables only the restricted runtime role and an exchange/renew key,
and rejects unrelated existing credentials. Do not use it to silently rotate
working credentials. Existing credential expiry is not permission to reprovision.

Use the Joy8 wrapper for application, after checking the linked project. Its
`db query --linked` Management API path runs as `supabase_read_only_user`; it is
for inspection. Apply approved single-statement credential SQL with the same
wrapper's `db query --db-url` using the pinned linked pooler and locally loaded
administrator password. Capture all output, because a query error can echo SQL.
Never print credentials, include literal secrets in commands, or place credential
SQL in committed migration history. Verify remote state before uncertain retries.
After confirmed installation and transfer to the game environment, remove the
local preparation files; retain them only while application status is uncertain.

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

## Remaining activation

1. Sign in through Joy8 or restore the existing guest. Verify the same player
   reaches the running game at zero credit; no test-access grant is required.
2. Define funded-play limits and the human POINT source before changing the
   identity-only reservation ceiling or authorizing financial backend scopes.
3. Review AI funding and full gameplay acceptance before starting funded play.
4. Public branded origin, Cloudflare game upload, GCP/VPS, SMTP, production launch
   and Google linking remain separate from this connection approval.

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
