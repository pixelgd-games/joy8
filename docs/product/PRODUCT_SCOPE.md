# Joy8 Product Scope

This document defines what Joy8 is, what it owns, and which product directions are approved. It does not define implementation details, database history, or the game runtime protocol.

Last reviewed: 2026-09-20.

## Product Definition

Joy8 is a lightweight H5 game platform that gives players one place to discover and launch games while keeping platform identity, sessions, and wallet authority outside individual games.

The product is intentionally small enough for one person to operate:

- Static front end on Cloudflare Pages.
- One managed Supabase project initially for shared Auth, catalog, administration, platform data, the Gateway, and permission-separated game schemas.
- Independent game deployments embedded through a stable platform contract.
- Minimal platform-specific adapters inside games that target more than one distribution platform.

## Product Outcomes

Joy8 succeeds when:

- A player can discover a published game and launch it reliably from the Lobby.
- A direct game entry can eventually use the same Joy8 identity and shared POINT wallet without requiring the public Lobby.
- A game integrates once with the documented Joy8 contract instead of implementing platform ownership itself.
- Administrators can manage catalog metadata without exposing protected platform data.
- The platform can diagnose launch and wallet failures without storing secrets or sensitive player data.
- A non-gambling game can share one core build across Joy8 and CrazyGames while keeping platform services isolated.

## Current Implementation

[README.md](../../README.md) owns the implemented feature list and operating
instructions. Google/guest member entry, stable public player IDs, the shared POINT wallet
and trusted settlement are deployed foundations. Facebook client support is
implemented in the repository and its Meta app exists in unpublished development
mode, while Meta verification/review, Supabase configuration, provider linking,
continuity and product activation remain open.
Continuous per-hand settlement and the private Mahjong schema are installed;
product activation remains pending as recorded in README and the integration contract. Target policies below do not imply full acceptance.

## Ownership Boundaries

### Joy8 Platform

Joy8 owns:

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

- Authenticate Joy8 members.
- receive provider credentials.
- write player or wallet tables.
- change a Joy8 balance directly.
- write gameplay data into Joy8-owned platform tables or another game's schema.
- infer a platform from iframe presence alone.

### Sibling Flash Modules

Joy8 must not absorb unrelated responsibilities from sibling Flash modules. Cross-module background belongs in `../platform/FLASH.md`; each module remains independently maintainable.

## Approved Platform Direction

### Shared Game Core

Non-gambling games may use one core build with three explicit platform clients:

- Joy8 Client.
- CrazyGames Client.
- Local Client for local development only.

Only one client may be active at a time. The Local Client must not silently replace a failed production platform.

Gambling products do not ship to CrazyGames. Every product in `D:\Studio\Project-Gaming` remains classified as gambling unless the user explicitly moves and reclassifies it.

The runtime contract is in `../platform/GAME_PLATFORM_INTEGRATION.md`. CrazyGames requirements are in `../platform/CRAZYGAMES_INTEGRATION.md`.

### First Release and Entry Models

- First release: H5. Android and iOS are later work, not first-release gates.
- Current sign-in: Google and persistent guest access. Facebook is an approved
  deferred provider whose implementation and unpublished app are retained until
  the operator can complete legitimate business verification and release review;
  it is not a current-release gate.
  [MEMBER_AUTH_PLAN.md](../platform/MEMBER_AUTH_PLAN.md) owns the identity design.
- Mahjong Clash is the first adopter, not the architectural center of Joy8.
  Platform capabilities must be reusable by other products.

| Product model | Entry and release | Wallet | Game data |
| --- | --- | --- | --- |
| Independently operated game, such as Mahjong Clash | Own branded entry may launch before the public Joy8 Lobby | The player's shared Joy8 POINT wallet | Game-owned schema and authoritative backend |
| Joy8-native game, such as a platform slot or compact table game | Operates with the platform and its shared services | The player's shared Joy8 POINT wallet | Game-owned or intentionally shared family schema and backend |

Both use the same Joy8 membership on Joy8-operated surfaces. Independent
entry does not create a separate member system. A branded entry may remain
available after Lobby listing; the player keeps the same identity, wallet,
and product progress through either entrance. Wallet sharing does not merge
product gameplay, progression, ranking, deployment, or release ownership.
Neither model exempts a game from trusted settlement and security requirements.

External channels such as CrazyGames use their own approved platform identity
and must not initialize Joy8 Auth, sessions, or wallets.

## Wallet and POINT Direction

- Joy8 owns human-player wallet authority. Every enrolled player has one POINT
  wallet shared by all integrated games. Trusted Joy8 backend configuration
  resolves it; clients and games cannot select a wallet or change balances directly.
- Points granted, won, reserved, or spent in any integrated game affect that one
  balance. There is no per-game promotional balance and no cross-game transfer.
- Initial credit is granted at most once per player, not once per title.
  Operational wallets currently start at **0 POINT**.
  Any later opening grant or product-specific amount needs a separate decision.
  Existing Demo balances must not be carried into operation. Do not maintain an
  old Demo runtime or an old/new compatibility branch in the replacement platform.
  The approved cutover clears test accounting while preserving Auth/player identities and catalog/admin data. Future resets require a new explicit decision.
- POINT is intended for operational play, not a disposable Demo-only design.
  Build one wallet/accounting architecture for testing and operation while
  isolating their data. The hosted release and replacement status are recorded in
  [README.md](../../README.md); the integration document defines the replacement.
- Purchasing POINT is an allowed future product capability. Whether it ships
  at the first public launch is undecided. No payment provider, purchase price,
  or payment deployment is authorized by this document.
- No redemption, withdrawal, or prizes of monetary value are included.
  Wallet conversion and transfer are unnecessary because there is only one POINT wallet per player.
  The existing nominal `1:1` reference between units grants none of these rights.
- Preserve transaction source: initial grant, promotional grant, purchase,
  gameplay, fee, and authorized adjustment. AI funding is distinct from human
  purchases and fee revenue. A POINT fee is not itself a cash-revenue report.
- Payment orders, verified payment notifications, duplicate protection, and
  refund/chargeback handling must be designed before purchasing is enabled.
  Purchase timing does not delay the reusable wallet and settlement foundation.
- Every POINT transaction records its originating game plus an idempotency key
  and source reference, including grants, gameplay, purchases, and adjustments.
  Reporting and reconciliation separate games by this immutable source, not by wallet.

Detailed trust, wallet-lifecycle, and atomic-settlement requirements belong in
[GAME_PLATFORM_INTEGRATION.md](../platform/GAME_PLATFORM_INTEGRATION.md).

## Data and Environment Direction

Use one codebase with a local test environment and one hosted operational
environment initially. A permanently hosted staging site is not required for
the initial solo-operator workflow; a temporary isolated preview can be added
when an integration or release needs it. Different URLs against the same live
database do not provide test isolation.

Local tests use separate data, credentials, and configuration. Do not promote
test balances, transactions, or fee totals into operational accounts. The approved
cutover cleared test accounting and starts new wallets at 0 POINT. Any further
reset or balance change requires a separately reviewed scope and authorization.
The present repository cannot recreate the full local database from migrations
alone. A reviewed bootstrap/fixture and backup/restore procedure are prerequisite
work, tracked in [KNOWN_ISSUES.md](../operations/KNOWN_ISSUES.md).

The initial hosted cost model may share one Supabase project across Joy8 and
game-owned schemas, with explicit roles and backend boundaries. A game owns
its detailed gameplay data; Joy8 keeps only platform and accounting records.
Shared compute, outages, and backups remain coupled. Keep schema dependencies
separable so a game can later move without changing its identity/wallet contract.
Each game's runtime host is a separate assignment; sharing Supabase does not
choose or provide that host.

## Catalog Direction

The database is the catalog source. Joy8 must not add a local `enabled-games` allowlist.

A published catalog item needs:

- A stable game identifier and slug.
- A valid HTTPS launch URL.
- A Joy8-managed `750 x 1000` WebP cover.
- Correct type and capability metadata.
- A verified Loader-to-iframe launch.

Published status describes platform availability; it does not make Joy8 responsible for changing a game's own source code.

## Explicitly Out of Scope

Unless the user changes the product direction, Joy8 does not own:

- A framework migration to React, Vue, or Next.js.
- A server-rendered application.
- Game source repositories.
- Game rendering or resource failures.
- CrazyGames services for gambling products.
- Game-controlled login or balance mutation.
- A front-end path to service-role database RPCs.
- A separate member master for a branded game entry.
- A game-specific POINT wallet or cross-game POINT transfer flow.
- Pre-launch legacy data compatibility.
- Responsibilities that belong to unrelated Flash products.

## Delivery Order

First align the documents and define the versioned platform contract. Then:

1. **Platform:** implement reusable membership, the shared POINT wallet, launch and
   server authorization, atomic settlement, and minimal recovery/monitoring.
   Verify with simulated games, including cross-game reservations and settlement retries.
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

1. Keep identity, session, and wallet authority in Joy8.
2. Keep gameplay and rendering in the game.
3. Prefer a small extension to an existing contract over a parallel system.
4. Keep one source of truth for catalog and platform data.
5. Separate gambling and CrazyGames distribution.
6. Reject work that adds operational weight without a clear product outcome.
7. Record approved product decisions here; keep implementation detail in the owning technical document.
