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
payout quotas, POINT credit, keys or public game activation. The platform bundle
includes the administrator, quota and recovery schema. Entry activation and the
hosted scheduler are classified separately; release-safety tests exercise
pause and cleanup semantics in isolation.

| Migration | Installed effect |
| --- | --- |
| [Private entry pause](../migrations/20260923143700_private_entry_pause.sql) | Mahjong/Monster Lab entries disabled; origins and game records retained |
| [Admin identity](../migrations/20260923143710_admin_identity.sql) | Verified active Google Auth identity and Google session required; browser catalog DELETE revoked |
| [Payout budget](../migrations/20260923143720_platform_payout_budget.sql) | Per-game approved quota reserves cumulative match exposure and consumes positive payouts; no quota granted |
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
the installed quota/recovery functions and the scheduled job. Do not deploy the
Gateway/frontend until the coordinated route and Turnstile configuration is ready.

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
and member login. Do not set the global `disable_signup` flag to true. Configure
`VITE_TURNSTILE_SITE_KEY` before the next frontend build; no source-code key fallback
exists. Neither Auth settings nor Cloudflare deployment changes are performed by
these SQL files.

Remaining product decisions: six-digit ID capacity/guest retention and abuse
limits, future approved payout quota amounts, funded Mahjong limits, and any
Facebook identity without email. Those are not solved by deleting users,
recycling IDs, inventing credit or weakening identity verification.
