export interface Joy8Session {
  readonly version: 1
  readonly sessionId: string
  readonly gameId: string
  readonly playerAccountRef: string
  readonly accountType: string
  readonly walletScope: "platform"
  readonly currency: "POINT"
  readonly gatewayToken: string
  readonly gatewayTokenExpiresAt: string
  readonly expiresAt: string
  readonly scopes: readonly ["balance"]
}

export interface Joy8Match {
  readonly version: 1
  readonly matchId: string
  readonly state: "open" | "settled" | "cancelled"
}

export interface Joy8Settlement {
  readonly version: 1
  readonly settlementId: string
  readonly matchId: string
  readonly state: "open" | "settled"
  readonly settlementNo: number
  readonly final: boolean
  readonly requestHash: string
  readonly settledAt: string
}

export interface Joy8MatchStatus {
  readonly version: 1
  readonly matchId: string
  readonly state: "open" | "settled" | "cancelled"
  readonly result: Record<string, unknown> | null
  readonly settlementCount: number
}

export type Joy8SettlementEntry = {
  kind: "player" | "product" | "fee"
  accountRef: string
  amount: string
  source: "gameplay" | "fee"
}

export class Joy8ServerClient {
  constructor(options: {
    gatewayUrl: string
    backendKey: string
    gameId: string
    timeoutMs?: number
    fetch?: typeof globalThis.fetch
  })
  exchangeLaunchCode(request: { launchCode: string }): Promise<Joy8Session>
  renewSession(request: { sessionId: string }): Promise<Joy8Session>
  openMatch(request: {
    matchRef: string
    ruleVersion: string
    participants: Array<{ sessionId: string; reserve: string }>
    productParticipants?: Array<{ accountRef: string; reserve: string }>
  }): Promise<Joy8Match>
  settleMatch(request: {
    matchRef: string
    ruleVersion: string
    operationKey: string
    settlementNo: number
    final: boolean
    entries: Joy8SettlementEntry[]
    productCommit?: Record<string, unknown>
  }): Promise<Joy8Settlement>
  getMatchStatus(request: { matchRef: string }): Promise<Joy8MatchStatus>
  cancelMatch(request: { matchRef: string }): Promise<Joy8MatchStatus>
}
