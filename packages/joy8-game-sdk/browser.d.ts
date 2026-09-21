export interface Joy8Launch {
  readonly joy8_session_id: string
  readonly joy8_launch_code: string
  readonly joy8_game_id: string
  readonly joy8_currency: "POINT"
  readonly joy8_protocol: "server-v1"
  readonly joy8_gateway_url: string
}

export interface ReceiveJoy8LaunchOptions {
  parentOrigins: string[]
  expectedGameId: string
  gatewayUrl: string
  timeoutMs?: number
  signal?: AbortSignal
  windowObject?: Window
  locationHref?: string
}

export interface Joy8Balance {
  readonly sessionId: string
  readonly playerAccountRef: string
  readonly currency: "POINT"
  readonly balance: string
  readonly lockedBalance: string
}

export function receiveJoy8Launch(options: ReceiveJoy8LaunchOptions): Promise<Joy8Launch>
export function getJoy8Balance(options: {
  gatewayUrl: string
  gatewayToken: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}): Promise<Joy8Balance>
