export interface Joy8Session {
  readonly version: 1
  readonly sessionId: string
  readonly gameId: string
  readonly playerAccountRef: string
  readonly accountType: "registered"
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
  readonly availableBalance: string | null
  readonly availableBalances: Readonly<Record<string, string>> | null
  readonly settlement: Joy8Settlement | null
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
  readonly availableBalance: string | null
  readonly availableBalances: Readonly<Record<string, string>> | null
}

export interface Joy8MatchStatus {
  readonly version: 1
  readonly matchId: string
  readonly state: "open" | "settled" | "cancelled"
  readonly result: Record<string, unknown> | null
  readonly settlementCount: number
}

export interface Joy8ReserveOperation {
  readonly version: 1
  readonly matchId: string
  readonly state: "open" | "settled" | "cancelled"
  readonly operationKey: string
  readonly operationState: "applied" | "cancelled" | "not_found"
  readonly amount: string | null
  readonly reserve: string | null
  readonly availableBalance: string | null
  readonly availableBalances: Readonly<Record<string, string>> | null
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
    settlement?: {
      operationKey: string
      final: boolean
      entries: Joy8SettlementEntry[]
      productCommit?: Record<string, unknown>
    }
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
  increaseReserve(request: {
    matchRef: string
    operationKey: string
    accountRef: string
    amount: string
  }): Promise<Joy8ReserveOperation>
  cancelReserve(request: { matchRef: string; operationKey: string }): Promise<Joy8ReserveOperation>
  getReserveStatus(request: { matchRef: string; operationKey: string }): Promise<Joy8ReserveOperation>
}
