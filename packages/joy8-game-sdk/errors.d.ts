export class Joy8SdkError extends Error {
  readonly code: string
}

export class Joy8ApiError extends Joy8SdkError {
  readonly status?: number
  readonly requestId: string | null
  readonly retryAfterSeconds: number | null
}
