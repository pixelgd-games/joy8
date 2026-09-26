# Joy8 SDK API Reference

This reference covers the supported `@joy8/game-sdk` surface for third-party
`server-v1` integrations. The authoritative wire contract remains
[`GAME_PLATFORM_INTEGRATION.md`](../../docs/platform/GAME_PLATFORM_INTEGRATION.md).

## Browser API

Import browser functions only from `@joy8/game-sdk/browser`.

### `receiveJoy8Launch(options)`

Install this receiver before the game runtime starts.

Required options:

- `parentOrigins`: exact approved Joy8 origins. Wildcards are rejected.
- `expectedGameId`: the non-secret Game ID supplied by Joy8.
- `gatewayUrl`: the trusted Joy8 Gateway base URL.

Optional options are `timeoutMs` from 1,000 through 60,000 and an
`AbortSignal`. The returned promise resolves once with:

```js
{
  joy8_session_id,
  joy8_launch_code,
  joy8_game_id,
  joy8_currency: "POINT",
  joy8_protocol: "server-v1",
  joy8_gateway_url,
}
```

The function rejects URL-based Joy8 credentials, an unexpected parent, Game ID,
Gateway URL, protocol or currency, malformed fields, timeout and cancellation.
It removes its listener after success or failure and provides no Local fallback.

### `getJoy8Balance(options)`

Required options are `gatewayUrl` and the short-lived `gatewayToken` returned by
the provider backend after exchange. It returns:

```js
{ sessionId, playerAccountRef, currency: "POINT", balance, lockedBalance }
```

`balance` and `lockedBalance` are decimal strings. The token and launch code
remain in memory and must not enter storage, URLs, logs, analytics or save data.

## Server API

Import the server client only in the provider backend:

```js
import { Joy8ServerClient } from "@joy8/game-sdk/server"

const joy8 = new Joy8ServerClient({
  gatewayUrl: process.env.JOY8_GATEWAY_URL,
  gameId: process.env.JOY8_GAME_ID,
  backendKey: process.env.JOY8_BACKEND_KEY,
})
```

The Backend Key must be 64 lowercase hexadecimal characters and exist only in
the backend secret manager. The optional `timeoutMs` is from 1,000 through
30,000. The SDK sends no browser Origin and never retries automatically.

### `exchangeLaunchCode({ launchCode })`

Redeems a one-use launch code. The returned session contains `sessionId`,
`gameId`, `playerAccountRef`, `accountType`, `walletScope`, `currency`,
`gatewayToken`, token/session expiry values and `scopes`. Only the provider
backend may call this method.

### `renewSession({ sessionId })`

Returns the same session shape with a new balance token. Serialize renewal per
session and discard the old token. Renewal does not extend the Joy8 session.

### `openMatch(request)`

```js
{
  matchRef,
  ruleVersion,
  participants: [{ sessionId, reserve }],
  productParticipants?: [{ accountRef, reserve }],
  settlement?: { operationKey, final, entries, productCommit? },
}
```

There must be at least one human participant. Amounts are decimal strings. Use
the durable game match reference and reserve the maximum authorized player loss.
Do not send `productParticipants` for a platform-funded game.
When `settlement` is supplied, Joy8 opens the match and commits settlement 1
in the same transaction. `final:true` finishes a paid spin; `final:false` keeps
the match open for later Free Spins. Exact `matchRef` and body retries return
the saved first settlement with the current match state; changed content conflicts. The response contains `matchId`,
`state`, `settlement` (or `null`), and `availableBalance` for one player. For
multiple players it contains `availableBalances` keyed by player account ID.
Amounts are two-decimal strings read from the current wallet on each response,
including retries. Nested `settlement` contains only saved settlement fields.

### `settleMatch(request)`

```js
{
  matchRef,
  ruleVersion,
  operationKey,
  settlementNo,
  final,
  entries: [{ kind, accountRef, amount, source }],
  productCommit?: {},
}
```

`kind` is `player`, `product` or `fee`; `source` is `gameplay` or `fee`.
Entries are signed nonzero decimal changes. A platform-funded game submits only
its player/fee results; it never invents a `platform` entry. A zero-change result
uses an empty entry list. Continuous settlement increments `settlementNo` and
uses `final:true` only on the last posting.
The response also contains the current `availableBalance` string, or
`availableBalances` for multiple players. Retries retain the saved settlement
fields but read the available balance again; see the
[authoritative contract](../../docs/platform/GAME_PLATFORM_INTEGRATION.md#open-and-settle).
While a round remains open, Joy8
continues to lock its winnings until the final settlement releases them.

### `getMatchStatus({ matchRef })`

Returns the current `matchId`, state, most recent result and settlement count.
After a timeout or uncertain response, call this before deciding whether to
retry. An exact retry must preserve the operation key and logical request body.

### `cancelMatch({ matchRef })`

Releases the unfinished reservation only after the authoritative game marks the
match void. Cancellation does not reverse a completed settlement.

## Errors

Configuration and local validation failures throw `Joy8SdkError`. Gateway
failures throw `Joy8ApiError`, which exposes `code`, HTTP `status`, support
`requestId` and optional `retryAfterSeconds`. Error text never contains the
Backend Key.
