# Looty Game Platform Integration

This document is the authoritative runtime contract between Looty and a game. It defines platform selection, launch parameters, Gateway requests, wallet behavior, and responsibility boundaries.

It does not own member-entry design, CrazyGames submission rules, repository setup, or deployment history.

Last verified against the repository: 2026-09-15.

## Core Rule

A game owns gameplay. Looty owns platform identity, session authorization, wallet authority, the Loader shell, and platform-level errors.

A game must never:

- Log a player into Looty.
- Receive identity-provider credentials.
- Receive a Supabase anonymous key, member JWT, or service-role key from the Loader.
- Write Looty player, wallet, session, round, or transaction tables.
- Change a player balance directly.
- Store a Looty launch code or Gateway token in local storage, session storage, IndexedDB, logs, Analytics, or save data.

## Platform Clients

A non-gambling game that targets multiple platforms should keep one gameplay core and use an explicit platform client:

| Client | Use |
| --- | --- |
| Looty Client | Looty launch parameters and Looty Gateway |
| CrazyGames Client | CrazyGames SDK, ads, saves, and platform lifecycle |
| Local Client | Local development and contract simulation only |

Only one platform client may be active during a session.

Selection must use an explicit build target or an equally reliable platform signal. Iframe presence is not enough because Looty and CrazyGames may both embed games.

The Local Client must never activate automatically after a production client fails to initialize. A real-platform failure must produce a visible error.

Gambling products do not receive a CrazyGames Client or build. Every product in `D:\Studio\Project-Gaming` remains gambling unless the user explicitly moves and reclassifies it.

CrazyGames-specific requirements are in `CRAZYGAMES_INTEGRATION.md`.

## Responsibility Matrix

| Concern | Looty Platform | Game |
| --- | --- | --- |
| Game catalog and published status | Owns | Does not own |
| Member or guest identity | Owns | Does not own |
| Session and token issuance | Owns | Consumes |
| Wallet balance and transactions | Owns | Requests through the active client |
| Loader iframe shell | Owns | Does not own |
| Sandbox and `allow` permissions | Owns | Must remain compatible |
| Platform load timeout and error screen | Owns | Reports game-ready state only if a future handshake is added |
| CSP and `X-Frame-Options` | Reports failures | Owns |
| Rendering and resources | Does not own | Owns |
| Gameplay rules | Does not own | Owns |
| Financial round summary for wallet settlement | Owns | Supplies stable round references through authorized calls |
| Authoritative rooms, matches, hands, actions, results, and history | Does not own | Owns in its game database |
| Game-specific save data | Provides a platform adapter when applicable | Owns the payload |

Do not modify a game repository from a Looty repository task. Switch to the named game repository for game-side changes.

## Current Looty Launch Flow

1. A player opens `/game/?slug=<slug>`.
2. The Loader reads the published game from `public_games_v1`.
3. It normalizes the `launch_url`. Root-relative platform paths and HTTPS URLs are accepted. HTTP is accepted only between loopback hosts during local development.
4. It calls `looty-gateway/create-session`.
5. The Gateway resolves the optional Supabase member session. Without a valid member token, it creates a guest session.
6. The Gateway creates or selects the platform player and Demo wallet through protected database RPCs.
7. The Loader appends the returned session parameters to the game URL.
8. The Loader creates the iframe.
9. The game exchanges the launch code once for a Gateway token.
10. The game keeps that token only in memory and uses it for wallet calls.

The current Loader requests `POINT` with a one-hour session expiry.

## Loader Query Parameters

| Parameter | Meaning | Handling |
| --- | --- | --- |
| `looty_session_id` | Public session reference | May be used for correlation; not authorization |
| `looty_launch_code` | One-time exchange credential | Exchange immediately; keep in memory; never log |
| `looty_game_id` | Looty game identifier | Treat as platform metadata |
| `looty_currency` | Session currency | Currently `POINT` |
| `looty_wallet_mode` | Wallet mode | Currently Demo |
| `looty_gateway_url` | Gateway base URL | Use for wallet routes |
| `looty_exchange_url` | Direct exchange URL | Use for launch-code exchange |

All parameters are supplied by Looty. A game must not replace them from user-controlled values.

## Iframe Contract

The current Loader sets:

```text
sandbox="allow-forms allow-orientation-lock allow-pointer-lock allow-scripts"
allow="autoplay; fullscreen; gamepad"
referrerpolicy="no-referrer"
```

For a cross-origin game, the Loader also adds `allow-same-origin`. The Loader uses eager loading and a 30-second load-event timeout.

The current timeout observes the iframe `load` event, not game readiness. If a future ready handshake is introduced, it must extend this contract explicitly; a game-specific workaround must not replace the platform behavior.

The game is responsible for allowing Looty to embed it and for functioning under this sandbox. If CSP, `X-Frame-Options`, resource loading, or in-game rendering fails, diagnose and report the game-side problem; do not weaken the platform shell without a security review.

## Gateway Base URL

```text
https://lsazydefvnuqglultqii.supabase.co/functions/v1/looty-gateway
```

The Gateway source in this repository corresponds to version 5. All routes accept `POST` JSON. The Gateway adds `X-Looty-Request-Id` to responses.

## Session Creation

Endpoint:

```text
POST /create-session
```

Request:

```json
{
  "slug": "game-slug",
  "currency": "POINT",
  "expires_in_seconds": 3600,
  "display_name": "Optional guest display name"
}
```

Rules:

- `slug` must identify an available published game.
- `currency` defaults to `POINT` and Demo currently accepts only `POINT`.
- `expires_in_seconds` must be from 60 to 86,400.
- `display_name` is optional and limited to 120 characters.
- A valid Supabase member bearer token binds the session to that member.
- A missing bearer token, or the browser anonymous-key bearer produced by the Supabase client, creates a guest session.
- The route requires an allowed Looty origin. Localhost development ports are accepted.

Relevant response fields:

```json
{
  "session_id": "...",
  "game_id": "...",
  "player_account_ref": "...",
  "launch_code": "...",
  "launch_code_expires_at": "...",
  "account_type": "guest",
  "currency": "POINT",
  "wallet_mode": "demo",
  "expires_at": "..."
}
```

The launch code is valid for two minutes and can be used once.

## Launch-Code Exchange

Endpoint:

```text
POST /exchange
```

Request:

```json
{
  "launch_code": "..."
}
```

Relevant response fields:

```json
{
  "session_id": "...",
  "game_id": "...",
  "player_account_ref": "...",
  "gateway_token": "...",
  "gateway_token_expires_at": "...",
  "scopes": ["balance", "bet", "payout", "refund", "close-round"],
  "account_type": "guest",
  "currency": "POINT",
  "wallet_mode": "demo",
  "expires_at": "..."
}
```

The Gateway token is valid for at most one hour and is bound to its session, game, player, wallet, and scopes. Keep it only in runtime memory.

## Wallet Calls

### Balance

```text
POST /balance
```

```json
{
  "gateway_token": "..."
}
```

The response contains the session reference, player reference, currency, available balance, and locked balance.

### Bet, Payout, and Refund

Endpoints:

```text
POST /bet
POST /payout
POST /refund
```

Request:

```json
{
  "gateway_token": "...",
  "round_id": "game-generated-round-id",
  "amount": 100,
  "idempotency_key": "stable-key-for-this-operation",
  "metadata": {}
}
```

Rules:

- `amount` must be greater than zero.
- `round_id` is required and identifies the game round within the current session.
- `idempotency_key` is required and must remain stable for retries of the same operation.
- Reusing an idempotency key with different transaction content is an error.
- `metadata` is optional but must be a JSON object.
- The Gateway verifies token, scope, session state, game, wallet, currency, and rate limit before calling a database RPC.
- A bet cannot exceed the available balance.
- Do not simulate a successful wallet mutation after the Gateway rejects it.

The response includes the transaction reference, session, game, round, type, amount, balance before, balance after, and currency.

### Close Round

```text
POST /close-round
```

```json
{
  "gateway_token": "...",
  "round_id": "game-generated-round-id"
}
```

Closing returns the round totals and settlement time. A closed round cannot accept another wallet transaction.

The same `round_id` may exist safely in different game sessions because rounds and transactions are bound to `game_session_id`.

## Wallet Semantics

- The current wallet is Demo only.
- The only accepted Demo currency is `POINT`.
- A new Demo `POINT` wallet currently receives 10,000 points.
- The current database reuses one active wallet per player and currency, so the current `POINT` balance is not game-scoped.
- The credit is recorded as a deposit transaction.
- The database-level Demo currency constraint is intentionally on hold. Do not recreate or apply it without a new user decision.
- Gateway checks remain authoritative while that database constraint is on hold.
- Demo points do not represent real money.
- No platform-to-game, game-to-platform, or game-to-game conversion endpoint exists.

Production-money behavior requires a separate reviewed design.

The approved future multi-game direction has two wallet scopes: a full independently operated game resolves a game-scoped wallet, while Looty-native games that depend on the shared platform resolve one common platform wallet. The current schema cannot make that trusted product-aware choice. Do not make a game depend on the future behavior until the schema, catalog configuration, Gateway, tests, and this contract are updated together. Games must never select their own wallet scope.

## Security and Failure Behavior

Current Gateway safeguards:

- Route and HTTP method validation.
- Origin and CORS checks.
- A 16 KiB streamed body limit.
- Launch-code and Gateway-token hashing in the database.
- Token scope, session, wallet, and game binding.
- Database-backed per-route rate limits.
- A 5-second external authentication timeout.
- An 8-second database RPC timeout.
- Public error normalization that does not expose internal database detail.

Current database-backed limits are keyed by route and client address:

| Route | Requests | Window |
| --- | ---: | ---: |
| `create-session` | 30 | 5 minutes |
| `exchange` | 60 | 5 minutes |
| `balance`, `bet`, `payout`, `refund`, `close-round` | 120 per route | 1 minute |

A 429 response includes `Retry-After`. Clients must wait instead of bypassing the limit with repeated retries.

The Gateway is deployed with `verify_jwt=false` because it performs these checks itself. Protected RPCs remain granted only to `service_role`.

On failure:

- Do not activate the Local Client.
- Do not mint a local balance.
- Do not retry a non-idempotent operation with a new idempotency key.
- Display a clear platform or game error.
- Keep secrets out of logs and analytics events.

## Member and Direct Entry Boundary

The platform may launch a session as a member when the browser already has a valid Looty authentication session. Authentication, provider login, persistent guest identity, account linking, and Looty-controlled branded game entry are not game responsibilities.

Their plan is owned by `MEMBER_AUTH_PLAN.md`. Game integration work should consume the resulting Looty session contract without copying identity-provider logic into the game.

This member contract applies only when the Looty Client is active. CrazyGames and other external platform clients must use their own identity services and must not initialize Looty Auth, sessions, or wallets.

## Database Boundary

The Gateway currently operates through protected RPCs over:

- `player_accounts`
- `wallet_accounts`
- `wallet_transactions`
- `game_sessions`
- `game_rounds`
- `gateway_rate_limits`

`game_rounds` is a platform wallet and settlement summary. It does not store authoritative gameplay state, card or tile history, player actions, reconnect state, progression, or rankings. Each game must keep those records in its game-owned schema and backend boundary.

The game may correlate its authoritative record with Looty by using the supplied player reference and game-session ID together with its own stable `round_id`. These values do not authorize direct table access in either direction. Even when the initial deployment shares one Supabase project, game code must not access Looty-owned tables, another game's schema, or a project-wide service-role key. Wallet mutations remain behind the Looty Gateway.

The browser and game do not receive direct table access. Legacy `players`, `player_balances`, and `ensure_my_player_v1()` must not be restored.

Database operation rules and the current schema summary are in `../../README.md` and `../../AGENTS.md`.

## Integration Checklist

Before publishing a game on Looty:

1. Confirm the product is allowed on Looty and classify whether it is gambling.
2. Confirm the game has a stable HTTPS `launch_url`.
3. Confirm CSP and `X-Frame-Options` allow Looty embedding.
4. Verify the game runs with the documented iframe sandbox and permissions.
5. Implement an explicit Looty Client; do not detect Looty from iframe presence.
6. Exchange `looty_launch_code` once and keep the Gateway token in memory.
7. Use a stable `round_id` that correlates with the authoritative game-database record and an idempotency key strategy.
8. Handle Gateway errors without falling back to fake success.
9. Verify launch, balance, bet, payout, refund, close-round, retry, and insufficient-balance behavior as applicable.
10. Confirm no launch code, Gateway token, member JWT, or provider credential reaches storage, logs, analytics, or save data.
11. Add the Looty-managed `750 x 1000` WebP cover in this repository.
12. Test Lobby to Loader to iframe on the target production origin.

For a dual-platform non-gambling game, also complete the CrazyGames checklist in `CRAZYGAMES_INTEGRATION.md`.

## Contract Changes

Any change to parameter names, token lifetime, endpoint shape, wallet semantics, iframe permissions, platform selection, or error behavior is a contract change. Update this document with the implementation and verify both the Looty Loader and the affected game client.
