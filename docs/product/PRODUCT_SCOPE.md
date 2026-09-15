# Looty Product Scope

This document defines what Looty is, what it owns, and which product directions are approved. It does not define implementation details, database history, or the game runtime protocol.

Last reviewed: 2026-09-15.

## Product Definition

Looty is a lightweight H5 game platform that gives players one place to discover and launch games while keeping platform identity, sessions, and wallet authority outside individual games.

The product is intentionally small enough for one person to operate:

- Static front end on Cloudflare Pages.
- Supabase for catalog, administration, platform data, and the Gateway.
- Independent game deployments embedded through a stable platform contract.
- Minimal platform-specific adapters inside games that target more than one distribution platform.

## Product Outcomes

Looty succeeds when:

- A player can discover a published game and launch it reliably from the Lobby.
- A direct game entry can eventually use the same Looty identity, session, and wallet without requiring the public Lobby.
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
- Persistent guest identity across devices.
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

A game must not:

- Authenticate Looty members.
- receive provider credentials.
- write player or wallet tables.
- change a Looty balance directly.
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

Looty needs a minimal platform identity layer so a player can enter through the Lobby or through a branded game entry and still reach the same platform session and wallet.

`Mahjong Clash` is the first approved direction for a direct member entry. This is a platform entry surface, not in-game authentication. The game runtime must never receive Google, Apple, Facebook, or other provider credentials.

The detailed design, unresolved login choices, persistent guest behavior, account linking, and delivery phases are owned by `../platform/MEMBER_AUTH_PLAN.md`. That plan remains separate and must be reviewed before implementation.

## Wallet Direction

- The platform is the only wallet authority.
- The current wallet mode is Demo and supports only `POINT`.
- New Demo `POINT` wallets currently receive a 10,000-point test credit.
- Demo transactions do not represent real money.
- The database-level Demo currency constraint is deliberately on hold and must not be implemented without a new user decision.
- Production wallet requirements must be designed as a separate phase with security, audit, settlement, and recovery requirements.

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
