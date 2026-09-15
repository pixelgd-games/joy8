# Looty AI Working Agreement

This document is for AI and Codex agents working in the Looty repository. It is not user-facing product documentation.

## Project Entry

Before substantive work in this repository:

1. On the first `D:\Studio` task in a conversation, read `D:\Studio\AGENTS.md` and `D:\Studio\AI_Studio\roles\lia.md`.
2. Read `D:\Studio\Project_Code\AGENTS.md`.
3. Read this file.
4. Read `README.md` for the current implementation and repository map.
5. Load only the task-specific documents listed below.

Do not claim a document was read unless it was read in the current task. Use read-only discovery before editing files or changing external state.

The repository root is `D:\Studio\Project_Code\looty`.

For asset creation, movement, cropping, compression, or export, first read `D:\Studio\Project_Art\README.md`.

## Documentation Routing

Read the smallest complete set for the task:

| Task | Required document |
| --- | --- |
| Current repository structure, setup, build, or deployment | `README.md` |
| Product boundaries, priorities, or roadmap | `docs/product/PRODUCT_SCOPE.md` |
| Looty game launch, iframe, Gateway, wallet, or game integration | `docs/platform/GAME_PLATFORM_INTEGRATION.md` |
| Member authentication, persistent guest identity, or direct Mahjong entry | `docs/platform/MEMBER_AUTH_PLAN.md` |
| CrazyGames builds, SDK, ads, saves, or store submission | `docs/platform/CRAZYGAMES_INTEGRATION.md` |
| Cross-module Flash context | `docs/platform/FLASH.md` |
| Confirmed limitations, risks, or launch blockers | `docs/operations/KNOWN_ISSUES.md` |
| Analytics, KPI, logging, alerts, or monitoring | `docs/operations/ANALYTICS_MONITORING.md` |

For a routine Git upload or download, this file and `README.md` are sufficient unless the change itself requires another document. A first upload must follow the complete Studio Git workflow.

When a non-gambling game ships to both Looty and CrazyGames, read both platform integration documents. Gambling products do not ship to CrazyGames.

## Documentation Ownership

- `README.md` is the source of truth for what this repository currently implements and how it is operated.
- Each specialized document owns only the subject named in the routing table.
- Tool-specific entry files such as `CLAUDE.md` stay as thin pointers to this agreement and do not duplicate project rules.
- Prefer updating an existing document over creating a new one.
- Keep one authoritative location for each fact. Other documents should link to it instead of copying it.
- Do not keep session diaries, deployment timelines, or resolved issue histories in active documentation. Git history and migrations already preserve history.
- AI-facing Markdown is written in English by default. Preserve non-English text only when it is an exact user-facing string, official name, quoted source, or explicit user requirement.
- If documentation conflicts with the repository, verify the implementation and report the mismatch before making a consequential change.

## Communication and Coding Style

- Address the user as `糖果爸爸`.
- Reply in Traditional Chinese, even when the user's message is transcribed in Simplified Chinese.
- Use plain language a non-specialist can understand.
- State what was done, what was not done, and what comes next.
- Keep code concise and do not add code comments.
- Follow the existing architecture and style.
- Do not perform unrelated refactoring or add unnecessary abstraction.
- Do not retain compatibility code for pre-launch legacy data, flows, or columns.

## Fixed Product Rules

- Do not convert Looty to React, Vue, Next.js, or another framework unless the user explicitly asks.
- Do not change the Cloudflare Pages static deployment architecture.
- Do not add a local `enabled-games` allowlist.
- Do not restore the front-end member login UI until the member entry point is redesigned.
- Do not move sibling Flash module responsibilities into Looty.
- Games must not log players in or modify player balances directly.
- Do not modify a game repository during a Looty repository task. Switch to the named game repository for game-side work.
- The Looty launch code and Gateway token stay in memory only. Never write them to browser storage, logs, or Analytics.
- Looty owns the Loader iframe shell, permissions, load timeout, and platform error screens.
- Each game owns its in-game rendering, resource loading, CSP, `X-Frame-Options`, and sandbox compatibility. Report game-side failures from this repository; do not fix them here.
- Lobby covers use a `3:4` ratio at `750 x 1000` in WebP format and live at `public/games/<slug>/cover.webp`.
- Lobby covers are Looty platform assets. Do not place or modify them in a game repository.

## Platform Separation

- Non-gambling games may share one core build across Looty, CrazyGames, and local development.
- Platform differences belong in the Looty Client, CrazyGames Client, and Local Client.
- The Local Client is only for local testing. It must not activate automatically when a real platform fails to initialize.
- Do not detect the platform from the iframe alone.
- One build must never call Looty and CrazyGames platform services at the same time.
- A CrazyGames build must not call the Looty Gateway.
- A Looty build must not initialize the CrazyGames SDK or load CrazyGames ads.
- Gambling classification is based on gameplay and transaction mechanics, not only `games.type`.
- Every product in `D:\Studio\Project-Gaming` is treated as gambling unless the user explicitly moves and reclassifies it. These products receive no CrazyGames Client, build, SDK, ads, or store assets.

## Git and GitHub

- The repository is `pixelgd-games/looty`.
- `origin` must remain `git@github-pixelgd:pixelgd-games/looty.git` unless the user explicitly approves a change.
- Interpret “upload to Git/GitHub” as commit and push unless the user explicitly requests a pull request.
- Before pushing, verify the current branch, `git remote get-url origin`, the `github-pixelgd` SSH account route, and the staged file scope.
- `ssh -T git@github-pixelgd` must identify the `pixelgd-games` account. Stop if it identifies another account.
- Do not require GitHub CLI for a normal SSH push. Use it only when the user explicitly asks to create or manage a pull request or issue.
- `main` is the Cloudflare Pages production branch. Pushing to `main` triggers a production deployment.
- Preserve unrelated and uncommitted user changes. Stage only the files in scope.
- After a requested push, verify local and remote commits match and report whether the working tree is clean.

## Supabase Safety

- The Looty Supabase project is `Looty`, ref `lsazydefvnuqglultqii`.
- Use `.\scripts\supabase-looty.cmd` for remote Supabase operations.
- Before every database operation, run `.\scripts\supabase-looty.cmd projects list` and require `Looty / lsazydefvnuqglultqii / linked: true`.
- Stop if only the `arua` project appears. Check `.env.supabase.local` before asking the user to log in again.
- If the wrapper returns `Unauthorized` while `.env.supabase.local` contains a token, stop and ask the user to refresh that token locally. Never ask the user to paste it into chat.
- Do not use Aura or another project's Supabase CLI state for Looty.
- Supabase MCP is not authorized for Looty and is not the primary operating method.
- Before changing the database, prepare a small, reviewable SQL migration and ask the user to confirm it.
- Do not leave unconfirmed baseline or large-rebuild migrations in the active migration folder.
- `.env.supabase.local` is local-only. Never commit it or expose access tokens, service-role keys, or database passwords in code, documents, logs, or chat.
- The repository intentionally has no baseline migration. Future changes use small incremental migrations.
- Do not revive `players`, `player_balances`, `access_whitelist`, `site_settings`, or `ensure_my_player_v1()`.
- The current player table is `player_accounts`; wallets use `wallet_accounts` and `wallet_transactions`.
- Player, guest, and wallet initialization belongs in database RPC or backend flows. The front end must not write those tables directly.
- Game session and wallet RPCs remain `service_role` only and must not be called from the front end.
- Demo wallets use only `POINT`. The database-level currency constraint is deliberately on hold; do not recreate or apply it without a new user decision.
- Until that decision changes, new Demo `POINT` wallets keep the 10,000-point test credit.

## Change Verification

- Validate changes in proportion to risk and use the commands documented in `README.md`.
- Distinguish verified facts from assumptions.
- Surface instruction conflicts, tool substitutions, and blockers immediately.
- Do not start implementation merely because a problem is listed in documentation; act only within the user's request.
