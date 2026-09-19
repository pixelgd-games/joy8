# Review-only SQL

SQL under this directory is excluded from active migration discovery. The three
original files in `mahjong-clash/` are superseded, incomplete and unapplied; do
not combine them with the installed product schema.

The approved public-ID allocation/profile correction and product-schema
registration are installed as `../migrations/20260920110000_public_id_allocation.sql`
and `../migrations/20260920111000_product_schema_registration.sql`.
[README](../../README.md#verification) owns their verification and current state;
[the integration contract](../../docs/platform/GAME_PLATFORM_INTEGRATION.md#product-schema-registration)
owns ongoing schema registration and DDL permission checks.

## Platform Hardening

The three approved corrections are installed under `../migrations/`:

- `20260920120000_product_ddl_guard.sql`: validate supported DDL at commit.
- `20260920121000_public_id_collision_locks.sql`: release rejected candidate locks.
- `20260920122000_product_adapter_validation.sql`: optimize runtime isolation scans.

There are no pending platform-hardening drafts. Tests resolve these paths through
`scripts/fixtures/platform-hardening.mjs`; default fixtures load the installed SQL.
[README](../../README.md#verification) owns the acceptance commands and deployment
state; the [integration contract](../../docs/platform/GAME_PLATFORM_INTEGRATION.md#product-schema-registration)
owns the DDL and role-preflight requirements.

## Installed Mahjong Work

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
