# Flash System Context

This document provides stable, high-level context for Looty's place in the wider Flash system. It is not the source of truth for Looty routes, database fields, deployment state, or short-term plans.

Read `../../README.md` for the current repository and `../product/PRODUCT_SCOPE.md` for the approved product boundary.

## System Model

Flash is a modular game system, not one application or one required request path. Products select only the modules they need.

| Module | Primary responsibility |
| --- | --- |
| Looty | Game entry, player platform, Lobby, platform administration |
| GD Games | Game content and front-end presentation |
| Aura | Authoritative logic for general games |
| Hype5 | Real-time multiplayer and room synchronization |
| FuGhost | Gambling-game adjudication and probability decisions |
| Spinnova | Full wallet, ledger, economic settlement |

The module names and responsibilities are context, not authorization to add dependencies. A change in Looty must remain within Looty's approved scope unless the user explicitly requests a cross-module design.

## Composition Principles

1. A product does not need every module.
2. Requests do not pass through every module by default.
3. Each module keeps a clear, independently maintainable boundary.
4. Product needs determine integration; the existence of a module does not.
5. Potential integrations are not fixed architecture.
6. Repository-local documents remain authoritative for each implementation.

## Common Compositions

These examples are illustrative:

| Product shape | Possible modules |
| --- | --- |
| General single-player game | Looty, GD Games, Aura |
| General multiplayer game | Looty, GD Games, Hype5, Aura |
| Gambling single-player game | Looty, GD Games, FuGhost |
| Gambling multiplayer game | Looty, GD Games, Hype5, FuGhost |
| Product requiring a full economic ledger | Add Spinnova where appropriate |

Do not turn an example into a mandatory dependency chain.

## Looty's Role

Looty can provide the platform layer for:

- Game discovery and entry.
- Player identity and session entry.
- Lobby and catalog management.
- Platform administration.
- Platform-owned challenges or leaderboard entry surfaces when separately approved.
- A light platform wallet interface.
- Integration entry points for other Flash modules.

The current implemented subset is listed in `../../README.md`.

## What Looty Does Not Own

Looty does not own:

- Final authoritative rules for a general game.
- Real-time multiplayer room synchronization.
- Gambling result adjudication.
- Probability or RNG adjudication.
- A complete production ledger and economic settlement system.
- A game's primary rendering, animation, audio, or gameplay UI.

Those responsibilities may belong to Aura, Hype5, FuGhost, Spinnova, or GD Games. Looty may integrate with them, but must not duplicate their internals.

## Infrastructure Context

Flash modules may use Cloudflare Pages, Cloudflare Workers, Render, or Supabase according to their own repository and product requirements. This document deliberately does not record current host locations because they can change independently.

Never infer that Looty must adopt another module's deployment model. Looty's current deployment is defined in `../../README.md`.

## AI Guidance

- Start from Looty's own repository and product boundary.
- Introduce a sibling-module dependency only when the task explicitly requires it.
- Verify the sibling module's own instructions before cross-project work.
- Keep integration contracts narrow and versionable.
- Report ambiguity before assigning a responsibility to the wrong module.
- Do not use this background document as evidence that an unimplemented feature already exists.
