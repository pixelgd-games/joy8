# Joy8 Game Integration AI Handoff

Use this template to assign a game-side integration to another AI after Joy8
has completed the non-secret game profile and securely installed the test
Backend Key in the provider backend environment. Never paste the key into the
prompt, source code or a tracked environment file.

## Prompt template

```text
Integrate this game with Joy8 server-v1 using the supplied Joy8 third-party kit.

Read, in order:
1. integrations/third-party/README.md
2. integrations/third-party/integration-profile.json
3. integrations/third-party/API.md
4. packages/joy8-game-sdk/README.md
5. integrations/third-party/ACCEPTANCE.md

Use @joy8/game-sdk/browser only in the browser build and
@joy8/game-sdk/server only in the backend. The Backend Key already exists as
JOY8_BACKEND_KEY in the backend secret environment. Do not print, read back,
copy, commit or send its value. Do not put any Joy8 credential in a URL or
browser storage. Do not add a Local/free-play fallback when Joy8 initialization
fails.

The game owns its authoritative state, match references, operation keys and
results. Joy8 owns identity, the shared POINT wallet, reservations and financial
settlement. Implement the integration, run the game repository's required tests,
complete the acceptance checklist with evidence, and report any platform-side
configuration that remains missing. Do not publish the game or change Joy8
configuration.
```

The provider must replace the example profile with the reviewed non-secret
`integration-profile.json`. Credential delivery remains a separate secure
operator action.
