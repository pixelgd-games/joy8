# Looty Member and Authentication Plan

Status: member migrations and Gateway are active; the matching front end is released from main. Real provider acceptance remains pending. Account lifecycle and branded handoff remain target design.
Last reviewed: 2026-09-18.

This document owns authentication, persistent guests, account lifecycle, and
branded-entry identity handoff. [PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md)
owns release scope, the two product/wallet models, POINT policy, environment
direction, and the platform -> product -> integration delivery order.
[GAME_PLATFORM_INTEGRATION.md](GAME_PLATFORM_INTEGRATION.md) owns launch,
authorization, wallet, and settlement contracts. [README.md](../../README.md)
owns the current implementation and operations.

## First-Release Identity Scope

The first release is H5 with Google, basic account/password, and persistent
guest entry. Use Email + password as the implementation baseline for basic
accounts, with email verification and password recovery; a separate username
credential system is not required. LINE, Apple, Email OTP, Android, and iOS are
deferred and do not block this release.

A player can enter through the public Looty Lobby or a Looty-controlled branded
game entry. Both resolve the same Looty player. A branded entry can open before
the public Lobby and remain available afterward. It presents authentication;
the gameplay runtime never implements it or receives member/provider credentials.
This contract is reusable across games and is not Mahjong-specific.

External platform channels follow their own identity contract. They must not
initialize Looty identity merely because the game also has a Looty build.

## Responsibility Boundary

| Concern | Owner |
| --- | --- |
| Credentials, provider identity and verification | Supabase Auth through Looty-controlled flows |
| Stable player, membership eligibility, guest upgrade and account lifecycle | Looty backend |
| H5 sign-in, callback, recovery and account-status UI | Looty-controlled entry surface |
| Product classification and wallet resolution | Looty trusted configuration and backend |
| Game session and launch handoff | Looty integration contract |
| Game-side player mapping, progress and gameplay data | Product backend and schema |

Fix the origin, route, and repository owner of each branded entry before UI
implementation. Visual placement in a game's lobby does not transfer Auth
ownership into its gameplay runtime. Native return/storage wiring is later work
in the owning repository, not a first-release platform dependency.

## Current Gaps

- Public member UI and Gateway source now implement the entry/upgrade/recovery
  foundation. The two member migrations are applied and the Gateway is deployed.
  Hosted entry settings are enabled, but SMTP and real
  provider acceptance remain pending. [README.md](../../README.md) owns
  the implementation details and test limits.
- Deletion requests, cleanup/retention, and branded cross-origin entry are not
  implemented. Same-origin `/account/` belongs to Looty and returns only to the
  Lobby, a validated `/game/?slug=...`, or `/play-test/?slug=...` route.
- The local private-test entry is owned by Looty at
  `http://localhost:5173/play-test/?slug=mahjong-clash`; its game frame is owned by
  Mahjong at `http://localhost:4391/`. The implemented shared member callback also
  accepts a validated `/play-test/?slug=...` return path. Authorization belongs to
  verified membership and backend entry configuration. Active registered members
  and persistent guests use the same entry without per-player approval. Its SQL
  and Gateway are installed; real game identity acceptance remains pending.
  See the [connection review](../../supabase/drafts/MAHJONG_REVIEW.md).
- Wallet scope is deployed. Mahjong has zero-credit identity-only activation;
  funded gameplay remains pending. Consume the platform wallet work rather than
  introducing wallet logic into login screens.

## Identity Invariants

- `player_accounts.id` remains stable through login, guest restoration, upgrade,
  entry-point changes, and session refresh.
- Credentials and provider identities belong to Auth. Auth identity, player
  membership, and administrator authorization are separate concepts.
- Resolve exactly one player and the correct existing wallet scope through
  trusted backend operations. Retries and simultaneous callbacks must not create
  duplicate players, wallets, or initial grants.
- A provider identity must not silently merge two existing Looty players or
  their wallets based on email, display name, or client-supplied similarity.
- Supabase provider linking within one Auth user is different from merging
  existing Looty players. Review its automatic verified-email linking behavior
  and test Google/password conflicts explicitly before enabling the combined flow.
- Browser storage separation alone does not authorize membership. An
  administrator-only session must not silently enroll a player.

## Persistent Guests and Promotion

A guest restores the same player while its approved local session remains valid.
Clearing browser data or changing devices cannot guarantee guest recovery.
Explain this limitation and provide an upgrade path to Google or Email/password.
Signing out must return to an explicit entry choice, not silently create a guest.

Supabase anonymous sign-in is the selected mechanism and is enabled in hosted
Auth; public member deployment still requires acceptance testing. Anonymous Auth users
have user IDs and use the `authenticated` role. Classify them using verified
anonymous status rather than interpreting every Auth ID as a registered member.
Define session storage, refresh, expiry, abuse controls, and cleanup before shipping.

Promotion changes the sign-in method, not the player. Preserve all wallet scopes,
transactions, and game mappings. If the provider already belongs to another
Looty player, return a recoverable conflict and require verification of that
account; do not silently transfer assets. Full registered-player merging remains
outside this release.

## H5 Entry and Handoff

The Lobby is public and never requires a login just to browse. Selecting a game
checks existing player enrollment: an active registered player or persistent
guest proceeds directly; an unenrolled visitor gets the shared member dialog
over the unchanged Lobby. The dialog offers Google, Email/password, and explicit
guest play. Successful entry continues to the selected game. Dismissal cancels
that selection; opening another game or the top-bar account entry must not reuse
the previous destination. A service failure must not silently create a guest.

Direct game URLs follow the same membership policy and return missing members
to the Lobby dialog. `/account/` remains the callback/recovery surface, not the
default platform entrance. Callback destinations are validated game paths, never
arbitrary URLs. A future branded Mahjong H5/App entry should likewise allow its
home screen before requesting identity at game start; native implementation
remains deferred.

```text
Public Lobby or branded home -> select a game / start playing
  -> Looty sign-in or persistent guest restoration
  -> backend player and wallet resolution
  -> authorized game-session handoff
  -> game runtime
```

Use approved HTTPS origins and callback allowlists, provider anti-forgery
protection, and safe return destinations. Handle callback replay, cancellation,
expired sessions, and identity conflicts without creating replacement accounts.
The current `create-session` route expects an allowed browser Origin; arbitrary
game URLs or originless native calls are not an alternate authentication path.

The entry may retain Auth session material only in approved platform-controlled
storage. Passwords, provider tokens, member access/refresh tokens, recovery secrets,
and service-role keys never enter the game, URL logs, Analytics, or game saves.
Launch-code redemption and short-lived game-token rules are owned exclusively by
[GAME_PLATFORM_INTEGRATION.md](GAME_PLATFORM_INTEGRATION.md).

## Account Lifecycle

- **Sign-out:** end the current device's Auth session without deleting the
  player, wallet, history, or an already active match's accounting obligation.
- **Recovery:** provide email verification and password reset. Provider accounts
  use provider recovery; guests recover only while their approved session survives.
- **Email delivery:** configure a production SMTP provider and test delivery
  before public password registration. Supabase's default sender is for testing;
  no paid provider or account change is authorized here.
  Supabase Auth continues to issue and validate verification/recovery tokens.
  Custom delivery does not mean rebuilding password authentication or storing
  passwords in Looty tables.
- **Closure/deletion:** expose a request flow, and separately define Auth/profile
  deletion or anonymization, transaction retention, game-data coordination, and
  waiting/recovery periods. Do not directly delete Auth users: current player
  constraints and wallet/session relationships require an ordered backend policy.

## Platform-Stage Implementation and Acceptance

1. Finalize guest mechanism, linking/conflict rules, administrator separation,
   H5 entry ownership, callback routes, and lifecycle/retention policies.
2. Specify state transitions and failure responses; prepare small reviewed
   migrations under [AGENTS.md](../../AGENTS.md) before database changes.
3. Implement backend player resolution, guest restoration/promotion, and lifecycle
   operations, then the reusable H5 UI and session handoff.
4. Verify Google/password/guest entry, verification, reset, sign-out, refresh,
   callback replay, simultaneous requests, guest loss, and provider conflicts.
   Verify game selection, cancellation/reselection, late responses after closing
   a dialog, callback destination preservation, and direct-link entry.
5. Verify direct and Lobby entries preserve the same player and product progress;
   test both wallet models through the platform contract and a simulated game.
6. Verify that no game receives member credentials or protected table access.

The product stage consumes this tested contract. Real service integration is the
third stage; no product needs a separate temporary membership system.

## Remaining Decisions

- Exact guest-session retention/cleanup and account-closure retention periods.
- SMTP provider, delivery configuration, and password/abuse policy.
- Validate implemented linking/conflict handling and member/admin isolation with
  real providers before release; separate-player merging remains unsupported.
- Branded H5 entry origins, paths, repository ownership, copy, and localization.
- Whether future POINT purchases require guest promotion before checkout.

First-release platforms and sign-in methods are already decided; do not reopen
them as a provider-selection task. Native callbacks and extra providers are
deferred. Purchase launch timing belongs in the product plan.

## Email Delivery Setup and Acceptance

The user has not selected a production sender or sending domain. Do not guess
either or deploy a new mail server. Keep custom SMTP configuration pending until
the service/domain and scope are confirmed. Never request credentials in chat.

1. Confirm the sending domain and sender mailbox; complete the selected provider's
   domain/DNS verification and delivery authentication.
2. Configure the provider's SMTP host, port, username/password and sender in the
   Looty project's Auth settings using the authorized account. Store secrets in
   provider settings only, not front-end environment variables or source.
3. Retain Looty's approved Site URL and account callback allowlist. Keep the
   verification link semantics supplied by Auth; no custom token issuer is needed.
4. Test a new email/password signup, unverified-login rejection, verification,
   password reset, guest email promotion, expired/replayed links and an already
   registered address. Confirm the same player and all wallet scopes survive
   promotion. Do not infer email delivery from a successful API response.
5. Test delivery to a non-project-team mailbox, because the default Supabase
   sender is restricted to team recipients. Record failures without mail content,
   passwords, codes or token-bearing links.

Google real-account binding acceptance is deferred by the user. Keep it marked
pending; fixture and guest tests do not replace provider acceptance. Hosted
password/abuse settings, guest retention, closure policy and branded-entry
ownership remain separate release gates above.

## Technical References

- [Supabase anonymous sign-in](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

These explain vendor behavior; they do not approve configuration changes.
