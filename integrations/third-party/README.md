# Joy8 Third-Party Game Integration Kit

Kit version: `1.0.0`. Its machine-readable version and protocol are in
[`manifest.json`](manifest.json).

This kit is the handoff package for a game provider implementing Joy8
`server-v1`. The provider owns and changes its game. Joy8 does not edit a
third-party game repository or deploy its frontend/backend.

The runtime authority is
[`GAME_PLATFORM_INTEGRATION.md`](../../docs/platform/GAME_PLATFORM_INTEGRATION.md).
The installable SDK source is
[`@joy8/game-sdk`](../../packages/joy8-game-sdk/README.md).
The concise method reference is [`API.md`](API.md). For an independent AI-led
implementation, use [`AI_HANDOFF.md`](AI_HANDOFF.md) after the profile and secret
environment are prepared.

## What Joy8 provides at integration kickoff

Joy8 must provide these items before implementation begins:

- Game ID, which is not secret.
- Gateway base URL.
- Exact approved Joy8 parent origins.
- Protocol `server-v1` and currency `POINT`.
- Confirmed rule version.
- Wallet policy: funding mode, maximum bet, maximum payout and participant limit.
- A restricted, expiring test Backend Key delivered once through a secure channel.
- The SDK package, API contract and this acceptance checklist.
- Private-test POINT and account conditions.

The test Backend Key enables integration work; it does not publish the game.
Joy8 records only its hash. The provider stores the plaintext in its own backend
secret manager under `JOY8_BACKEND_KEY`. No frontend developer, browser bundle,
URL, repository, log or analytics system receives it.

No credential portal is required for the initial workflow. The Joy8 operator
tool generates the credential, registers only its SHA-256 hash in Joy8 and sends
the plaintext through standard input directly to an authorized Cloudflare
Worker secret. It never prints the plaintext or writes it to a profile, command
argument or temporary SQL file. A provider must not invent its own key because
an unregistered value cannot authenticate. When Joy8 does not control the
provider's Cloudflare environment, use an approved one-time secret channel
instead of chat, email or source control. After acceptance, Joy8 either rotates
to a production key or explicitly approves the existing key and then revokes
every obsolete test key.

## Platform operator flow

Copy the non-secret examples to ignored local files, fill the reviewed values,
and keep the game profile separate from the delivery target:

```text
integrations/third-party/integration-profile.local.json
integrations/third-party/backend-key-delivery.local.json
```

Review without creating a key or changing remote state:

```powershell
npm run key:backend -- plan --profile integrations/third-party/integration-profile.local.json --delivery integrations/third-party/backend-key-delivery.local.json
```

After the hidden game, enabled wallet policy, expiry, scope, Worker name and
Cloudflare account are independently reviewed, perform the operation:

```powershell
npm run key:backend -- provision --profile integrations/third-party/integration-profile.local.json --delivery integrations/third-party/backend-key-delivery.local.json --apply
```

The command first verifies that `Joy8 / lsazydefvnuqglultqii` is the linked
Supabase project. It then registers only the hash and deploys the secret to the
named Worker. A delivery failure revokes the new database record. Rotation
installs the replacement before revoking the specifically named old key:

```powershell
npm run key:backend -- rotate --profile integrations/third-party/integration-profile.local.json --delivery integrations/third-party/backend-key-delivery.local.json --old-key-id 00000000-0000-4000-8000-000000000000 --apply
npm run key:backend -- status --profile integrations/third-party/integration-profile.local.json
npm run key:backend -- revoke --profile integrations/third-party/integration-profile.local.json --key-id 00000000-0000-4000-8000-000000000000 --apply
```

Cloudflare secret installation deploys the Worker immediately. The target
backend must have its own local Wrangler dependency and an already-authenticated
operator session. The tool refuses to download or run an unpinned Wrangler.

## What the provider returns

- Final HTTPS game URL and backend URL.
- Exact Content Security Policy and frame-embedding confirmation.
- Implemented SDK version and rule version.
- Durable match/result storage and idempotency design.
- Recovery behavior for timeouts, restarts and repeated settlement callbacks.
- Test evidence for every item in `ACCEPTANCE.md`.
- A private integration build for Joy8 acceptance.

## Integration sequence

1. Joy8 and the provider complete `integration-profile.example.json` without
   putting the Backend Key in that file.
2. Joy8 delivers the Game ID, SDK and restricted test Backend Key.
3. The provider installs the Browser SDK before its game runtime and configures
   the Server SDK in its backend.
4. The provider implements its authoritative game state, match references,
   operation keys and exact retry behavior.
5. The provider completes local tests and the acceptance checklist.
6. Joy8 enables only the reviewed private entry and runs an end-to-end test.
7. Both sides verify balance, reservation, settlement, status, cancel, restart,
   timeout and duplicate-request behavior.
8. Joy8 reviews production URLs, policy, credential scope and expiry before
   separately authorizing public release.

## Files

- `integration-profile.example.json`: non-secret configuration template.
- `profiles/monster-lab.json`: reviewed non-secret Monster Lab profile.
- `backend-key-delivery.example.json`: non-secret Cloudflare delivery target.
- `manifest.json`: kit, SDK and protocol versions plus entry documents.
- `server.env.example`: backend environment-variable names; never add values to Git.
- `API.md`: concise Browser and Server SDK method reference.
- `AI_HANDOFF.md`: prompt and secret-handling boundary for another AI.
- `ACCEPTANCE.md`: required provider and joint acceptance cases.
- `examples/browser.mjs`: in-memory parent handoff example.
- `examples/server.mjs`: backend exchange and settlement example.
