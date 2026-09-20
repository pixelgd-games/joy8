# Review-only SQL

This directory holds review documents and any future unapproved SQL. SQL here
is excluded from active migration discovery. It currently contains no pending
SQL migrations.

[MAHJONG_REVIEW.md](MAHJONG_REVIEW.md) owns the installed Mahjong boundary and
remaining activation decisions. It does not authorize publication, keys or funding.
The product owns current gameplay SQL; hosted changes use small reviewed forward
migrations. Never modify applied migration history or rerun fixture installation
against the hosted database.

[README](../../README.md#verification) owns verification commands and hosted state.
The [integration contract](../../docs/platform/GAME_PLATFORM_INTEGRATION.md)
owns product registration, permission boundaries and the complete SQL fixture.
