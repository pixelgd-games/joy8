# Whitelist Release Review

Status: the three approved SQL migrations are applied in order. Cleanup counts
and fingerprints matched all 18 approved entries immediately before application.
The Dashboard Before User Created Hook is enabled for
`public.joy8_before_user_created`; no other Auth settings were changed.
Gateway and Pages changes are deployed. The hosted allowlist page displays the
administrator and the user-requested Johnny email. Johnny's new verified Google
identity is recorded in hosted Auth; outside-list new Google signup still needs
a designated real test identity. Existing administrator access remains working.
The approved product policy is in [PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md).
The identity contract is in [MEMBER_AUTH_PLAN.md](../platform/MEMBER_AUTH_PLAN.md).

For routine email additions, use the verified-admin page at `/admin/access/`.
Do not create further migrations containing individual allowlist emails. Earlier
applied allowlist migrations remain unchanged deployment history.

## SQL approval units

The email, cleanup and reserve files below were individually approved and applied.
The user's subsequent instruction to complete the named release authorized the
payout/key activation and Johnny allowlist addition; these are also applied.
For subsequent work, review each remaining file separately; move only an approved
file into `supabase/migrations/` and classify it in `scripts/fixtures/platform-sources.json`.
Never edit applied migrations, reset the database, or apply all drafts together.

| SQL | Effect | Status / gate |
| --- | --- | --- |
| [Email access](../../supabase/migrations/20260927100000_email_play_allowlist.sql) | New normalized email table, admin RLS, protected admin entries, Before User Created Hook and enrollment/session insert guards | Applied; administrators seeded and verified |
| [Test-player cleanup](../../supabase/migrations/20260927110000_clear_reviewed_test_players.sql) | Deletes exactly the reviewed non-admin identities and platform test accounting | Applied; exact counts/fingerprints matched |
| [Mahjong reserve](../../supabase/migrations/20260927120000_mahjong_release_reserve.sql) | Removes only the 1-POINT reserve guard, retaining full-balance and the existing adapter | Applied; does not by itself make funded play ready |
| [Mahjong payout](../../supabase/migrations/20260927120500_mahjong_payout_safety_limit.sql) | Changes only `max_payout_amount` from 1 to 100,000,000 POINT | Applied with strict policy/adapter preconditions |
| [Mahjong key scope](../../supabase/migrations/20260927121000_mahjong_reviewed_key_scopes.sql) | Approves the existing key for exchange/renew/open/settle/status/cancel | Applied after the payout policy; secret unchanged |
| [Johnny access](../../supabase/migrations/20260927122000_allow_johnny_google.sql) | Adds the explicitly requested Google email | Applied; grants play access, not administrator access |
| [Mahjong publication](../../supabase/migrations/20260927123000_publish_mahjong_clash.sql) | Publishes the verified Pages URL and keeps the localhost private entry disabled | Applied after successful WSS and Origin rejection checks |
| [Mahjong cover](../../supabase/migrations/20260927124000_mahjong_clash_cover.sql) | Sets only `games.thumbnail` to `/games/mahjong-clash/cover.webp` | Applied with the reviewed catalog-state guard; draft removed |
| [Mahjong max-loss reservation](../../supabase/migrations/20261003100000_mahjong_max_loss_reservation.sql) | Switches the policy from full-balance to capped 300–10,000 POINT and replaces the opening and posting functions | Applied with the authority stopped and no open match; new authority deployed |
| [Mahjong schema alignment](../../supabase/migrations/20261003101000_mahjong_hosted_schema_alignment.sql) | Re-applies the two accounting functions outside the policy guard and removes PUBLIC execute from `guard_posted_hand` | Applied; hosted-schema replay equals the Mahjong product SQL |

The key review binds game `faaa45eb-7d7d-40b5-9081-3dd73482adfa` and existing
key ID `a2eeea4b-026b-4e32-bfd8-1d75223ad92b`. It retains the current secret/hash,
does not generate or deliver credentials, and grants no database/table authority.
This activation follows the explicit scope approval under the
[credential workflow](../../integrations/third-party/README.md#platform-operator-flow),
not a scope-expanding rotation through the Worker provisioning tool.
The game backend remains responsible for protecting its installed key.

## Reviewed cleanup snapshot

Read-only inventory taken on 2026-09-27. The migration verifies full-row
fingerprints and counts under table locks. Any changed data requires a new
read-only snapshot, revised draft and renewed user approval. Zero open matches
and zero locked wallet balances are required; never erase an unresolved match.

Retain `pixelgd.games@gmail.com`, Auth ID
`ac5cb167-7cdc-4e49-ba50-47a8a5220b88`, its Google identity, sessions and tokens.
This administrator currently has no player/wallet row. If that changes, stop and
review instead of deleting the administrator's player data.

| Table | Rows to delete |
| --- | ---: |
| `public.player_accounts` | 7 |
| `public.wallet_accounts` | 7 |
| `public.wallet_transactions` | 443 |
| `public.game_sessions` | 48 |
| `public.joy8_matches` | 384 |
| `public.joy8_match_participants` | 384 |
| `public.joy8_settlements` | 458 |
| `public.joy8_settlement_entries` | 870 |
| `auth.users` | 7 |
| `auth.identities` | 2, through existing user FK |
| `auth.sessions` | 9, through existing user FK |
| `auth.mfa_amr_claims` | 9, through existing session FK |
| `auth.refresh_tokens` | 139 |
| `auth.flow_state` | 2 |

The retained administrator has 13 sessions, 84 refresh tokens and 13 MFA AMR
claims in this snapshot. Catalog, admin rows, policies, Backend Keys, private
entry configuration and product registry are preserved. Rate counters are not
player history and remain under the existing runtime cleanup job.

Mailbox messages/recipients, recovery records and fee accounts are empty and
must remain empty for this draft. Mahjong gameplay/accounting/AI tables are empty;
its three configuration rows (`economy_state`, `economy_versions`,
`lifecycle_config`) are preserved. The draft locks and checks product gameplay
tables for unexpected data but does not modify them. Monster Lab D1 is untouched.

The single cleanup transaction temporarily disables exactly the three immutable
ledger delete triggers while holding exclusive table locks, performs ordered
DELETEs, and re-enables all three before commit. Foreign keys remain active.
Any error rolls back both deletes and trigger changes. No TRUNCATE, reset,
CASCADE command, blanket trigger disabling or deletion of schema history is used.

Read-only evidence queries:
[inventory](../../scripts/sql/whitelist-release-inventory.sql),
[cleanup fingerprints](../../scripts/sql/whitelist-cleanup-snapshot.sql).
Run the required Joy8 project check before each operation.

## Auth and acceptance boundaries

The applied SQL seeded the Google administrator and installed private hook
permissions, admin RLS and player/session guards. Read-only checks
[email-allowlist-status.sql](../../scripts/sql/email-allowlist-status.sql) verify
all seven prerequisites. Dashboard shows exactly one enabled hook:
Before User Created, Postgres, `public.joy8_before_user_created`.
Do not change provider switches, other hooks or tokens for this task.

[whitelist-release-status.sql](../../scripts/sql/whitelist-release-status.sql)
confirmed the retained administrator and zero player/accounting rows immediately
after cleanup. New real membership has since created player/wallet/session rows;
do not repeat cleanup. Three immutable-ledger triggers remain enabled. The policy
uses capped reservations of 300 to 10,000 POINT and a 100,000,000-POINT safety ceiling;
the key has all six reviewed scopes. Monster Lab D1 was not touched.
The hosted CLI cannot SET ROLE to `supabase_auth_admin` or directly execute the
private hook; its grants were not broadened to enable a probe.

Gateway and Pages are deployed. Hosted health and unauthenticated/origin rejection
checks passed without creating business data. Google-only Hook and session guards
reject anonymous identities in automated tests; Guest entry is absent from the
production UI. Current manual catalog and session-entry coverage belongs in
[KNOWN_ISSUES.md](KNOWN_ISSUES.md#test-gaps), including the distinction between
disabled hosted independent entry and enabled local test coverage.

Remaining whitelist acceptance:

1. The user will use a fresh Google test identity to verify outside-list rejection.
   Inside-list successful signup is recorded for Johnny; existing administrator
   access alone is not proof of new-user hook execution.
2. Hosted allowlist add/remove and subsequent session denial still need a designated
   disposable identity. Catalog draft editing does not verify allowlist management;
   automated access/RLS tests cover these database boundaries.

The standalone Auth config helper, if separately authorized in another task,
only patches the two Before User Created fields for `enable-whitelist`; it
preserves every provider setting. It was not used for this activation.

The current test bundle includes the access and Google-only migrations.
Financial, member, private-entry, public-ID and Gateway regressions use
allowlisted Google fixtures through `loadCurrentPlatform`; the old
`loadPreAllowlistPlatform` entry point is removed. The access suite tests the
actual Auth invoker role, RLS, Google allow/deny, anonymous denial and session
denial after removal. Cleanup tests seed historical records before installing
the access migration to verify that one-time operation; they do not restore
Guest support in the runtime.

Vendor contract: [Before User Created Hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).

## Mahjong activation dependencies

The hosted policy has `max_payout_amount=100000000` and capped reservations of
300 to 10,000 POINT. The user selected 100,000,000 POINT, matching Monster
Lab's round safety limit. Mahjong caps each payer's payment at its seat's
reserved amount (zero-floor cap); AI reserves its full balance, which can grow with results.
The value is a mistake-prevention ceiling, not an intended bet or award.
The payout migration changed only that field and rejected changed policy/adapter
state. Key activation required this reviewed ceiling before expanding the existing
key. Both are applied. No Joy8 human wallet is created for AI.

Mahjong owns low/middle/high entry thresholds, full gameplay validation and its
`ai_accounts`; no game-side code is changed here. Its server target is
`wss://mahjong-clash.joy8.cc` through the user's Windows Cloudflare Tunnel service.

Cloudflare confirms `https://mahjong-clash.pages.dev/` as the production URL.
The Pages build is deployed and the Origin Block rule is active. Catalog
publication uses that exact URL and preserves the disabled localhost private
entry. The correct Origin upgrades to WebSocket (101); missing and different
Origins receive 403. The public Lobby displays Mahjong and its installed cover.
Real Lobby-to-game settlement acceptance remains open. The Mahjong deployment document owns its
Windows service, build and ingress operation details.
