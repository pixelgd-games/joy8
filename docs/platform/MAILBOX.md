# Joy8 In-App Mailbox

## Status and scope

The player inbox (`/mailbox/`), administrator composer (`/admin/mail/`), Gateway
routes and incremental SQL are deployed. The approved migration is
`supabase/migrations/20260926100000_in_app_mailbox.sql`. Hosted installation and
permission checks are verified. No real mail or POINT was issued during
development or deployment; real-player issuance and claim acceptance remains
pending a designated player and approved amount.

Joy8 owns the service, identity, permissions and shared POINT accounting. It
uses database records, not email or SMTP. The initial UI runs in Joy8; Mahjong's
repository, standalone UI and SDK integration are outside this change. Games
must never receive the member JWT or a platform service-role key to use mail.

## Operator workflow

1. Sign into the Joy8 administrator portal with an approved Google identity and
   open **信件管理** from game administration.
2. Choose announcement, personal notification, event reward or compensation.
   Select one six-digit public player ID, all existing active enrolled players,
   or existing active enrolled players who have launched the selected game.
3. Enter a plain-text title (120 characters) and body (3,000 characters). A reward
   or compensation requires a positive whole POINT amount and an activity/case
   reference (200 characters). Its source can be Joy8 itself or a specific game;
   targeting that game's players requires a game selection. For corrections, put the verified
   incident and affected match/transaction reference in this field and explain
   the correction in the body. This reference is operator-supplied evidence,
   not an automated assertion that an incident occurred.
4. **建立預覽，確認收件名單** saves an immutable draft and snapshots eligible
   recipients. Confirm the player ID/audience, recipient count, amount per player
   and total commitment. The recipient detail view shows the complete list with
   pagination. No member sees the draft and no wallet is credited yet.
5. **確認發送** makes the snapshot visible. **取消這份草稿** abandons it. To change
   content, cancel the old draft and create a new preview. Only its creator can
   send/cancel a draft; all approved administrators can inspect the audit.
6. The history and recipient views show delivery visibility, read timestamps,
   claim timestamps and ledger transaction IDs. Sent content cannot be changed,
   recalled or deleted. Sending never claims on behalf of a player.

Players open **信箱** from the Lobby. Opening a letter marks it read; clicking
**領取 POINT** credits the shared wallet. Reading is distinct from claiming.
Members must finish any open game match before claiming, including an open match
with zero remaining reservation. The reward remains available for retry.

Initial limits: immediate sends, no expiry, no scheduled send, no player deletion,
no email delivery, no realtime subscription, no localization editor and no
transfer/withdrawal. New players do not receive old broadcasts automatically.
A preview includes at most 5,000 recipients; exceeding this aborts the entire
preview rather than sending to a partial list. This is an application bound,
not a Supabase plan limit or a measured hosted capacity claim. Amounts are whole
POINT, from 1 to 9,999,999,999 per recipient, with the total shown before sending.
Broadcasts beyond that audience bound need a separately designed batching flow.

## Data and accounting

- `joy8_mail_messages` owns immutable content, creator, recipient snapshot count,
  source reference and draft/sent/cancelled state. `joy8_mail_recipients` links a
  player to read/claim timestamps and the unique wallet transaction.
- RLS is enabled and direct table privileges are revoked from browser roles and
  `service_role`. Security-definer RPCs use an empty search path. The administrator
  RPC is executable by `authenticated` and calls the existing Google-only
  `is_joy8_admin()` check. The member RPC is executable only by `service_role`.
- Claim resolves the active enrolled player from the server-verified Auth user,
  locks the recipient row and active POINT wallet, checks open matches and posts
  the credit and claim receipt in one database transaction. Any failure rolls
  back all three changes. A claim retry returns the original receipt.
- Ledger type is `adjustment`; sources are `mail_reward` or `mail_compensation`.
  `source_ref` carries the operator reference. The unique idempotency key is
  `mail:<message UUID>:<player UUID>`. The recipient transaction ID connects the
  ledger to the immutable message and creator. Game settlement rows are untouched.
- A preview request has a caller-generated UUID and stored exact request. Reusing
  that UUID with the same creator/content returns the saved preview; changing
  content conflicts. Send/cancel operations lock the message and retry safely.
  A new draft UUID represents a new issuance, even if its text/reference matches
  an earlier one; operators must inspect history before issuing another draft.

## Gateway contract

Both routes accept `POST` JSON `{ "action": "...", "request": { ... } }` using
the corresponding Joy8 member/admin Auth bearer token. Only configured platform
origins are accepted. Existing ingress limits apply, followed by a verified-user
budget of 120 member or 30 admin requests per minute. A limited response is 429
with `Retry-After: 60`. Admin RPC is also reachable through authenticated
PostgREST; its Google admin check and database invariants remain authoritative,
while the Gateway rate limit applies only to Gateway traffic.

| Route | Actions | Request |
| --- | --- | --- |
| `mailbox` | `list` | `offset` (default 0), optional `game_id`; a game filter includes platform-wide mail |
| `mailbox` | `read`, `claim` | `id` only; caller cannot set player, wallet or amount |
| `admin-mailbox` | `prepare` | String fields: `id`, `kind`, `title`, `body`, `audience`, `game_id`, `public_id`, `amount`, `source_ref`; unused selector fields are empty strings |
| `admin-mailbox` | `send`, `cancel` | `id` only |
| `admin-mailbox` | `list` | `offset` (default 0) |
| `admin-mailbox` | `recipients` | `id`, `offset` (default 0) |

Lists return `items` and `offset`, with up to 21 rows so the UI can render 20 and
decide whether a next page exists. Member list also returns `unread`. Claims
return `id`, `claimed_at`, `transaction_id`, `amount`. Prepare includes
`recipient_count`, `public_id`, `total_amount`; members never receive the stored
operator request or recipient list. Refresh restarts at the first page; normal
offset pagination can shift when newer messages arrive.

Recognized business failures retain `JOY8_MAIL_*`, `JOY8_WALLET_INACTIVE`,
`JOY8_WALLET_OCCUPIED`, `JOY8_IDEMPOTENCY_CONFLICT` or `JOY8_INVALID_REQUEST`;
unknown SQL errors are replaced with `JOY8_UPSTREAM_UNAVAILABLE`. Frontend
rendering uses text nodes, not message-supplied HTML. Changing Auth identity
clears the currently displayed inbox/audit.

## Verification

`npm run verify` includes the mailbox database suite, mocked Gateway checks and
browser checks. `npm run test:mailbox` loads the canonical current platform
fixture. With `JOY8_TEST_ENGINE=postgres17` and `JOY8_TEST_PG_BIN` it also
checks competing claims on independent native PostgreSQL connections. Tests use
isolated data; no hosted SQL, real issuance or wallet changes occur.

Browser checks cover preview-before-send, exact send retry, duplicate-click
protection, recipient audit, separate read/claim, occupied-wallet recovery,
logout cleanup, HTML escaping and mobile widths. Set `JOY8_MAILBOX_SCREENSHOTS=1`
when running smoke to write mocked previews to `.mailbox-preview.local/`.
These do not prove real hosted Auth, network delivery or production capacity.

## Deployment and hosted acceptance

Changes follow `AGENTS.md`: prepare incremental SQL for confirmation, classify
approved migrations in `scripts/fixtures/platform-sources.json`, then apply
through `scripts/supabase-joy8.cmd`. Verify the linked project is
`Joy8 / lsazydefvnuqglultqii` before hosted operations. Deploy database dependencies
before the Gateway and production frontend. A push to `main` deploys Cloudflare
Pages and requires explicit upload/release authority.

The mailbox migration adds its objects/functions/grants/triggers and extends the
ledger source constraint to allow game-less positive mail adjustments for
platform events. It contains no send request, initial mail, wallet credit or
rewrite of existing ledger rows. The constraint change takes a table lock and
validates the existing ledger during installation.

Run the read-only `scripts/sql/mailbox-status.sql` via the wrapper to check
migration presence, RLS, RPC/table privileges, mail counts and claim receipts.
Use `scripts/sql/platform-reconciliation.sql` for wallet and reservation totals.
The hosted Gateway smoke checks health and authorization rejection paths without
creating identities, sessions, letters or credits.

Real Auth routing and a complete hosted send/read/claim cycle remain acceptance
gates. Use an explicitly approved test player and small reward to verify admin
authorization, player isolation, reading without credit, repeated claim with one
ledger credit and matching wallet/recipient records. This creates real immutable
mail/ledger data; release authorization alone does not select a recipient or
approve issuing currency. Local concurrency tests do not prove operational load.

If rollout fails before issuance, restore the previous frontend/Gateway. After
issuance, retain mail, receipts and ledger history; diagnose and correct through
a reviewed linked adjustment rather than deleting or rewriting it.
