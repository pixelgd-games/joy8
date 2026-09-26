import { postJson } from "./http.js"
import { Joy8SdkError } from "./errors.js"
import {
  BACKEND_KEY_PATTERN,
  CURRENCY,
  isRecord,
  normalizeGatewayUrl,
  requireAllowedKeys,
  requireAmount,
  requireExactKeys,
  requireRecord,
  requireText,
  requireUuid,
} from "./validation.js"

const MATCH_STATES = ["open", "settled", "cancelled"]

export class Joy8ServerClient {
  #backendKey
  #fetch
  #gameId
  #gatewayUrl
  #timeoutMs

  constructor({ gatewayUrl, backendKey, gameId, timeoutMs = 8000, fetch: fetchImpl = globalThis.fetch } = {}) {
    this.#gatewayUrl = normalizeGatewayUrl(gatewayUrl)
    if (typeof backendKey !== "string" || !BACKEND_KEY_PATTERN.test(backendKey)) {
      throw new Joy8SdkError("JOY8_SDK_INVALID_CONFIGURATION", "backendKey must be a 64-character lowercase hexadecimal secret")
    }
    this.#backendKey = backendKey
    this.#gameId = requireUuid(gameId, "gameId")
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
      throw new Joy8SdkError("JOY8_SDK_INVALID_CONFIGURATION", "timeoutMs must be from 1000 to 30000")
    }
    this.#timeoutMs = timeoutMs
    this.#fetch = fetchImpl
  }

  async exchangeLaunchCode({ launchCode } = {}) {
    requireText(launchCode, "launchCode", 64, 64)
    if (!BACKEND_KEY_PATTERN.test(launchCode)) throw new Joy8SdkError("JOY8_SDK_INVALID_ARGUMENT", "launchCode is invalid")
    const payload = await this.#request("server-exchange-v1", { version: 1, launch_code: launchCode })
    return sessionResponse(payload, this.#gameId)
  }

  async renewSession({ sessionId } = {}) {
    requireUuid(sessionId, "sessionId")
    const payload = await this.#request("server-renew-v1", { version: 1, session_id: sessionId })
    return sessionResponse(payload, this.#gameId)
  }

  async openMatch({ matchRef, ruleVersion, participants, productParticipants, settlement } = {}) {
    requireText(matchRef, "matchRef", 1, 120)
    requireText(ruleVersion, "ruleVersion", 1, 80)
    if (!Array.isArray(participants) || participants.length < 1 || participants.length > 64) {
      throw new Joy8SdkError("JOY8_SDK_INVALID_ARGUMENT", "participants must contain from 1 to 64 players")
    }
    const body = {
      version: 1,
      match_ref: matchRef,
      rule_version: ruleVersion,
      participants: participants.map((item, index) => {
        requireExactKeys(item, ["sessionId", "reserve"], `participants[${index}]`)
        return { session_id: requireUuid(item.sessionId, `participants[${index}].sessionId`), reserve: requireAmount(item.reserve, `participants[${index}].reserve`, { positive: true }) }
      }),
    }
    if (productParticipants !== undefined) {
      if (!Array.isArray(productParticipants) || productParticipants.length > 64) throw new Joy8SdkError("JOY8_SDK_INVALID_ARGUMENT", "productParticipants is invalid")
      body.product_participants = productParticipants.map((item, index) => {
        requireExactKeys(item, ["accountRef", "reserve"], `productParticipants[${index}]`)
        return { account_ref: requireText(item.accountRef, `productParticipants[${index}].accountRef`, 1, 120), reserve: requireAmount(item.reserve, `productParticipants[${index}].reserve`, { positive: true }) }
      })
    }
    if (settlement !== undefined) {
      requireAllowedKeys(settlement, ["operationKey", "final", "entries", "productCommit"], ["operationKey", "final", "entries"], "settlement")
      body.settlement = settlementFields({ ...settlement, settlementNo: 1 }, this.#gameId, true)
    }
    return matchResponse(await this.#request("server-open-v1", body))
  }

  async settleMatch({ matchRef, ruleVersion, operationKey, settlementNo, final, entries, productCommit } = {}) {
    requireText(matchRef, "matchRef", 1, 120)
    requireText(ruleVersion, "ruleVersion", 1, 80)
    const body = {
      version: 1,
      match_ref: matchRef,
      rule_version: ruleVersion,
      ...settlementFields({ operationKey, settlementNo, final, entries, productCommit }, this.#gameId, false),
    }
    return settlementResponse(await this.#request("server-settle-v1", body))
  }

  async getMatchStatus({ matchRef } = {}) {
    return statusResponse(await this.#status("server-status-v1", matchRef))
  }

  async cancelMatch({ matchRef } = {}) {
    return statusResponse(await this.#status("server-cancel-v1", matchRef))
  }

  async #status(route, matchRef) {
    requireText(matchRef, "matchRef", 1, 120)
    return this.#request(route, { version: 1, match_ref: matchRef })
  }

  #request(route, body) {
    return postJson({
      fetchImpl: this.#fetch,
      url: `${this.#gatewayUrl}/${route}`,
      headers: { Authorization: `Bearer ${this.#backendKey}` },
      body,
      timeoutMs: this.#timeoutMs,
    })
  }
}

function settlementFields({ operationKey, settlementNo, final, entries, productCommit }, gameId, embedded) {
  requireText(operationKey, "operationKey", 1, 180)
  if (!Number.isInteger(settlementNo) || settlementNo < 1 || settlementNo > 999999999 || typeof final !== "boolean") {
    throw new Joy8SdkError("JOY8_SDK_INVALID_ARGUMENT", "settlementNo or final is invalid")
  }
  if (!Array.isArray(entries) || entries.length > 65) throw new Joy8SdkError("JOY8_SDK_INVALID_ARGUMENT", "entries is invalid")
  const result = {
    operation_key: operationKey,
    final,
    entries: entries.map((item, index) => {
      requireExactKeys(item, ["kind", "accountRef", "amount", "source"], `entries[${index}]`)
      if (!["player", "product", "fee"].includes(item.kind)
        || (item.kind === "fee" ? item.source !== "fee" : item.source !== "gameplay")) {
        throw new Joy8SdkError("JOY8_SDK_INVALID_ARGUMENT", `entries[${index}] has invalid kind or source`)
      }
      const accountRef = item.kind === "product"
        ? requireText(item.accountRef, `entries[${index}].accountRef`, 1, 120)
        : requireUuid(item.accountRef, `entries[${index}].accountRef`)
      if (item.kind === "fee" && accountRef !== gameId) {
        throw new Joy8SdkError("JOY8_SDK_INVALID_ARGUMENT", `entries[${index}] fee account must match the configured Game ID`)
      }
      const amount = requireAmount(item.amount, `entries[${index}].amount`, { nonzero: true })
      if (item.kind === "fee" && amount.startsWith("-")) {
        throw new Joy8SdkError("JOY8_SDK_INVALID_ARGUMENT", `entries[${index}] fee amount must be positive`)
      }
      return { kind: item.kind, account_ref: accountRef, amount, source: item.source }
    }),
  }
  if (!embedded) result.settlement_no = settlementNo
  if (productCommit !== undefined) {
    requireRecord(productCommit, "productCommit")
    result.product_commit = productCommit
  }
  return result
}

function sessionResponse(payload, expectedGameId) {
  return validateResponse("session", () => {
    requireAllowedKeys(payload, ["version", "session_id", "game_id", "player_account_ref", "account_type", "wallet_scope", "currency", "gateway_token", "gateway_token_expires_at", "expires_at", "scopes"], ["version", "session_id", "game_id", "player_account_ref", "account_type", "wallet_scope", "currency", "gateway_token", "gateway_token_expires_at", "expires_at", "scopes"], "session response")
    if (payload.version !== 1 || requireUuid(payload.game_id, "game_id") !== expectedGameId
      || !["guest", "registered"].includes(payload.account_type)
      || payload.wallet_scope !== "platform" || payload.currency !== CURRENCY
      || !Array.isArray(payload.scopes) || payload.scopes.length !== 1 || payload.scopes[0] !== "balance") {
      throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 session response does not match trusted configuration")
    }
    return Object.freeze({
      version: 1,
      sessionId: requireUuid(payload.session_id, "session_id"),
      gameId: payload.game_id,
      playerAccountRef: requireUuid(payload.player_account_ref, "player_account_ref"),
      accountType: payload.account_type,
      walletScope: payload.wallet_scope,
      currency: payload.currency,
      gatewayToken: requireText(payload.gateway_token, "gateway_token", 1, 256),
      gatewayTokenExpiresAt: requireText(payload.gateway_token_expires_at, "gateway_token_expires_at", 1, 80),
      expiresAt: requireText(payload.expires_at, "expires_at", 1, 80),
      scopes: Object.freeze([...payload.scopes]),
    })
  })
}

function matchResponse(payload) {
  return validateResponse("match", () => {
    requireAllowedKeys(payload, ["version", "match_id", "state", "available_balance", "available_balances", "settlement"], ["version", "match_id", "state"], "match response")
    if (payload.version !== 1 || !MATCH_STATES.includes(payload.state)) throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 match response is invalid")
    const balance = balanceResponse(payload)
    return Object.freeze({ version: 1, matchId: requireUuid(payload.match_id, "match_id"), state: payload.state,
      ...balance, settlement: payload.settlement === undefined ? null : settlementResponse(payload.settlement) })
  })
}

function settlementResponse(payload) {
  return validateResponse("settlement", () => {
    requireAllowedKeys(payload, ["version", "settlement_id", "match_id", "state", "settlement_no", "final", "request_hash", "settled_at", "available_balance", "available_balances"], ["version", "settlement_id", "match_id", "state", "settlement_no", "final", "request_hash", "settled_at"], "settlement response")
    if (payload.version !== 1 || !["open", "settled"].includes(payload.state) || !Number.isInteger(payload.settlement_no) || typeof payload.final !== "boolean") {
      throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 settlement response is invalid")
    }
    return Object.freeze({
      version: 1,
      settlementId: requireUuid(payload.settlement_id, "settlement_id"),
      matchId: requireUuid(payload.match_id, "match_id"),
      state: payload.state,
      settlementNo: payload.settlement_no,
      final: payload.final,
      requestHash: requireText(payload.request_hash, "request_hash", 64, 64),
      settledAt: requireText(payload.settled_at, "settled_at", 1, 80),
      ...balanceResponse(payload),
    })
  })
}

function balanceResponse(payload) {
  if (Object.hasOwn(payload, "available_balance") && Object.hasOwn(payload, "available_balances")) {
    throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 balance response is ambiguous")
  }
  let availableBalance = null
  let availableBalances = null
  if (Object.hasOwn(payload, "available_balance")) {
    availableBalance = exactBalance(payload.available_balance)
  }
  if (Object.hasOwn(payload, "available_balances")) {
    requireRecord(payload.available_balances, "available_balances")
    availableBalances = Object.freeze(Object.fromEntries(Object.entries(payload.available_balances).map(([player, amount]) => [
      requireUuid(player, "available_balances player"), exactBalance(amount),
    ])))
  }
  return { availableBalance, availableBalances }
}

function exactBalance(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/.test(value)) {
    throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 available balance is invalid")
  }
  return value
}

function statusResponse(payload) {
  return validateResponse("status", () => {
    requireAllowedKeys(payload, ["version", "match_id", "state", "result", "settlement_count"], ["version", "match_id", "state", "result", "settlement_count"], "status response")
    if (payload.version !== 1 || !MATCH_STATES.includes(payload.state) || !Number.isInteger(payload.settlement_count)
      || payload.settlement_count < 0 || (payload.result !== null && !isRecord(payload.result))) {
      throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 status response is invalid")
    }
    return Object.freeze({ version: 1, matchId: requireUuid(payload.match_id, "match_id"), state: payload.state, result: payload.result, settlementCount: payload.settlement_count })
  })
}

function validateResponse(name, validation) {
  try {
    return validation()
  } catch (error) {
    if (error instanceof Joy8SdkError && error.code === "JOY8_SDK_INVALID_ARGUMENT") {
      throw new Joy8SdkError("JOY8_INVALID_RESPONSE", `Joy8 ${name} response is invalid`)
    }
    throw error
  }
}
