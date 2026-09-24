# Review-only SQL

This directory holds review documents and any future unapproved SQL. SQL here is
excluded from active migration discovery. The five approved release-safety changes
below were promoted to active migrations without changing their reviewed SQL.

[MAHJONG_REVIEW.md](MAHJONG_REVIEW.md) owns the installed Mahjong boundary and
remaining activation decisions. It does not authorize publication, keys or
funding. The product owns current gameplay SQL; hosted changes use small reviewed
forward migrations. Never modify applied migration history or rerun fixture
installation against the hosted database.

[README](../../README.md#verification) owns verification commands and hosted
state. The [integration contract](../../docs/platform/GAME_PLATFORM_INTEGRATION.md)
owns product registration, permission boundaries and the complete SQL fixture.

## Branded entry cutover

The 2026-09-20 read-only hosted preflight confirmed `Joy8 /
lsazydefvnuqglultqii / linked: true`, two retained players, zero wallets, zero
POINT balance, zero locked POINT, zero transactions, zero sessions, zero
unfinished platform or Mahjong matches, and no installed branded-entry resolver.
The user then approved the formal database change.

Migration
[`20260920180000_branded_game_entry.sql`](../migrations/20260920180000_branded_game_entry.sql)
installed only the fixed-search-path, service-role resolver. Postflight retained
every preflight count and sum unchanged and confirmed that browser roles cannot
execute it. The deployed Gateway passed its positive localhost branded-entry,
health and rejection smoke without creating an identity, wallet, session or
settlement.

The currently paused Mahjong entry retains the exact binding
`http://localhost:5173` -> `http://localhost:4391/`. Mahjong is not deployed to
the cloud. A future production origin/launch URL requires a separate small
reviewed migration and end-to-end acceptance; it must not clear, sum, transfer or
grant POINT.

## Table reservation policy

The [platform migration](../migrations/20260923100000_full_balance_reservations.sql)
adds a trusted `full_balance` reservation mode. It checks the exact available
wallet amount under the existing wallet lock. Capped openings and the Slot
10,000 POINT bet ceiling remain intact. The separate
[Mahjong policy migration](../migrations/20260923101000_mahjong_full_balance_policy.sql)
selects this mode while retaining a 1-POINT reserve guard. It requires Mahjong
to remain hidden, unfunded and without an active financial backend key. Neither
migration changes a wallet balance, transaction, match result or key scope.

Both migrations are applied to hosted Joy8. The linked project and Mahjong policy
were verified with `scripts/supabase-joy8.cmd projects list` and
`scripts/sql/mahjong-identity-postflight.sql`. Funded play still requires a
separate review of POINT source, limits, backend scopes and the game.

## Release safety review

All five changes are approved and installed in hosted Joy8. They do not grant
keys or public game activation. The platform bundle includes the administrator
and recovery schema. Entry activation and the
hosted scheduler are classified separately; release-safety tests exercise
pause and cleanup semantics in isolation.

| Migration | Installed effect |
| --- | --- |
| [Private entry pause](../migrations/20260923143700_private_entry_pause.sql) | Mahjong/Monster Lab entries disabled; origins and game records retained |
| [Admin identity](../migrations/20260923143710_admin_identity.sql) | Verified active Google Auth identity and Google session required; browser catalog DELETE revoked |
| [Payout budget](../migrations/20260923143720_platform_payout_budget.sql) | Removed by [remove payout budget](../migrations/20260924102000_remove_payout_budget.sql); each game's `max_payout_amount` is its single-payout limit |
| [Operator recovery](../migrations/20260923143730_operator_match_recovery.sql) | Operator-only cancellation with evidence and exact settlement count; atomic product cancellation and unlock; immutable recovery evidence |
| [Runtime maintenance](../migrations/20260923143740_runtime_maintenance.sql) | pg_cron installed; cleanup scheduled every ten minutes; never releases reservations or deletes financial history |

Hosted postflight confirms both entries paused, retained Google administrator
allowed, Email session denied administrator authority, browser deletion/recovery
permissions denied, three quota triggers enabled and zero approved quota rows.
The three player accounts remain unchanged, with zero wallets, balances,
transactions, matches or settlements. The cleanup job is active and its first
scheduled execution succeeded. Inspect run records through
`scripts/sql/release-safety-postflight.sql`.

Before every hosted database operation, verify Joy8 with the wrapper. Rerun
[`release-safety-preflight.sql`](../../scripts/sql/release-safety-preflight.sql)
immediately before review/application. Apply only approved proposals as new
timestamped migrations, preserving applied files. Verify effective grants,
administrator access, entry rejection, unchanged player/wallet/transaction totals,
the installed quota/recovery functions and the scheduled job. The matching
Gateway/frontend and production Turnstile configuration are deployed.

After recovery installation, the operator prepares a reviewed single transaction
calling `public.joy8_operator_cancel_match(game_uuid, match_ref,
expected_settlement_count, reason, evidence_reference)` through the Joy8 wrapper.
Inspect the match and product state first. Never supply the project administrator
password or evidence containing player credentials in command arguments or chat.
The function is not granted to anon, authenticated, service_role or game runtimes.

The wrapper's direct `db query --db-url` path accepts one prepared statement.
Postflight uses a single CTE statement with transaction-local synthetic claims to
check the retained administrator; it does not create an Auth login or change a
user. Real interactive provider acceptance remains separate.

The separate Email-provider shutdown is approved but not applied: the local
access token receives HTTP 403: `Missing required permission(s): auth_config_read`. Update the token locally
with Auth configuration read/write permission. Then use
`scripts/supabase-joy8.cmd auth-config disable-email --apply`, preserving Google
and anonymous signups. `auth-config status` prints selected booleans only. Verify public settings afterward and confirm real Google admin
and member login. Do not set the global `disable_signup` flag to true. Production
`VITE_TURNSTILE_SITE_KEY` is configured; no source-code key fallback
exists. Neither Auth settings nor Cloudflare deployment changes are performed by
these SQL files.

Remaining product decisions: six-digit ID capacity/guest retention and abuse
limits, funded Mahjong limits, and any
Facebook identity without email. Those are not solved by deleting users,
recycling IDs, inventing credit or weakening identity verification.

## Metadata and session cleanup

Both proposals were approved and installed without changing their reviewed SQL.

- [Session contract cleanup](../migrations/20260924012500_session_contract_cleanup.sql) removes the unused
  platform `player_accounts.display_name` and replaces both session issuers with
  the exact `(game_slug, auth_user_id)` signature. POINT, the session lifetime
  (now 12 hours via [twelve-hour game session](../migrations/20260924110000_twelve_hour_game_session.sql))
  and 120-second launch code are fixed internally. Public/private entry checks,
  member verification and shared-wallet provisioning remain. Health checks are
  updated; old signatures are dropped, with no fallback.
- [Catalog metadata cleanup](../migrations/20260924012510_catalog_metadata_cleanup.sql) removes
  `games.supports_live` and replaces the catalog function/view without this field.
  Public users still see only published games. Grants remain narrow and the
  catalog function uses an empty search_path.

Read-only hosted preflight found zero non-null platform display names, zero true
live flags, zero published games and zero enabled private entries. The SQL
rechecks these data/activation guards under locks where relevant; it refuses to
discard used metadata. Mahjong's own `ai_accounts.display_name` is product-owned
and remains untouched. There is no wallet, POINT, key, ID, retention or game-rule
change. `wallet_scope`, token scopes and policy mappings remain active protocol
and authorization fields; no game-side contract changes are included.

`session-cleanup-check.mjs` constructs the historical pre-cutover fixture and
applies both exact migrations, including refusal guards, removed signatures,
fixed lifetimes, browser denial and published-only catalog access. Both files
are classified in the fixture manifest; the guarded cutovers are exercised
separately from the exported historical base bundle.

Hosted postflight confirms both obsolete signatures and columns are absent,
the new issuer and health check work, service/browser grants are correct, and
all entries remain paused. Three players remain, with zero wallets, balances,
transactions, matches or settlements. Recheck with
[`session-cleanup-postflight.sql`](../../scripts/sql/session-cleanup-postflight.sql)
using the wrapper's password-authenticated database connection. The linked
Management API query role cannot execute restricted health/admin functions;
do not broaden production grants for these checks.

The matching frontend/Gateway are deployed and hosted health/rejection checks
pass. Game entries remain paused pending separate reviewed activation.
A source push to main still needs an explicit user request.
