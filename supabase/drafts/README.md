# Review-only SQL

This directory holds review documents and any future unapproved SQL. SQL here is
excluded from active migration discovery. There is currently no pending SQL
migration in this directory.

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
