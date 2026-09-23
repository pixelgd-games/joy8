# Review-only SQL

This directory holds review documents and any future unapproved SQL. SQL here is
excluded from active migration discovery. The release-safety SQL below is pending
review and must not enter active migrations or be applied without approval.

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

The current enabled hidden Mahjong entry remains exactly
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

These are independent forward-change proposals, not deployment history or an
old/new runtime. `scripts/release-safety-check.mjs` installs the current platform
bundle and explicitly exercises the proposals in isolated test data. No budget,
credit, key, production game activation or data reset is authorized by these files.

| Proposal | Concrete effect | Release/rollback boundary |
| --- | --- | --- |
| [private-entry-pause.sql](private-entry-pause.sql) | Disable the two hidden Mahjong/Monster Lab entries; require no open matches or active financial keys | Re-enabling requires reviewed audience, origin and activation; no identity or balance deletion |
| [admin-identity.sql](admin-identity.sql) | Resolve the allowlisted email from `auth.uid()` and a verified, active Google identity; require Google session provider; revoke catalog DELETE from browser administrators | Verify the retained administrator's Google identity before applying; do not restore email-only authorization |
| [platform-payout-budget.sql](platform-payout-budget.sql) | Reserve per-match maximum payout against a per-game approved issuance quota; consume positive player/fee payouts cumulatively; preserve usage across sessions/keys; release unused liability on close | Reject installation with open platform-funded matches; no quotas are automatically granted, so platform-funded opening is disabled until a reviewed quota row exists |
| [operator-match-recovery.sql](operator-match-recovery.sql) | Operator-only cancellation with reason, evidence reference and exact settlement count; atomic adapter cancellation and reservation release; preserve prior settlements | Use only after authoritative product evidence establishes the unfinished match is void; an adapter failure rolls back; no timeout-only cancellation or browser access |
| [runtime-maintenance.sql](runtime-maintenance.sql) | Install pg_cron and schedule fixed-search-path cleanup every ten minutes, independent of game launches | Extension installation and scheduling must succeed atomically; expires sessions and removes expired rate counters, never players, wallets, financial history or reservations |

The current preflight finds one verified Google administrator and no installed
pg_cron extension. The maintenance proposal includes installation using the
[Supabase Cron installation procedure](https://supabase.com/docs/guides/cron/install).
The local tests exercise cleanup semantics; actual scheduler execution must be
verified after approved hosted application.

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

Separate hosted Auth change: disable the Email provider, preserving Google and
anonymous signups. Verify public settings afterward and confirm real Google admin
and member login. Do not set the global `disable_signup` flag to true. Configure
`VITE_TURNSTILE_SITE_KEY` before the next frontend build; no source-code key fallback
exists. Neither Auth settings nor Cloudflare deployment changes are performed by
these SQL files.

Remaining product decisions: six-digit ID capacity/guest retention and abuse
limits, future approved payout quota amounts, funded Mahjong limits, and any
Facebook identity without email. Those are not solved by deleting users,
recycling IDs, inventing credit or weakening identity verification.
