# Joy8 Member and Authentication Plan

Status: member migrations and Gateway are active. Google sign-in and persistent
guest entry passed hosted acceptance; Cloudflare Turnstile protects guest Auth.
The public Email/password flow and Cloudflare Email Sending are disabled. Stable
six-digit public player IDs are deployed. Guest-to-Google linking, guest
continuity and branded handoff remain acceptance or target-design work.
Last reviewed: 2026-09-20.

This document owns authentication, persistent guests, account lifecycle, and
branded-entry identity handoff. [PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md)
owns release scope, the two product/wallet models, POINT policy, environment
direction, and the platform -> product -> integration delivery order.
[GAME_PLATFORM_INTEGRATION.md](GAME_PLATFORM_INTEGRATION.md) owns launch,
authorization, wallet, and settlement contracts. [README.md](../../README.md)
owns the current implementation and operations.

## First-Release Identity Scope

The first release is H5 with Google and persistent guest entry. Email/password,
a separate username credential system, LINE, Apple, Email OTP, Android and iOS
are deferred and do not block this release.

A player can enter through the public Joy8 Lobby or a Joy8-controlled branded
game entry. Both resolve the same Joy8 player. A branded entry can open before
the public Lobby and remain available afterward. It presents authentication;
the gameplay runtime never implements it or receives member/provider credentials.
This contract is reusable across games and is not Mahjong-specific.

External platform channels follow their own identity contract. They must not
initialize Joy8 identity merely because the game also has a Joy8 build.

## Responsibility Boundary

| Concern | Owner |
| --- | --- |
| Credentials, provider identity and verification | Supabase Auth through Joy8-controlled flows |
| Stable player, membership eligibility, guest upgrade and account lifecycle | Joy8 backend |
| H5 sign-in, callback and account-status UI | Joy8-controlled entry surface |
| Product classification and wallet resolution | Joy8 trusted configuration and backend |
| Game session and launch handoff | Joy8 integration contract |
| Game-side player mapping, progress and gameplay data | Product backend and schema |

Fix the origin, route, and repository owner of each branded entry before UI
implementation. Visual placement in a game's lobby does not transfer Auth
ownership into its gameplay runtime. Native return/storage wiring is later work
in the owning repository, not a first-release platform dependency.

## Current Gaps

- Public member UI and Gateway source implement Google/guest entry, guest
  promotion and enrollment. The member migrations are applied and the Gateway
  is deployed. Google sign-in, guest entry and Turnstile passed hosted
  acceptance. Guest-to-Google linking remains pending hosted acceptance.
  [README.md](../../README.md) owns the implementation details and test limits.
- Email/password entry is not part of the current public product. Cloudflare
  Email Sending is disabled, both SMTP credentials were deleted, and Workers
  Paid was canceled. Re-enabling email authentication requires a new product
  decision and provider configuration review.
- Deletion requests, cleanup/retention and branded cross-origin entry are not
  implemented. Same-origin `/account/` is a narrow callback trampoline that
  returns only to the Lobby, a validated `/game/?slug=...`, or
  `/play-test/?slug=...` route.
- The local private-test entry is owned by Joy8 at
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
- `player_accounts.public_id` is a unique six-digit presentation identifier.
  It may be shown as `Player 123456`, but must never replace the internal UUID
  for authentication, authorization, launch, wallet, settlement, or game mapping.
- Credentials and provider identities belong to Auth. Auth identity, player
  membership, and administrator authorization are separate concepts.
- Resolve exactly one player and the correct existing wallet scope through
  trusted backend operations. Retries and simultaneous callbacks must not create
  duplicate players, wallets, or initial grants.
- A provider identity must not silently merge two existing Joy8 players or
  their wallets based on email, display name, or client-supplied similarity.
- Supabase provider linking within one Auth user is different from merging
  existing Joy8 players. Test guest-to-Google conflicts explicitly before
  accepting the promotion flow as production-ready.
- Browser storage separation alone does not authorize membership. An
  administrator-only session must not silently enroll a player.

## Persistent Guests and Promotion

A guest restores the same player while its approved local session remains valid.
Clearing browser data or changing devices cannot guarantee guest recovery.
Explain this limitation and provide an upgrade path to Google.
Signing out must return to an explicit entry choice, not silently create a guest.

Supabase anonymous sign-in is the selected mechanism and is enabled in hosted
Auth; hosted guest entry has passed acceptance testing. Anonymous Auth users
have user IDs and use the `authenticated` role. Classify them using verified
anonymous status rather than interpreting every Auth ID as a registered member.
Define session storage, refresh, expiry, abuse controls, and cleanup before shipping.

Promotion changes the sign-in method, not the player. Preserve all wallet scopes,
transactions, and game mappings. If the provider already belongs to another
Joy8 player, return a recoverable conflict and require verification of that
account; do not silently transfer assets. Full registered-player merging remains
outside this release.

## H5 Entry and Handoff

The Lobby is public and never requires a login just to browse. Selecting a game
checks existing player enrollment: an active registered player or persistent
guest proceeds directly; an unenrolled visitor gets the shared member dialog
over the unchanged Lobby. The dialog offers Google and explicit guest play.
Successful entry continues to the selected game. Dismissal cancels
that selection; opening another game or the top-bar account entry must not reuse
the previous destination. A service failure must not silently create a guest.

Direct game URLs follow the same membership policy and return missing members
to the Lobby dialog. `/account/` is the callback trampoline, not the default
platform entrance or a second account page. Callback destinations are validated
game paths, never arbitrary URLs. A future branded Mahjong H5/App entry should likewise allow its
home screen before requesting identity at game start; native implementation
remains deferred.

The callback passes OAuth parameters through `/account/` to
`/?member=callback&code=...`. The Lobby captures those parameters and clears the
visible query using `history.replaceState` before opening the dialog. Never log
the callback URL or send it to analytics.

After successful enrollment, the member service dispatches the window event
`joy8:membership`. Its `detail` is the Gateway member object containing
`player_account_ref`, `account_type` and `public_id`. The Lobby uses it to refresh
the account label without a second enrollment. This is an in-page UI notification,
not an authorization signal; session issuance still verifies identity server-side.

```text
Public Lobby or branded home -> select a game / start playing
  -> Joy8 sign-in or persistent guest restoration
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
storage. Provider tokens, member access/refresh tokens and service-role keys
never enter the game, URL logs, Analytics, or game saves.
Launch-code redemption and short-lived game-token rules are owned exclusively by
[GAME_PLATFORM_INTEGRATION.md](GAME_PLATFORM_INTEGRATION.md).

## Account Lifecycle

- **Sign-out:** end the current device's Auth session without deleting the
  player, wallet, history, or an already active match's accounting obligation.
- **Recovery:** Google accounts use Google's provider recovery. Guests are
  recoverable only while their approved browser session survives; linking to
  Google is the intended continuity path, but hosted linking remains unverified.
- **Email delivery:** the current public identity scope sends no authentication
  email. Cloudflare Email Sending is disabled and no SMTP credential remains.
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
4. Verify Google/guest entry, sign-out, refresh, callback replay, simultaneous
   requests, guest loss, guest-to-Google linking and provider conflicts.
   Verify game selection, cancellation/reselection, late responses after closing
   a dialog, callback destination preservation, and direct-link entry.
5. Verify direct and Lobby entries preserve the same player and product progress;
   test both wallet models through the platform contract and a simulated game.
6. Verify that no game receives member credentials or protected table access.

The product stage consumes this tested contract. Real service integration is the
third stage; no product needs a separate temporary membership system.

## Remaining Decisions

- Exact guest-session retention/cleanup and account-closure retention periods.
- Validate implemented linking/conflict handling and member/admin isolation with
  real providers before release; separate-player merging remains unsupported.
- Player nickname rules, moderation and whether or when the six-digit public-ID
  namespace must be extended beyond its 900,000 available values.
- Branded H5 entry origins, paths, repository ownership, copy, and localization.
- Whether future POINT purchases require guest promotion before checkout.

First-release platforms and sign-in methods are already decided; do not reopen
them as a provider-selection task. Native callbacks and extra providers are
deferred. Purchase launch timing belongs in the product plan.

## Provider and Abuse Protection

Google sign-in and guest entry are the current public identity methods.
Cloudflare Turnstile Managed protection is enabled for guest Auth; its public
site key may be used by the client, while its secret remains provider-side.
Guest-to-Google linking and provider-conflict preservation remain pending and
must not be inferred from standalone Google entry.

Cloudflare Email Sending is disabled, both SMTP credentials were deleted, and
the Workers Paid subscription was canceled. No Email/password action is exposed
by the public UI. Reintroducing email authentication would be a new product and
operations decision requiring provider setup, abuse limits, delivery monitoring,
callback acceptance and updated lifecycle policy; do not silently revive the
retired flow from historical code or documentation.

## Technical References

- [Supabase anonymous sign-in](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)

These explain vendor behavior; they do not approve configuration changes.
