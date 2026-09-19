# Review-only SQL

SQL under this directory is excluded from active migration discovery. The three
original files in `mahjong-clash/` are superseded, incomplete and unapplied; do
not combine them with the installed product schema.

The approved wallet-ledger cleanup, continuous settlement and Mahjong registration
have been promoted to `../migrations/20260918010*.sql`. The five intervening product
migrations snapshot the game-owned SQL in its repository. These eight migrations
are installed; [README](../../README.md#database) owns the verified hosted state.
Do not reapply the former drafts or modify applied migration history.

[MAHJONG_REVIEW.md](MAHJONG_REVIEW.md) now records the installed boundary and the
remaining activation decisions. It does not authorize publication, keys or funding.

Private entry and Mahjong identity activation have been promoted to
`../migrations/20260918010800_private_game_entry.sql` and
`../migrations/20260918010900_mahjong_identity_activation.sql` and are installed.
The installed `../migrations/20260918011000_remove_test_player_allowlist.sql`
removes per-player approval while retaining member and entry validation.
Their eleven-case isolated check is `node --test scripts/private-entry-check.mjs`.
Current credentials, expiry, entry ownership and remaining gates are in the review.

For an isolated complete installation check, set `MAHJONG_REVIEW_ROOT` to the
absolute Mahjong repository and run `node scripts/mahjong-installation-check.mjs`.
For the PostgreSQL 17 non-superuser ownership-transfer check, also configure
`JOY8_TEST_PG_BIN` per README and run
`node scripts/mahjong-native-installation-check.mjs`. Both use local fixtures;
neither reads hosted credentials. The native case verifies temporary schema
CREATE and role SET/INHERIT privileges are removed after ownership transfer,
while only the platform operator can invoke the accounting callback.
