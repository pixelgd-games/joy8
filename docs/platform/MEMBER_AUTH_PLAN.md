# Joy8 Member and Authentication Plan

This document owns member identity, account lifecycle and branded entry.
[PRODUCT_SCOPE.md](../product/PRODUCT_SCOPE.md) owns product and POINT rules;
[GAME_PLATFORM_INTEGRATION.md](GAME_PLATFORM_INTEGRATION.md) owns game sessions,
authorization and settlement. [README.md](../../README.md) owns operations.

## Release Identity Scope

The release supports allowlisted Google accounts only. Guest creation, guest
promotion, Facebook sign-in and provider linking are removed from the frontend,
member resolver, wallet policy and SDK contract. Returning those features is a
new product decision and implementation, not an environment flag. Anonymous
identities are rejected; `JOY8_GUEST_DISABLED` remains a rejection code only.
Email/password, SMTP, outbound authentication email, LINE and Apple are outside
scope. Native clients are deferred. The existing unpublished Meta app is not
part of the Joy8 runtime and is not deleted by this change.

Public Lobby browsing remains open. Both Lobby and Joy8-controlled branded entry
use the same Google identity, player and shared POINT wallet. Games never log
players in, hold member credentials or modify player balances.

## Email Access Gate

`joy8_email_allowlist` stores trimmed, lowercase email addresses without Gmail
dot/plus rewriting. Verified Google administrators manage it at `/admin/access/`.
Current administrator entries cannot be removed. Administrator assignments are
separate from player enrollment and require consistent allowlist provisioning.

The Supabase Before User Created Hook rejects anonymous, non-Google and
outside-list signup. It runs as `supabase_auth_admin`; browser and game roles
cannot invoke it. The hosted CLI cannot assume that role to probe the Hook; do
not broaden its grants to enable one. The hosted provider configuration is
recorded in README.

The Gateway verifies the bearer. Member lookup and enrollment require a current,
verified, active Google Auth user with an allowlisted email. Player/session insert
triggers enforce the same rule. Removal blocks future entry but does not cancel
an already committed match or revoke an already issued game session.

## Identity Invariants

- Each Auth user resolves to at most one player. `account_type` is `registered`.
- `player_accounts.id` is the stable internal identity. The unique six-digit
  `public_id` is presentation only and never a credential or settlement key.
- Explicit enrollment grants the configured initial POINT amount once. Retries
  and concurrent callbacks preserve one player, one wallet and one grant.
- Member lookup is read-only. Signing into an administrator session does not
  silently enroll a player; browser storage separation is not authorization.
- Email or display-name similarity never merges different players or wallets.
- Browser and game roles cannot invoke enrollment/session RPCs directly.

## H5 Entry and Handoff

Selecting a game checks membership. An enrolled member continues to the Loader;
an unenrolled visitor sees the Google dialog over the public Lobby. Closing the
dialog cancels the pending game. Account entry clears the prior destination.
Network failure never creates a replacement player.

`/account/` is a PKCE callback trampoline. Return paths are limited to the Lobby
and validated `/game/`, `/play-test/` and `/entry/` slugs. Callback forwarding
uses a fragment, removed immediately by the receiving page. The initial provider
request still carries its one-use code in a query; exclude callback queries from
analytics and access-log exports. Only `provider=google&flow=signin` callbacks
are accepted. Replay, cancellation and invalid callbacks fail closed.

`/entry/?slug=...` completes Google authentication before retrieving protected
metadata or loading a game. Explicit backend entry configuration and exact
origin checks apply whether the catalog game is published or unpublished.
The iframe protocol accepts only `method:"google"` and validated request IDs.
Auth, access/refresh tokens and provider tokens remain platform-owned. Launch
codes and Gateway tokens are delivered once in memory to the checked iframe.

Successful enrollment dispatches `joy8:membership` containing the member object
and `auth_user_id` for Lobby presentation. The Lobby accepts it only for the
current Auth identity, so a late enrollment response cannot restore another
account's UI. This browser event grants no authorization.

### Game Page Return Policy

The public `/game/` Loader requires a matching per-tab visit newer than two
minutes. Explicit Lobby selection or successful member continuation records the
slug and current time in `sessionStorage` under `joy8-game-visit-v1`. This is a
navigation hint only; it carries no identity, credential, launch code or Gateway
token and grants no backend access. Normal membership and launch checks still run.

A live game page updates this timestamp while visible and when leaving the
foreground. Switching tabs and returning to that same live document keeps the
game, even after two minutes. This is not an inactivity logout. A reload, browser
restoration or history return with a record at least two minutes old goes to the
plain Lobby before starting another session. History-cache restores check the old
timestamp before foreground events can renew it. Recent reloads retain the normal
launch flow; they request a new session rather than reusing credentials.

A direct game URL without a matching record, including a new tab or unavailable
session storage, also returns to the plain Lobby. The player selects a game there;
the platform does not carry the stale game into an automatic `?play=` continuation.
The Google login remains intact when valid. The policy does not sign the player
out, cancel a match, release reservations or modify game state or settlement.
Private test and branded entries retain their separate explicit entry flows.

Browsers cannot reliably identify the user's reason for hiding a page. Mobile
browsers may discard a background tab; if recreated after two minutes, it returns
to the Lobby. A surviving live page continues. These are observable page-lifecycle
rules, not a guarantee of distinguishing every app close from a tab switch.

## Account Lifecycle

Sign-out ends the selected local Auth session without deleting the player,
wallet, history or active accounting obligations. Recovery belongs to Google.
Self-service account closure and retention are not implemented; never delete Auth
users directly without an ordered backend policy for financial and product data.

## Acceptance

Automated checks cover Google callback routing, invalid providers/flows, callback
replay, one-time grants, concurrent enrollment, player/wallet stability, session
permissions and rejected anonymous/outside-list identities. Native PostgreSQL
checks are required for releases. Local fixtures do not prove a real Google
provider interaction. Real Google accounts have verified inside-list signup and
outside-list rejection; remaining hosted cases are in
[KNOWN_ISSUES.md](../operations/KNOWN_ISSUES.md#test-gaps).

Turnstile is not a frontend dependency. Existing hosted Auth configuration is
separate from the Google-only member implementation.
