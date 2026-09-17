# Looty

Looty is a lightweight H5 game platform. This repository contains the public Lobby, the Game Loader, the game administration pages, and the Looty Gateway Edge Function.

This file is the source of truth for the repository's current implementation. Product decisions, integration contracts, operational risks, and analytics plans live in the specialized documents listed below.

Last implementation review: 2026-09-17.

The member foundation includes public Lobby browsing, explicit login or guest
entry, and persistent player enrollment. Both member migrations are applied to
the hosted database and Gateway version 6 is active. The matching front end is
released from `main`. Real Google, email, linking and recovery acceptance remain
outstanding; this is still a Demo wallet platform.

## Current Scope

Looty currently provides:

- A public mobile-first game Lobby.
- A database-backed game catalog exposed through `public_games_v1`.
- A Game Loader that creates a Looty session and embeds a selected game in an iframe.
- A reusable `/account/` entry for Google, Email/password, and persistent guests,
  with verification, recovery, guest promotion, and explicit player enrollment.
  Google, email, linking and recovery still require real provider acceptance.
- Google OAuth for game administration, with server-side administrator verification.
- CRUD pages for the `games` catalog.
- A Supabase Edge Function for launch-code exchange, session authorization, Demo wallet operations, and runtime rate limits.
- Cloudflare Pages static deployment from the `main` branch.
- PWA metadata and install support for the Lobby.

Looty does not currently provide:

- Fully provider-verified public member flows or branded cross-origin handoff.
- Production money movement.
- Full analytics, dashboards, alerting, or an operational health endpoint.
- A game runtime or game-specific business logic.
- CrazyGames integration inside this repository.

See [PRODUCT_SCOPE.md](docs/product/PRODUCT_SCOPE.md) for the H5 release,
both product models, operational POINT direction, and platform -> product ->
integration order. The member foundation starts the platform stage; scoped wallets,
trusted settlement, and product integration are still planned.

## Architecture

```text
Browser
  ├─ Lobby ─────────────── public_games_v1
  ├─ Member entry ──────── Supabase Auth + Gateway member/enroll-member
  ├─ Admin pages ───────── games + is_looty_admin()
  └─ Game Loader
       ├─ public_games_v1
       ├─ looty-gateway/create-session
       └─ game iframe
            └─ looty-gateway
                 └─ service-role database RPCs
```

The front end is a Vite multi-page application written in vanilla JavaScript and
CSS. Admin/catalog use the existing Supabase client. Member entry and launch use
a separate PKCE client with storage key `looty-member-auth-v1`; Auth session
storage is platform-owned and never passed into games. The Gateway is the only
public path to protected player, game-session, and wallet RPCs. Separate browser
storage does not grant administrator or player eligibility.

### Browser Entries

| Route | Entry | Responsibility |
| --- | --- | --- |
| `/` | `index.html` | Public Lobby |
| `/account/` | `account/index.html` | Member entry, Auth callback, guest upgrade and recovery |
| `/game/` | `game/index.html` | Loader and iframe shell |
| `/admin/login/` | `admin/login/index.html` | Google OAuth entry |
| `/admin/games/` | `admin/games/index.html` | Game list |
| `/admin/games/new/` | `admin/games/new/index.html` | Create game |
| `/admin/games/edit/` | `admin/games/edit/index.html` | Edit game |

Vite declares these entries in `vite.config.js`.

### Source Map

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Lobby bootstrap |
| `src/pages/lobby/` | Lobby data loading, rendering, and layout |
| `src/pages/game/` | Game lookup, session creation, and iframe handling |
| `src/admin/` | Admin authentication and game CRUD |
| `src/lib/supabaseClient.js` | Shared browser Supabase client |
| `src/lib/memberClient.js` | Separate member Auth session and Gateway client |
| `src/member/` | H5 member UI and testable authentication flow |
| `src/lib/urls.js` | URL helpers |
| `src/ui/error-modal.js` | Shared error presentation |
| `src/styles/` | Theme and Lobby styles |
| `supabase/functions/looty-gateway/index.ts` | Gateway Edge Function |
| `supabase/migrations/` | Incremental database migrations |
| `supabase/drafts/` | Unapproved SQL excluded from automatic migration discovery |
| `scripts/` | Local verification and Supabase routing helpers |
| `public/games/<slug>/cover.webp` | Looty-managed Lobby covers |

## Runtime Flows

### Lobby

1. The Lobby reads published games from `public_games_v1`.
   The platform entry is `/`: browsing the Lobby does not require login or open
   an authentication page. The top-bar `登入` control opens the shared member UI
   in a dismissible dialog; the Lobby remains visible and its URL is unchanged.
   `/account/` remains available for Auth callbacks and recovery.
2. Cards are rendered from database metadata.
3. Selecting a game checks membership. Enrolled registered players and persistent
   guests continue to `/game/?slug=<slug>`. Other visitors see the member dialog
   over the Lobby, with the chosen game named in the dialog. Google/password or
   explicit guest entry preserves that game destination. Closing cancels it;
   another game or the top-bar login starts a new selection.
4. Missing cover images use the platform fallback behavior.

The responsive Lobby uses four columns on touch devices with a low-height landscape viewport. Desktop and mobile portrait layouts remain separate.

### Game Launch

1. The Loader reads `slug` from the URL.
   A direct link with missing member session/enrollment redirects to `/?play=<slug>`.
   The Lobby validates that the game is published, clears the temporary query,
   and opens the member dialog. Backend failures stop launch visibly.
2. It loads the matching published game from `public_games_v1`.
3. It normalizes `launch_url` as an HTTPS URL or a root-relative platform path. HTTP is accepted only between loopback hosts during local development.
4. It calls `looty-gateway/create-session`.
5. It appends the returned session parameters to the game URL.
6. It creates the iframe with the Looty sandbox, permissions, referrer policy, and load timeout.

The iframe receives:

- `looty_session_id`
- `looty_launch_code`
- `looty_game_id`
- `looty_currency`
- `looty_wallet_mode`
- `looty_gateway_url`
- `looty_exchange_url`

The launch code is single-use and valid for two minutes. A game exchanges it for an in-memory Gateway token that is valid for at most one hour. The Loader never passes a Supabase anonymous key, member JWT, or service-role key into the iframe.

The full game-facing contract is in `docs/platform/GAME_PLATFORM_INTEGRATION.md`.

### Member Entry

Google uses PKCE and explicit callback exchange. Email signup requires
verification; recovery and guest email promotion return to password setup.
Guest Google promotion links a provider to the existing Auth user. Guest email
promotion verifies the email before assigning a password. Callbacks check the
original identity and never merge players or wallets. Email callbacks must open
in the browser holding the PKCE verifier; a missing verifier requires restarting
the flow. Guest creation uses Web Locks across tabs and fails closed without
that browser capability. Logout is local to the selected Auth session and does
not create a replacement guest. Clearing storage can lose guest access.

`POST /member` resolves existing enrollment; `POST /enroll-member` explicitly
enrolls the authenticated identity. Both take an empty JSON object, require an
allowed Origin and server-verified bearer token, and return
`{ "member": { "player_account_ref": "...", "account_type": "guest|registered" } }`.
The read route may return `{ "member": null }`. The member migrations preserve player
IDs, derive guest status from Auth, reject inactive accounts, and grant RPC
execution only to the service role. Neither member route provisions a wallet.

### Administration

1. An administrator signs in with Google OAuth.
2. The browser calls `is_looty_admin()`.
3. Authorized users can list, create, edit, publish, and unpublish catalog records.
4. Public users read only the safe fields exposed by `public_games_v1`.

The front end does not write player, wallet, round, or session tables directly.

## Gateway

The deployed Gateway version 6 includes member entry. Routes are:

- `POST /member`
- `POST /enroll-member`
- `POST /create-session`
- `POST /exchange`
- `POST /balance`
- `POST /bet`
- `POST /payout`
- `POST /refund`
- `POST /close-round`

The public base URL is:

```text
https://lsazydefvnuqglultqii.supabase.co/functions/v1/looty-gateway
```

Current safeguards include:

- Route and HTTP method validation.
- Origin and CORS validation.
- A 16 KiB streamed request-body limit.
- Launch-code and Gateway-token hashing.
- Token scope and session validation.
- Database-backed runtime rate limits.
- A 5-second authentication timeout and an 8-second RPC timeout.
- Demo currency enforcement at the Gateway.
- Idempotent wallet transaction behavior.
- Cross-session round isolation.

The Gateway uses `verify_jwt=false` because it performs its own launch-code, token, origin, scope, session, and rate-limit checks. Its protected database RPCs are granted only to `service_role`.

## Database

The Looty Supabase project is `Looty`, ref `lsazydefvnuqglultqii`.

The current public-schema core is:

- `games`
- `admin_users`
- `public_games_v1`
- `player_accounts`
- `wallet_accounts`
- `wallet_transactions`
- `game_sessions`
- `game_rounds`
- `gateway_rate_limits`

The platform skeleton tables and `gateway_rate_limits` have row-level security enabled. Front-end table grants and policies are not provided for the protected platform tables.

Demo wallets currently support only `POINT`. A new Demo `POINT` wallet receives a 10,000-point test credit recorded as a deposit transaction. The additional database-level Demo currency constraint is intentionally on hold; the Gateway still rejects non-`POINT` Demo sessions.

The current active wallet key is player plus currency, with no explicit platform-versus-game scope. Games using `POINT` therefore reuse the same active wallet today. The approved product-aware wallet-scope direction is documented in `docs/product/PRODUCT_SCOPE.md`, but it is not implemented and there is no currency-conversion endpoint.

The `game_rounds` table stores only the platform session relationship and aggregate bet, payout, refund, status, and settlement data needed by the wallet flow. It is not a full gameplay or match-history store. Each game owns its authoritative player mapping, rooms, matches, actions, results, progression, and history in its game-owned schema and backend boundary and correlates them with Looty references through the integration contract. The approved initial cost model may host those permission-separated schemas in the same managed Supabase project; no game schema has been added by this repository yet.

The repository has no baseline migration. Existing migrations are incremental
and cannot reconstruct the full local database alone. Three incomplete Mahjong
drafts are in `supabase/drafts/mahjong-clash/` and remain unapplied. Follow their
[review instructions](supabase/drafts/README.md) before promoting any to migrations.
The two member migrations are active in `supabase/migrations/`; all 19 local and
hosted migration records match. Their application preserved existing player,
wallet, ledger and session counts and total balances.
Review blockers are tracked in [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md).

## Local Development

Requirements:

- Node.js 22, using the version in `.node-version`.
- A local `.env.local` containing:

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Do not commit or quote real credentials. A local Vite server still uses the
database configured in `.env.local`; localhost alone does not isolate data.
The full local Supabase stack is not yet reproducible from this repository.
The member SQL checks below use a small isolated fixture and synthetic data.
See the environment direction in [PRODUCT_SCOPE.md](docs/product/PRODUCT_SCOPE.md)
and the recovery limitation in [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md).

Install and run:

```powershell
npm install
npm run dev
```

Production build and local preview:

```powershell
npm run build
npm run preview
```

## Verification

Use the checks that match the change:

```powershell
npm audit
npm run build
npm run smoke
npm run test:gateway
npm run test:member
npm run test:member-db
```

`test:member-db` runs both member migrations in an in-memory PGlite
database with pgcrypto, a minimal Auth/catalog fixture, and four existing platform
migrations. It never reads environment credentials or connects to Supabase.
Its 14 checks execute SQL for enrollment, repeated launch, guest promotion,
existing player/wallet preservation, once-only Demo credit, inactive accounts,
browser-role denial, secret hashing/expiry, and transaction rollback.
PGlite 0.5.8 uses PostgreSQL 18.3 and one connection; this is not validation of
hosted PostgreSQL 17 concurrency, Supabase Auth internals, or provider behavior.
The fixture is test-only, not a baseline migration or hosted deployment script.

`test:member-pg` runs the same 14 checks plus eight competing-connection checks
against a fresh native PostgreSQL 17 cluster. It has passed on PostgreSQL 17.6.
The race tests observe actual blocked database connections before releasing the
held transaction. They cover simultaneous enrollment/launch, committed and
rolled-back promotion, both wallet-freeze orderings, enrollment rollback, and
independent identities. These are deterministic fixture cases, not a load test
or proof of hosted Auth behavior.

Set `LOOTY_TEST_PG_BIN` to an absolute directory containing PostgreSQL 17's
`postgres`, `initdb`, and `pg_ctl` executables, then run `npm run test:member-pg`.
The helper creates an isolated temporary cluster, binds only to `127.0.0.1` on
an available port, generates a temporary password, and stops/removes its cluster
after the tests. It takes no database URL and never reads `.env` credentials.
It does not install a Windows service or require Docker. On Windows, the tested
portable runtime can be prepared outside the repository with:

```powershell
$lootyPgTools = Join-Path $env:TEMP 'looty-pg17-tools'
npm install --prefix $lootyPgTools --ignore-scripts --no-audit --no-fund --save-exact '@embedded-postgres/windows-x64@17.6.0-beta.15'
$env:LOOTY_TEST_PG_BIN = Join-Path $lootyPgTools 'node_modules\@embedded-postgres\windows-x64\native\bin'
npm run test:member-pg
```

Member unit checks use mocked Auth/Gateway services; browser smoke checks cover
the shared member dialog, cancellation/reselection, provider return destinations,
safe direct-link entry, recovery form states, simulated guest controls, and
320/390/1280 px layouts. They do not verify hosted OAuth, email delivery, actual
database concurrency, grants, wallet preservation, or end-to-end recovery.
`supabase/config.toml` enables anonymous Auth, manual linking, confirmation and a
10-character minimum password for future local testing; it does not change the
hosted project. Production provider and abuse settings remain a release gate.

`npm run smoke:gateway` targets the deployed Gateway and may create remote runtime data unless it is explicitly configured for a non-mutating check. Read the script and confirm the intended environment before running it.

For Markdown-only changes, validate document links, paths, language, and architecture claims; a production build is not required unless implementation files also changed.

## Supabase Operations

Looty uses a project-specific wrapper:

```powershell
.\scripts\supabase-looty.cmd projects list
```

The result must show:

```text
Looty / lsazydefvnuqglultqii / linked: true
```

Do not continue if the active CLI state points only to Aura or another project. Database changes require a small user-reviewed migration before application. See `AGENTS.md` for the complete safety rules.

### Hosted Auth Configuration

Verified in the Looty dashboard on 2026-09-17 using the user-authorized Chrome
session for `pixelgd.games@gmail.com`, organization Pixel GD, project
`lsazydefvnuqglultqii`:

- Google and Email providers, new-user signup and email confirmation are enabled.
- Anonymous sign-in and manual identity linking are enabled and saved.
- Site URL is `https://looty-git.pages.dev`.
- Member redirect allowlist entries are `https://looty-git.pages.dev/account/*`,
  `http://127.0.0.1:5173/account/*`, `http://localhost:5173/account/*`,
  `http://127.0.0.1:4173/account/*`, and `http://localhost:4173/account/*`.
  The suffix accommodates the encoded `next` and `flow` query parameters while
  keeping the host and member route fixed. The three existing admin callback
  entries remain unchanged, for eight entries total.
- Email delivery still uses Supabase's built-in testing service. Custom SMTP is
  not configured. CAPTCHA is off. Hosted password policy and real provider,
  linking, verification and recovery behavior remain to be validated.

The CLI wrapper still supports project/migration listing and database reads;
its combined `config diff` read was denied. The authorized dashboard inspection
resolved the member-settings visibility gap without replacing the local token.
It does not establish that the CLI now has configuration read/write access.

## Deployment

- Hosting: Cloudflare Pages.
- Production branch: `main`.
- Production hostname: `looty-git.pages.dev`.
- Build command: `npm run build`.
- Output directory: `dist`.
- Required production variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

A push to `main` triggers production deployment. Do not push documentation or code changes unless the user explicitly requests it.

The Supabase Edge Function is deployed separately from Cloudflare Pages.

## Game and Asset Boundaries

- Looty owns the catalog, Loader, iframe shell, platform error states, and Lobby covers.
- A game owns its rendering, assets, CSP, `X-Frame-Options`, and sandbox compatibility.
- Game source changes must be made in the named game repository, not here.
- Lobby covers use `750 x 1000` WebP at `public/games/<slug>/cover.webp`.
- Read `D:\Studio\Project_Art\README.md` before creating, moving, or exporting any asset.

## Documentation Map

| Document | Owns |
| --- | --- |
| `AGENTS.md` | AI workflow, fixed rules, safety, and document routing |
| `CLAUDE.md` | Thin Claude Code entry that points back to `AGENTS.md` |
| `README.md` | Current repository implementation and operation |
| `docs/product/PRODUCT_SCOPE.md` | Product boundaries, approved direction, and priorities |
| `docs/platform/GAME_PLATFORM_INTEGRATION.md` | Looty-to-game runtime contract |
| `docs/platform/MEMBER_AUTH_PLAN.md` | Platform-wide member, persistent guest, game-wallet relationship, and branded-entry plan |
| `docs/platform/CRAZYGAMES_INTEGRATION.md` | CrazyGames build and submission requirements |
| `docs/platform/FLASH.md` | Stable cross-module Flash context |
| `docs/operations/KNOWN_ISSUES.md` | Active limitations, risks, and launch blockers |
| `docs/operations/ANALYTICS_MONITORING.md` | Analytics, KPI, logging, dashboards, and alerts |

Do not copy whole sections between these documents. Link to the owning document when another subject needs context.
