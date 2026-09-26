# @joy8/game-sdk

Official Joy8 SDK for third-party `server-v1` game integrations.

The SDK has two trust boundaries:

- `@joy8/game-sdk/browser` receives the in-memory launch handoff and reads the
  balance with a short-lived Gateway token.
- `@joy8/game-sdk/server` uses the game-specific Backend Key for exchange,
  renewal, match opening, settlement, status and cancellation.

Never import the server client into a browser build. Never expose
`JOY8_BACKEND_KEY` to the game client, a URL, logs, analytics or source control.

The authoritative protocol is
[`docs/platform/GAME_PLATFORM_INTEGRATION.md`](../../docs/platform/GAME_PLATFORM_INTEGRATION.md).

## Installation

Until the package is published to a registry, Joy8 supplies a versioned npm
tarball with the integration kit:

The package is marked `private: true` to prevent an accidental registry release.
Local `npm pack` remains supported. Licensing and registry publication require
an explicit decision; `UNLICENSED` does not grant third-party redistribution rights.

```bash
npm install ./joy8-game-sdk-1.1.0.tgz
```

Joy8 builds the tarball with:

```bash
npm pack ./packages/joy8-game-sdk
```

## Browser handoff

Install the listener before loading the game runtime. The function rejects
legacy URL credentials, wildcard parent origins, another Game ID, another
Gateway URL, malformed launch fields and timeout. It never falls back to Local.

```js
import { receiveJoy8Launch } from "@joy8/game-sdk/browser"

const launch = await receiveJoy8Launch({
  parentOrigins: ["https://joy8.cc", "https://www.joy8.cc"],
  expectedGameId: import.meta.env.VITE_JOY8_GAME_ID,
  gatewayUrl: import.meta.env.VITE_JOY8_GATEWAY_URL,
})

const response = await fetch("/api/joy8/exchange", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ launchCode: launch.joy8_launch_code }),
})
```

The game must authenticate its own `/api/joy8/exchange` endpoint and return only
the player session fields needed by its client. Do not return the Backend Key.

To read available POINT after the backend returns the short-lived balance token:

```js
import { getJoy8Balance } from "@joy8/game-sdk/browser"

const balance = await getJoy8Balance({
  gatewayUrl: launch.joy8_gateway_url,
  gatewayToken,
})
```

Keep both the launch code and Gateway token in memory only.

## Server client

```js
import { Joy8ServerClient } from "@joy8/game-sdk/server"

const joy8 = new Joy8ServerClient({
  gatewayUrl: process.env.JOY8_GATEWAY_URL,
  gameId: process.env.JOY8_GAME_ID,
  backendKey: process.env.JOY8_BACKEND_KEY,
})

const session = await joy8.exchangeLaunchCode({ launchCode })
```

Open a single-player platform-funded spin:

```js
await joy8.openMatch({
  matchRef: spin.id,
  ruleVersion: process.env.JOY8_RULE_VERSION,
  participants: [{ sessionId: session.sessionId, reserve: "100.00" }],
})
```

For an authoritative result already known before opening, pass the optional
first settlement in the same request. Joy8 commits the open and settlement
together. `final: false` keeps the match open for later Free Spins; `final: true`
completes it. Replays must use the identical `matchRef` and settlement content.

```js
const opened = await joy8.openMatch({
  matchRef: spin.id,
  ruleVersion: process.env.JOY8_RULE_VERSION,
  participants: [{ sessionId: session.sessionId, reserve: "100.00" }],
  settlement: {
    operationKey: `${spin.id}:settlement:1`,
    final: true,
    entries: [{ kind: "player", accountRef: session.playerAccountRef,
      amount: "-100.00", source: "gameplay" }],
  },
})
```

For a single-player match, `openMatch` and `settleMatch` return
`availableBalance` as a two-decimal POINT string. An opening with an embedded
settlement also returns its `settlement` result. Multi-player matches return
`availableBalances` keyed by player account UUID. During a Gateway rollout,
the new SDK accepts older responses and returns `null` for missing balance
fields.

Top-level balances are read from the current wallet on each request, including
historical retries; they are not immutable settlement snapshots. Saved settlement
fields stay unchanged and do not post twice. Nested `settlement` and status
`result` objects contain only the saved settlement, without a live balance.
The nested SDK settlement therefore has `null` balance fields. See the
[settlement contract](../../docs/platform/GAME_PLATFORM_INTEGRATION.md#open-and-settle).

Settle a player loss:

```js
await joy8.settleMatch({
  matchRef: spin.id,
  ruleVersion: process.env.JOY8_RULE_VERSION,
  operationKey: `${spin.id}:settlement:1`,
  settlementNo: 1,
  final: true,
  entries: [{
    kind: "player",
    accountRef: session.playerAccountRef,
    amount: "-100.00",
    source: "gameplay",
  }],
})
```

The SDK does not generate match references, operation keys or gameplay results.
Those values must come from the game's durable authoritative backend state.
It also does not retry financial requests automatically. After an uncertain
response, call `getMatchStatus` and retry the exact same operation key and body.

Continuous settlement uses increasing `settlementNo` values. Set `final:false`
until the final result, then use `final:true`. Exact retries keep the same number,
operation key and request body.

## Errors

`Joy8ApiError` exposes:

- `code`: stable Joy8 error code when available.
- `status`: HTTP status.
- `requestId`: `X-Joy8-Request-Id` for support correlation.
- `retryAfterSeconds`: rate-limit delay when supplied.

The SDK never includes the Backend Key in error messages.
HTTP timeouts cover both receiving headers and reading the complete response body.
