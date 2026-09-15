# Looty Product Scope

This document defines what Looty is, what it owns, and which product directions are approved. It does not define implementation details, database history, or the game runtime protocol.

Last reviewed: 2026-09-15.

## Product Definition

Looty is a lightweight H5 game platform that gives players one place to discover and launch games while keeping platform identity, sessions, and wallet authority outside individual games.

The product is intentionally small enough for one person to operate:

- Static front end on Cloudflare Pages.
- One managed Supabase project initially for shared Auth, catalog, administration, platform data, the Gateway, and permission-separated game schemas.
- Independent game deployments embedded through a stable platform contract.
- Minimal platform-specific adapters inside games that target more than one distribution platform.

## Product Outcomes

Looty succeeds when:

- A player can discover a published game and launch it reliably from the Lobby.
- A direct game entry can eventually use the same Looty identity and the correct platform or game-scoped wallet without requiring the public Lobby.
- A game integrates once with the documented Looty contract instead of implementing platform ownership itself.
- Administrators can manage catalog metadata without exposing protected platform data.
- The platform can diagnose launch and wallet failures without storing secrets or sensitive player data.
- A non-gambling game can share one core build across Looty and CrazyGames while keeping platform services isolated.

## Current Product

Implemented today:

- Public Lobby backed by `public_games_v1`.
- Published-game Loader with an iframe shell and platform error handling.
- Google OAuth administrator entry and game catalog CRUD.
- Guest session creation through `looty-gateway`.
- One-time launch-code exchange and in-memory Gateway authorization.
- Demo `POINT` wallet endpoints for balance, bet, payout, refund, and round close.
- Cloudflare Pages deployment and PWA metadata.

Not implemented today:

- Public member login or account management UI.
- Persistent guest reuse within a retained browser profile or app installation.
- Production money movement.
- Full analytics, dashboards, alerts, or health monitoring.
- A general game SDK package.

The repository implementation is described in `../../README.md`.

## Ownership Boundaries

### Looty Platform

Looty owns:

- Game discovery and catalog metadata.
- Platform identity and membership entry.
- Game-session creation.
- Launch-code and Gateway-token issuance.
- Wallet authority and transaction records.
- The minimum financial round summary required for wallet settlement.
- The Loader iframe shell, permissions, timeout, and platform error states.
- Lobby cover images and platform presentation.
- Platform analytics and monitoring.

### Games

Each game owns:

- Gameplay and rendering.
- Game resources and in-game user experience.
- CSP, `X-Frame-Options`, and iframe compatibility.
- Its calls to the active platform client.
- Game-specific settings or save payloads.
- Its game-owned schema and backend boundary, player mapping, authoritative match state, actions, results, history, progression, and rankings.

A game must not:

- Authenticate Looty members.
- receive provider credentials.
- write player or wallet tables.
- change a Looty balance directly.
- write gameplay data into Looty-owned platform tables or another game's schema.
- infer a platform from iframe presence alone.

### Sibling Flash Modules

Looty must not absorb unrelated responsibilities from sibling Flash modules. Cross-module background belongs in `../platform/FLASH.md`; each module remains independently maintainable.

## Approved Platform Direction

### Shared Game Core

Non-gambling games may use one core build with three explicit platform clients:

- Looty Client.
- CrazyGames Client.
- Local Client for local development only.

Only one client may be active at a time. The Local Client must not silently replace a failed production platform.

Gambling products do not ship to CrazyGames. Every product in `D:\Studio\Project-Gaming` remains classified as gambling unless the user explicitly moves and reclassifies it.

The runtime contract is in `../platform/GAME_PLATFORM_INTEGRATION.md`. CrazyGames requirements are in `../platform/CRAZYGAMES_INTEGRATION.md`.

### Member and Direct Game Entry

Looty needs a minimal platform identity layer so a player can enter through the Lobby or a Looty-controlled branded game entry and still reach the same platform player and the approved wallet scope.

This direction applies to every Looty game. `Mahjong Clash` is an initial adoption case, not a product-specific identity architecture. A game may launch through its own branded entry before the public Looty Lobby, but the entry still uses the shared Looty Auth identity and player ID. A branded entry is a platform surface, not in-game authentication. The game runtime must never receive Google, Apple, Facebook, or other provider credentials.

A branded standalone entry may remain available after the same title is listed on Looty and does not need to redirect customers through the Lobby. Both surfaces resolve the same Looty member, while wallet and game-progress behavior follows the product's approved scope.

This shared identity applies to Looty-operated surfaces, including the Lobby and Looty-controlled branded entries. A separate CrazyGames build or another external platform channel uses its own approved platform client and must not call Looty identity, session, or wallet services.

The detailed design, unresolved login choices, persistent guest behavior, account linking, and delivery phases are owned by `../platform/MEMBER_AUTH_PLAN.md`. That plan remains separate and must be reviewed before implementation.

## Wallet Direction

Entry style and wallet scope are separate decisions. A game can have its own branded entry while still sharing Looty membership.

| Product model | Member identity | Wallet | Persistent game data |
| --- | --- | --- | --- |
| Full game with an independent economy | Shared Looty member on Looty-operated surfaces | One game-scoped wallet per player and game | Dedicated game-owned schema and backend boundary |
| Looty-native shared-economy game, such as a platform slot or compact table game | Shared Looty member | Common Looty platform wallet | Dedicated game or approved family schema and backend boundary |

- Looty is the only wallet authority for Looty-launched sessions.
- The current wallet mode is Demo and supports only `POINT`.
- New Demo `POINT` wallets currently receive a 10,000-point test credit.
- The current implementation reuses one active wallet per player and currency across games.
- Demo transactions do not represent real money.
- The database-level Demo currency constraint is deliberately on hold and must not be implemented without a new user decision.
- Full independently operated games use a separate game-scoped wallet per player and game.
- Looty-native games that depend on a shared platform service use one common Looty platform wallet per player.
- Activity in one independent game does not change another independent game's wallet or the platform wallet.
- Activity in one Looty-native game intentionally changes the platform balance available to other Looty-native games.
- Game currencies use a common nominal unit with a `1:1` reference ratio to a possible future Looty platform currency.
- The `1:1` ratio does not provide a current exchange, transfer, redemption, or withdrawal right.
- Looty-native games sharing the platform wallet do not convert currency; they spend the same balance directly.
- Currency conversion between an independent game wallet and Looty, or between independent game wallets, is deliberately deferred and must not be implemented without a separate user decision.
- A platform-wallet initial credit is granted once per player, not once per Looty-native game. Every platform-wallet transaction retains its originating game ID.
- Production wallet requirements must be designed as a separate phase with security, audit, settlement, and recovery requirements.

The initial architecture may host Looty and game data in one managed Supabase project to control cost, but ownership and access remain separated by custom schema, explicit permissions, and backend boundaries. A game or intentionally shared game family owns its detailed rooms, matches, hands, actions, results, progression, and history in its own schema. Looty's `game_rounds` remains only a platform financial summary. The systems correlate through stable platform references and documented session and round identifiers, and the design must preserve a path to move a game into an independent database later.

## Catalog Direction

The database is the catalog source. Looty must not add a local `enabled-games` allowlist.

A published catalog item needs:

- A stable game identifier and slug.
- A valid HTTPS launch URL.
- A Looty-managed `750 x 1000` WebP cover.
- Correct type and capability metadata.
- A verified Loader-to-iframe launch.

Published status describes platform availability; it does not make Looty responsible for changing a game's own source code.

## Explicitly Out of Scope

Unless the user changes the product direction, Looty does not own:

- A framework migration to React, Vue, or Next.js.
- A server-rendered application.
- Game source repositories.
- Game rendering or resource failures.
- CrazyGames services for gambling products.
- Game-controlled login or balance mutation.
- A front-end path to service-role database RPCs.
- A separate member master for a branded game entry.
- Conversion between independent game wallets and the Looty platform wallet in the current phase.
- Pre-launch legacy data compatibility.
- Responsibilities that belong to unrelated Flash products.

## Current Priorities

1. Review and approve the member and direct-entry plan before implementing it.
2. Add reliable analytics and monitoring without recording launch codes, Gateway tokens, or sensitive identity data.
3. Close the documented production-readiness decisions, including the Demo test-credit and database currency-constraint hold.
4. Continue game catalog and integration work through the stable platform contract.
5. Keep documentation and verification aligned with the actual repository.

Detailed active risks are tracked in `../operations/KNOWN_ISSUES.md`. Analytics delivery is planned in `../operations/ANALYTICS_MONITORING.md`.

## Decision Rules

When evaluating a new feature:

1. Keep identity, session, and wallet authority in Looty.
2. Keep gameplay and rendering in the game.
3. Prefer a small extension to an existing contract over a parallel system.
4. Keep one source of truth for catalog and platform data.
5. Separate gambling and CrazyGames distribution.
6. Reject work that adds operational weight without a clear product outcome.
7. Record approved product decisions here; keep implementation detail in the owning technical document.
