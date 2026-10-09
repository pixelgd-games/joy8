# Gateway Rate-Limit Redesign (Draft for Owner Review)

Status: proposal only. No SQL is written or applied. Any change needs a reviewed
incremental migration, a regenerated `supabase/bootstrap/platform.sql`, the
matching Gateway deploy (SQL first) and updates to the limit table in
[GAME_PLATFORM_INTEGRATION.md](../../docs/platform/GAME_PLATFORM_INTEGRATION.md#security-and-failure-behavior).

Current definitions: `joy8_admit_gateway_request` and `joy8_server_request_v1`
in `supabase/migrations/20261007100000_match_reserve_increase.sql`;
`joy8_consume_gateway_rate_limit` in `supabase/bootstrap/platform.sql`; ingress
keys in `supabase/functions/joy8-gateway/server-routes.ts` and `http.ts`.

## Verified issues

### 1. One open budget per game

`server-open-v1` is admitted under `backend:<game>:open`, 120 requests per
fixed 60-second window, shared by every player of the game. A slot that opens
one match per spin (including `openMatch` with an embedded settlement) is
limited to about 2 spins per second across all players; a window boundary can
admit up to 240 in a short burst. Every server route of the game also shares
`backend:<game>` at 6,000 per minute (100 per second).

### 2. Server ingress is keyed by client address

`joy8_server_request_v1` first consumes `ingress:<address>` (10,000 per 60
seconds), where the address is `cf-connecting-ip`, then `x-real-ip`, then the
first `x-forwarded-for`. This happens before the Backend Key is checked, so
requests with invalid keys also consume it. Measured: Cloudflare Workers reach
the Gateway with the shared address `2a06:98c0:3600::103` (an operational
observation, not visible in code). Every Worker-hosted game therefore shares one
10,000-per-minute bucket, and any third-party Worker can exhaust it with invalid
requests. `joy8_consume_gateway_rate_limit` also caps any limit at 10,000.

### 3. Counter row locks are held for the whole operation

`joy8_server_request_v1` runs as one PostgREST transaction. It upserts the
ingress row, then `backend:<game>`, then the subject row
(`backend:<game>:open`, `session:<id>:login` or `match:<id>:<action>`), and only
then runs the business operation. `INSERT ... ON CONFLICT DO UPDATE` keeps each
row locked until commit, including while the business operation runs and when
the `WHERE request_count < limit` update is skipped. Correction to the original
report: this serializes every server request of a game on `backend:<game>`, not
only opens, and because Worker-hosted games share one ingress row (issue 2), it
serializes all of their server requests platform-wide. Browser routes are not
affected: they consume counters in separate short RPC calls.

## Proposed changes

1. **Per-session open admission plus a per-game ceiling.** Count opens per human
   participant session (`session:<id>:open`, for example 120 per minute), after
   checking that each session is active and belongs to the verified game. Keep a
   per-game ceiling, configured per game in trusted policy and set from measured
   capacity rather than a fixed 120. Ceilings above 10,000 need sharding (below)
   or a higher function cap.
2. **Key server routes by verified game, not address.** Verify the Backend Key
   first (indexed hash lookup), then count only under the verified game. Count
   failed authentication separately by address
   (`server-auth-fail:<address>`), consumed only on failure, so invalid keys stay
   limited without sharing a bucket with valid Worker traffic.
3. **Shorten or spread hot locks.** For per-game counters, either shard the key
   (`backend:<game>:<0..N-1>`, chosen at random, each with `ceil(limit/N)`), or
   read the counter without locking before the operation and increment it after
   the operation, so the lock lasts only until commit. Low-contention per-session
   and per-match counters can stay as they are. A separate admission transaction
   is not proposed because it restores the extra round trip that the single-trip
   design removed.

## Verification before release

Extend `test:gateway-rate` and the native PostgreSQL suites with competing
connections: concurrent opens from many sessions of one game, several games
sharing one address, invalid-key floods, and a check that limits still hold
within the documented tolerance.
