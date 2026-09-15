# Looty Member and Authentication Plan

This document owns the planned platform-wide Looty member entry, persistent guest continuity, account linking, account lifecycle, wallet-scope relationship, and Looty-controlled branded game entry.

Approved product direction and priorities remain in `../product/PRODUCT_SCOPE.md`. The current repository implementation is described in `../../README.md`. Game launch, launch-code exchange, Gateway authorization, and wallet calls remain governed by `GAME_PLATFORM_INTEGRATION.md`.

Last reviewed against the repository: 2026-09-15.

## Approved Outcome

Looty needs one reusable identity layer so a player can enter through the public Lobby or any Looty-controlled branded game surface and still resolve to the same Looty player. A branded game may launch before the public Looty Lobby, but it still uses Looty Auth and the stable Looty player ID rather than creating a separate member system.

Membership is always platform-wide. Wallet scope depends on the product model:

- A full independently operated game resolves a game-scoped wallet. Its balance does not change another independent game's balance.
- A Looty-native game that depends on the shared platform, such as a title in a shared slot or compact table-game service, uses the common Looty platform wallet. Spending in one of these games intentionally changes the balance available to the others.

`Mahjong Clash` is an initial adoption case, not the owner or architectural center of this plan. The same member and branded-entry capability must remain reusable by every Looty game that needs it.

A branded standalone entry does not have to redirect customers through the public Looty Lobby when the Lobby launches. Because the branded entry already uses the shared Looty member identity, the same player can later enter through either surface without an account migration. Wallet and game-progress behavior still follows the product's approved scope rather than the entry surface.

This identity agreement applies to Looty-operated surfaces. A CrazyGames build or another external platform channel follows its own platform identity contract and must not initialize Looty Auth, sessions, or wallets.

This approval does not select the first sign-in providers, guest mechanism, native callback design, retention policy, or account-deletion policy. Those decisions remain open below.

## Responsibility Boundary

| Concern | Looty | Branded or native entry surface | Game runtime |
| --- | --- | --- | --- |
| Member and guest authentication | Owns the identity service and backend flow | Presents or opens the approved Looty-controlled flow | Does not own |
| Provider callbacks and session restoration | Defines the trusted flow | Implements platform-specific return wiring after its location is approved | Must not receive credentials |
| Player and wallet resolution | Owns the platform player and the correct game-scoped or platform wallet | Must not write platform tables | Receives only the resulting game session contract |
| Account upgrade, conflict handling, and deletion | Owns the backend workflow | Presents approved states and actions | Does not own |
| Game-specific player mapping and game data | Supplies the stable Looty player reference | Does not redefine Looty identity | Owns its mapping and data in the game system |
| Game launch and wallet authorization | Owns the Loader and Gateway | Hands off to the approved Looty launch path | Consumes `GAME_PLATFORM_INTEGRATION.md` |

This document may define the cross-surface contract, but implementation in a native wrapper or game repository must be performed later in the repository that owns that surface. Looty repository work must not modify a game repository.

## Current Implementation Baseline

The repository currently provides:

- Supabase Auth through one shared browser client.
- Google OAuth only through the administrator entry at `/admin/login/`, followed by a separate `is_looty_admin()` authorization check.
- No public player login, account page, persistent guest flow, account upgrade, provider-linking flow, native callback, or account-deletion flow.
- A Loader that invokes `looty-gateway/create-session` with the active Supabase browser session when one exists.
- A Gateway that accepts any valid Supabase Auth user ID as a registered player identity. It does not yet distinguish an approved player member from an administrator-only Auth user.
- Registered-player reuse through the unique `player_accounts.auth_user_id` relationship and active wallet reuse by player and currency.
- A new guest player, wallet, and session for every successful unauthenticated `create-session` call. There is no persistent guest key or restore path.

The checked-in Supabase configuration currently disables anonymous sign-in and manual identity linking. Hosted provider settings are external configuration and are not established by this repository file alone.

The current data model has one optional, unique Auth user ID on each `player_accounts` row. It does not contain a persistent guest identifier or a separate player-to-identity mapping table. It can support a registered player and wallet, but it does not implement safe guest promotion or multi-provider conflict handling by itself.

The current wallet key is player plus currency, so all games using `POINT` currently reuse the same active wallet. This resembles the approved shared wallet for Looty-native games, but the current schema cannot distinguish a platform wallet from an independent game's game-scoped wallet. Product-aware wallet resolution has not been implemented.

All player, wallet, session, and transaction tables are protected from browser and game writes. Creation and resolution must continue through reviewed backend or database RPC flows.

## Planned Wallet Scope Model

- Looty player identity is shared across the platform.
- A full independently operated game has a separate game-scoped wallet and balance for that Looty player.
- Looty-native games that depend on the shared platform use one common Looty platform wallet.
- Opening one independent game does not spend, refill, or otherwise change another independent game's wallet or the Looty platform wallet.
- Spending in one Looty-native game intentionally changes the platform-wallet balance available to every other Looty-native game.
- Game currencies use a common nominal unit with a `1:1` reference ratio to a possible future Looty platform currency.
- The `1:1` ratio is an accounting convention only. It does not create a current right to exchange, redeem, transfer, or withdraw value.
- Sharing the same platform wallet does not require a conversion: Looty-native games consume the same balance directly.
- No conversion between an independent game wallet and the Looty platform wallet, or between independent game wallets, is currently approved or implemented.
- Conversion may be considered later only as a separate reviewed product, accounting, security, and operational decision after the business requires it.
- A platform-wallet welcome or test credit is granted once per player, not once per Looty-native game. Initial-credit rules for independent game wallets remain product-specific.
- Every wallet transaction must retain its originating `game_id`, including transactions against the shared platform wallet.

The product decision belongs in `../product/PRODUCT_SCOPE.md`. The implemented wallet behavior remains documented in `GAME_PLATFORM_INTEGRATION.md` until the schema, Gateway, and contract are deliberately changed together.

## Game Data and Database Boundary

The initial cost-conscious architecture uses one managed Supabase project for Looty Auth, platform data, and game data. This is shared infrastructure, not shared ownership of every table.

Looty owns and stores:

- Looty authentication and the stable platform player reference.
- Platform-wallet and game-scoped wallet accounts and transactions for Looty-launched sessions.
- Game-session authorization and launch credentials.
- The minimum round-level financial summary required to validate bets, payouts, refunds, and settlement.

Each game or intentionally shared game family owns and stores in its dedicated schema and backend boundary:

- Its game-side player profile and mapping to the Looty player reference.
- Persistent rooms, tables, matches, hands, turns, actions, authoritative state snapshots, and reconnect data.
- Game results, history, statistics, rankings, progression, settings, and other game-specific records.
- Its game-specific retention, recovery, and integrity rules within the shared infrastructure policy.

Looty platform tables and each game-owned schema must use explicit grants and backend access boundaries. A game must not receive a project-wide Supabase service-role key or unrestricted access to another game or Looty platform data. Closely bound Looty-native games may share one family schema and backend when that is an intentional product design, but records and wallet transactions must still identify the originating game.

Schema separation is not the same as physical database isolation: compute, outage scope, backups, and some project-level controls remain shared. The design must therefore keep migrations and dependencies separable so a successful or high-risk game can later move to its own Supabase project or another approved managed database without changing Looty identity or wallet contracts.

This plan does not approve GCP or assign game-server responsibilities to a hosting vendor. Authoritative rules, real-time synchronization, gambling adjudication, and full economic settlement remain with the applicable Flash modules described in `FLASH.md`; their eventual hosting is a separate infrastructure decision.

The existing Looty `game_rounds` table is a wallet and settlement record. It stores the session, game, game-generated round ID, status, and aggregate bet, payout, and refund amounts. It is not an authoritative Mahjong hand record or a substitute for any game's match database.

The platform and game-owned schemas correlate records through the stable Looty player reference, Looty game-session ID, game ID, and game-generated round ID as appropriate. These references are correlation data, not permission for game code to write Looty tables. Wallet mutations remain behind Looty's authorized backend flow even when both data sets are hosted in the same Supabase project.

No additional generic gameplay-record table should be added to Looty merely to avoid creating a game-owned database. If the platform later needs a new cross-game result summary for analytics or operations, define the smallest common record in a separate reviewed contract without copying full gameplay data into Looty.

## Phase-One Scope

Phase one should contain only the minimum reusable member core needed for a safe direct game entry:

- A persistent guest experience for the same valid browser profile or app installation.
- The approved first registered sign-in method or methods.
- Guest promotion without changing the Looty player or any existing platform or game-scoped wallet.
- Deterministic reuse of the same player and the correct wallet scope for the selected game after sign-in.
- Sign-in status, sign-out, required recovery paths, and a user-accessible account-deletion request.
- Approved H5, Android, and iOS return flows and session restoration.
- A handoff from resolved platform identity to the existing Looty game-session contract.

Phase one does not include:

- A complete Looty member center.
- Social, friend, invitation, or private-room account features.
- Game-side password, provider-token, member-session, or wallet handling.
- Browser or game writes to player and wallet tables.
- Automatic merging of two existing registered player accounts.
- A game-owned replacement for Looty identity.
- Full gameplay, match, hand, action, progression, or ranking storage in Looty-owned platform tables.

## Candidate Sign-In Methods

The following candidates are not approved merely because they appear in this table:

| Method | Intended use | Decision or implementation concern |
| --- | --- | --- |
| Persistent guest | Play before registration | Must restore the same player and its existing platform- and game-wallet relationships on the same retained installation or browser profile. |
| Google | Common registered sign-in | Existing admin OAuth proves only the admin flow; player entry, redirect URLs, and session isolation still require design. |
| LINE | Common sign-in for Taiwan users | No integration is configured in this repository; the identity bridge and callback model must be validated. |
| Apple | Registered sign-in on Apple surfaces | Configuration and current store requirements must be reviewed when implementation begins. |
| Email and password | General registered account | Requires verification, recovery, abuse controls, and an approved password policy. |
| Email OTP | Passwordless email sign-in | Delivery, expiry, retry, recovery, and whether it replaces or complements passwords remain undecided. |

## Identity Invariants

- `player_accounts.id` is the stable Looty player reference.
- Supabase Auth manages credentials and provider identities; it is not a replacement for the Looty player record.
- A guest and a registered player must each resolve to exactly one Looty player.
- Provider identities must resolve to one player through an approved linking model.
- Each future game-scoped wallet remains attached to both the Looty player and its game, not to a nickname, device name, or provider display name.
- The Looty platform wallet remains attached to the Looty player and is shared only by products explicitly classified as Looty-native.
- A game must not select or change its own wallet scope. Looty resolves the approved scope from trusted catalog or backend configuration.
- A game may map its own records to the stable Looty player reference, but Looty does not own the game's record schema or gameplay data.
- Email address, display name, or a similar nickname must never trigger an automatic account merge.
- Repeated callbacks, retries, or concurrent requests must not duplicate a player, the wallet for the approved scope, or its initial Demo credit.
- Player initialization, guest promotion, and identity linking must be atomic backend operations, not front-end table updates.

## Persistent Guest Rules

- A player who chooses guest access should recover the same guest player and existing platform and game wallets while the approved local session or installation identity remains valid.
- Clearing browser data, uninstalling the app, or changing devices does not guarantee guest recovery.
- Reliable cross-device recovery requires promotion to an approved registered account.
- The interface should explain this limitation before local guest state is lost and provide an account-upgrade path.
- Signing out of a registered account must not silently create a new guest. The player must explicitly choose the next entry method.
- The guest credential mechanism, storage location, rotation, expiry, inactivity policy, and cleanup policy remain undecided.

The operational impact of current guest growth is tracked in `../operations/KNOWN_ISSUES.md`; the identity and retention decisions remain owned here.

## Guest Promotion and Identity Linking

The core rule is: change the sign-in method, not the player.

A successful guest promotion must preserve:

- The same `player_accounts.id`.
- All existing platform and game-scoped wallets and their transaction histories.
- Existing game mappings and game-owned data associated with that player reference.
- The right to reuse the same player from future Looty Lobby entry.

If the selected provider identity already resolves to another player:

- Stop the promotion and require verification of the existing account.
- Do not merge by email address, display name, client parameter, or provider profile similarity.
- Return a clear, recoverable conflict state.
- Keep full registered-account merging outside phase one until a separate reviewed policy exists.

The current Gateway creates or reuses a registered player from an Auth user ID, but it does not upgrade an existing guest row. The promotion operation and any supporting schema changes must be designed and reviewed before implementation.

## Entry Surfaces and Launch Handoff

The target flow is:

```text
Looty Lobby or Looty-controlled branded game entry
  -> Looty-controlled sign-in or persistent guest restoration
  -> Looty backend resolves the stable player and approved wallet scope
  -> Looty Loader and create-session flow
  -> existing game launch and Gateway contract
```

The member layer ends when it hands a resolved Looty identity to the existing session-creation path. It must not duplicate launch parameters, token lifetimes, wallet endpoints, or game-client rules from `GAME_PLATFORM_INTEGRATION.md`.

Current constraints that must be resolved before direct entry ships:

- H5 entry must use an approved HTTPS origin and callback path.
- The current `create-session` route requires an allowed browser Origin and does not support an originless native client call.
- Android app links, iOS Universal Links or callbacks, bundle identifiers, redirect allowlists, and native session storage do not exist in this repository.
- The location and repository ownership of each branded H5 and native entry surface must be approved before implementation.
- Administrator and future player entry currently share the default Supabase browser-session storage. The member design must prevent an administrator-only session from silently becoming player membership unless that behavior is explicitly approved.

Platform-specific native wiring belongs in the approved owning repository after Looty defines the trusted backend and callback contract. The gameplay runtime must not perform provider authentication.

## Branded Standalone Entry Boundary

- A game may launch through its own branded H5 or native entry before the public Looty Lobby is released.
- Every approved branded entry uses the shared Looty Auth identity and stable Looty player ID; it does not create a separate member master.
- Listing the same game in the future Looty Lobby does not require replacing or redirecting its existing branded entry.
- Entering through the branded surface or the Looty Lobby resolves the same member. The product's approved wallet scope and game-owned progress determine what is shared, not the visual entry point.
- The gameplay runtime still does not receive provider credentials or own authentication logic.

## Account Lifecycle

### Sign-Out

- Sign-out ends the current device's Looty Auth session.
- It does not delete the player, wallet, transaction, session, or game data.
- The user should return to an explicit entry choice rather than be assigned a new guest automatically.

### Recovery

- Email-and-password accounts require an approved password-reset and email-verification flow.
- Provider accounts use their provider's recovery path, followed by Looty session restoration.
- A guest without a registered identity can recover only while its approved local credential remains valid.

### Closure and Deletion

- Looty must provide the backend workflow; a game must not delete Auth, player, wallet, or platform records directly.
- The design must separately classify Auth credentials, player profile data, wallet and transaction records, game-owned data, and records that require retention or anonymization.
- Waiting period, recovery period, hard deletion, account closure, anonymization, audit retention, and game-data coordination remain undecided.
- Store and legal requirements must be checked against the target release and jurisdiction when this work begins.

The current schema must not be treated as a ready-made deletion workflow. A registered player requires a non-null Auth user ID, while wallet, transaction, session, and game relationships have their own retention constraints. Account deletion therefore needs an explicit ordered backend design rather than a direct Auth-user deletion.

## Security and Privacy Requirements

- Passwords, provider credentials, Looty member access or refresh tokens, and account-recovery secrets must never be passed to a game.
- Looty may persist only the platform session material required for approved session restoration, in platform-controlled storage. The H5 and native storage designs remain subject to review.
- Launch codes and Gateway tokens remain memory-only under `GAME_PLATFORM_INTEGRATION.md`.
- OAuth and native callbacks must validate approved redirects and anti-forgery state; replay and concurrent callback handling must be idempotent.
- URLs, browser history, Analytics, general logs, game save data, and support screenshots must not expose credentials or recovery secrets.
- Front-end possession of a member session must not grant direct access to protected player, wallet, session, round, or transaction tables.

## Delivery Order

1. Approve the first sign-in methods, persistent guest mechanism, member-versus-admin session boundary, entry-surface location, and lifecycle policies.
2. Define the identity state transitions, trust boundaries, provider callbacks, native return contract, and failure states.
3. Design the smallest required Auth, player, identity-linking, and wallet-scope changes.
4. Prepare small reviewable database migrations and obtain user confirmation before any remote database operation.
5. Implement idempotent backend flows for guest restoration, registered-player resolution, promotion, conflicts, sign-out, recovery, and deletion requests.
6. Implement the reusable Looty-controlled H5 member entry and connect it to the existing Loader session flow.
7. Implement approved Android and iOS return and storage integrations in their owning repositories.
8. Verify identity, wallet, retry, conflict, security, and lifecycle behavior across the approved surfaces.
9. Only after the Looty contract passes those checks, switch to each named game repository for its game-side integration.

This order describes technical dependencies. It does not require every game to ship H5, Android, and iOS, and it does not approve a universal store-release order.

## Acceptance Criteria

- A guest reopening the same retained browser profile or app installation resolves to the same player and existing platform and game wallets.
- Guest promotion preserves the player ID, all wallet scopes, transaction histories, and game mappings.
- The same registered account resolves to the same Looty player across every approved H5, Android, and iOS entry.
- The same title resolves the same game profile and progress whether entered through its Looty-controlled branded surface or the public Looty Lobby.
- An independent game resolves only its game-scoped wallet; a Looty-native game resolves the shared platform wallet.
- A platform-wallet initial credit is granted once per player rather than once per Looty-native game.
- Duplicate sign-in, callback replay, network retry, and concurrent requests do not create duplicate players, duplicate wallet scopes, or repeated initial credits.
- A provider conflict is never merged silently.
- Administrator-only Auth state cannot silently define player membership unless that behavior has been explicitly approved.
- The game receives no password, provider credential, Looty member token, service-role key, or direct table permission.
- Account closure and deletion follow the approved retention and game-data coordination policy.
- A resolved identity can enter the existing Looty game-session flow without changing the game runtime contract.
- A Looty-controlled branded game entry can operate without requiring the player to begin at the public Lobby.
- A branded standalone entry and the future Looty Lobby resolve the same Looty member without requiring an entry-point replacement.
- No current UI or API implies that the nominal `1:1` currency ratio provides conversion, transfer, redemption, or withdrawal.
- Looty financial round records can be correlated with the authoritative game record without storing the game's full gameplay history.

## Open Decisions

- Which combination of persistent guest, Google, LINE, Apple, email and password, and Email OTP ships first.
- Whether persistent guests use Supabase anonymous sign-in, a Looty-issued transition credential, or another reviewed mechanism.
- Guest credential storage, rotation, expiry, inactivity, retention, and cleanup rules.
- Whether email uses passwords, OTP, or both.
- Which transactional email provider, if any, is used; neither Resend nor Amazon SES is approved by this plan.
- Whether multiple providers link inside one Supabase Auth user or through a separate Looty identity mapping.
- How the Gateway distinguishes approved player membership from administrator-only or other Auth users.
- Whether administrator and player sessions use separate clients, storage namespaces, paths, subdomains, or another isolation design.
- The exact provider-conflict experience and any future manual account-merge process.
- Where each Looty-controlled branded H5 and native entry surface lives and which repository owns it.
- The trusted native-to-Looty session and `create-session` handoff model.
- Android and iOS bundle identifiers, redirect URLs, app links, Universal Links or callbacks, and secure storage.
- Which platforms each game ships on and its H5, Android, and iOS release order.
- Account-deletion waiting and recovery periods, audit retention, hard-deletion boundaries, and coordination with each game's data.
- The schema and migration path from the current undifferentiated Demo `POINT` wallet to explicit platform and game wallet scopes.
- Initial-credit rules and amounts for the platform wallet and each independent game wallet.
- The name and detailed accounting meaning of any future Looty platform currency.
- The trusted product classification and catalog fields that select platform-wallet or game-wallet scope.
- The minimum player, session, and round correlation contract each game-owned schema must implement.
- Exact custom-schema, scoped-role, migration, backup, and future extraction conventions for the shared Supabase project.
- Final branded entry copy, visual treatment, and localization.

Conversion between independent game wallets and the platform wallet, cross-wallet transfer, redemption, and withdrawal are deliberately deferred rather than unresolved phase-one requirements. They must not be implemented until the user opens a separate product decision. Looty-native games sharing one platform wallet are not performing conversions or transfers between games.
