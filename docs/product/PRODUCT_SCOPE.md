# Looty Product Scope

This document defines what Looty is, what it owns, and which product directions are approved. It does not define implementation details, database history, or the game runtime protocol.

Last reviewed: 2026-09-16.

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

## Current Implementation

[README.md](../../README.md) owns the implemented feature list and operating
instructions. The member, scoped-wallet, and trusted-settlement capabilities
below are targets, not completed functionality.

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

### First Release and Entry Models

- First release: H5. Android and iOS are later work, not first-release gates.
- Sign-in: Google, basic account/password, and persistent guest access.
  [MEMBER_AUTH_PLAN.md](../platform/MEMBER_AUTH_PLAN.md) owns their design.
- Mahjong Clash is the first adopter, not the architectural center of Looty.
  Platform capabilities must be reusable by other products.

| Product model | Entry and release | Wallet | Game data |
| --- | --- | --- | --- |
| Independently operated game, such as Mahjong Clash | Own branded entry may launch before the public Looty Lobby | One game-scoped wallet per player and game | Game-owned schema and authoritative backend |
| Looty-native shared-economy game, such as a platform slot or compact table game | Operates with the platform and its shared services | One common platform wallet per player | Game-owned or intentionally shared family schema and backend |

Both use the same Looty membership on Looty-operated surfaces. Independent
entry does not create a separate member system. A branded entry may remain
available after Lobby listing; the player keeps the same identity, wallet,
and product progress through either entrance. Platform-native products retain
their shared-entry/shared-wallet model; they need not become standalone games.
Neither model exempts a game from trusted settlement and security requirements.

External channels such as CrazyGames use their own approved platform identity
and must not initialize Looty Auth, sessions, or wallets.

## Wallet and POINT Direction

- Looty owns human-player wallet authority. Trusted catalog configuration
  chooses platform or game scope; clients and games cannot choose their scope.
- Independent-game balances do not affect another game's or the platform's
  balance. Platform-native games intentionally consume the same balance.
- Platform initial credit is granted once per player, not once per title.
  Independent-game initial-credit amounts remain product-specific.
- POINT is intended for operational play, not a disposable Demo-only design.
  Build one wallet/accounting architecture for testing and operation while
  isolating their data. The current Demo implementation remains described in
  [GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md).
- Purchasing POINT is an allowed future product capability. Whether it ships
  at the first public launch is undecided. No payment provider, purchase price,
  or payment deployment is authorized by this document.
- No redemption, withdrawal, or prizes of monetary value are included.
  Cross-wallet conversion and transfer are also outside the current scope.
  The existing nominal `1:1` reference between units grants none of these rights.
- Preserve transaction source: initial grant, promotional grant, purchase,
  gameplay, fee, and authorized adjustment. AI funding is distinct from human
  purchases and fee revenue. A POINT fee is not itself a cash-revenue report.
- Payment orders, verified payment notifications, duplicate protection, and
  refund/chargeback handling must be designed before purchasing is enabled.
  Purchase timing does not delay the reusable wallet and settlement foundation.
- Record the originating game on gameplay transactions and the target scope
  and source reference on grants, purchases, and adjustments. Platform-wide
  transactions must not invent a game ID.

Detailed trust, wallet-lifecycle, and atomic-settlement requirements belong in
[GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md).

## Data and Environment Direction

Use one codebase with a local test environment and one hosted operational
environment initially. A permanently hosted staging site is not required for
the initial solo-operator workflow; a temporary isolated preview can be added
when an integration or release needs it. Different URLs against the same live
database do not provide test isolation.

Local tests use separate data, credentials, and configuration. Do not promote
test balances, transactions, or fee totals into operational accounts. Before
public operation, explicitly review existing Demo data and define the opening
balances and cutover; this is not authorization to delete or reset data.
The present repository cannot recreate the full local database from migrations
alone. A reviewed bootstrap/fixture and backup/restore procedure are prerequisite
work, tracked in [KNOWN_ISSUES.md](../operations/KNOWN_ISSUES.md).

The initial hosted cost model may share one Supabase project across Looty and
game-owned schemas, with explicit roles and backend boundaries. A game owns
its detailed gameplay data; Looty keeps only platform and accounting records.
Shared compute, outages, and backups remain coupled. Keep schema dependencies
separable so a game can later move without changing its identity/wallet contract.
Each game's runtime host is a separate assignment; sharing Supabase does not
choose or provide that host.

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

## Delivery Order

First align the documents and define the versioned platform contract. Then:

1. **Platform:** implement reusable membership, both wallet scopes, launch and
   server authorization, atomic settlement, and minimal recovery/monitoring.
   Verify with a simulated game, including independent and shared-wallet cases.
   Do not require Mahjong source code or public Lobby release to finish this stage.
2. **Product:** in each product repository, implement its rules, authoritative
   state, persistence, economy, and platform adapter against that contract.
   A contract simulator may be used for isolated tests, never as a live fallback.
3. **Integration:** connect real services and verify entry, gameplay, settlement,
   re-entry, expired credentials, concurrent requests, retries, and failure recovery.

Define request/response fields and failure cases during the platform stage;
do not postpone the interface design until integration. Documentation changes
do not imply that implementation, migrations, or deployment have been completed.

Identity details belong in [MEMBER_AUTH_PLAN.md](../platform/MEMBER_AUTH_PLAN.md),
runtime contracts in [GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md),
active blockers in [KNOWN_ISSUES.md](../operations/KNOWN_ISSUES.md), and
observability in [ANALYTICS_MONITORING.md](../operations/ANALYTICS_MONITORING.md).

## Decision Rules

When evaluating a new feature:

1. Keep identity, session, and wallet authority in Looty.
2. Keep gameplay and rendering in the game.
3. Prefer a small extension to an existing contract over a parallel system.
4. Keep one source of truth for catalog and platform data.
5. Separate gambling and CrazyGames distribution.
6. Reject work that adds operational weight without a clear product outcome.
7. Record approved product decisions here; keep implementation detail in the owning technical document.
