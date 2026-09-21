# Joy8 Integration Acceptance

Every item is required unless Joy8 marks it not applicable in the reviewed game
profile. Passing local tests does not activate a public game.

## Credential and build boundary

- [ ] The Browser SDK is installed before the game runtime starts.
- [ ] The build accepts launch data only from `window.parent` and exact approved Joy8 origins.
- [ ] URL credentials and unknown launch fields fail closed.
- [ ] Joy8 initialization failure never activates a Local/free-play client.
- [ ] The Backend Key exists only in the provider backend secret manager.
- [ ] Browser bundles, source maps, repositories, logs and analytics contain no Backend Key.
- [ ] A Joy8 build initializes no competing platform SDK.

## Session and identity

- [ ] Only the provider backend exchanges the one-use launch code.
- [ ] The exchanged Game ID matches trusted configuration.
- [ ] The trusted `playerAccountRef` is the only player mapping key.
- [ ] Launch codes and Gateway tokens stay in memory and are never logged or persisted.
- [ ] Renewal is serialized and the previous Gateway token is discarded.
- [ ] Re-entry maps a new Joy8 session to existing authoritative game state.

## Financial operation

- [ ] Match references and operation keys come from durable backend state.
- [ ] Opening reserves the maximum authorized player loss and respects the reviewed bet limit.
- [ ] Settlement uses decimal strings, the approved rule version and authoritative results.
- [ ] Platform-funded games never submit a `platform` settlement entry.
- [ ] Participant-funded games balance human/product/fee entries exactly and use the reviewed adapter.
- [ ] Continuous settlement increments `settlementNo` and marks only the final posting `final:true`.
- [ ] Exact retries preserve the same operation key and byte-equivalent logical request.
- [ ] The backend never performs blind automatic financial retries with a new key.

## Recovery

- [ ] A timeout triggers status lookup before another action.
- [ ] Restart recovery resumes from durable match and settlement state.
- [ ] A repeated exchange never falls back to URL credentials or local identity.
- [ ] Cancellation occurs only after the authoritative game marks the unfinished match void.
- [ ] Completed settlements are never corrected by editing Joy8 history.
- [ ] 429 handling honors `Retry-After` while preserving idempotency.

## Joint private acceptance

- [ ] Valid launch and one-time exchange.
- [ ] Wrong origin, wrong Game ID and wrong/revoked/expired key rejection.
- [ ] Maximum valid bet and over-limit bet rejection.
- [ ] Player loss, player win, zero-change result and payout-limit rejection.
- [ ] Exact duplicate settlement returns the saved response without a duplicate ledger entry.
- [ ] Changed duplicate and out-of-order settlement rejection.
- [ ] Status recovery after a simulated timeout.
- [ ] Final settlement and cancellation release reservations correctly.
- [ ] Browser refresh, backend restart and expired session behavior.
- [ ] Joy8 reconciliation has no reservation or settlement imbalance.

## Release evidence

- [ ] Final Game URL, Backend URL, parent origins and rule version recorded.
- [ ] SDK version and build commit recorded.
- [ ] Backend Key scope and expiry reviewed; obsolete keys revoked.
- [ ] Game policy and private/public entry state explicitly approved.
- [ ] Joy8 and provider owners sign off before public release.
