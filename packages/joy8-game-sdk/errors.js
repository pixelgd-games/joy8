export class Joy8SdkError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = "Joy8SdkError"
    this.code = code
  }
}

export class Joy8ApiError extends Joy8SdkError {
  constructor(code, message, { status, requestId = null, retryAfterSeconds = null } = {}) {
    super(code, message)
    this.name = "Joy8ApiError"
    this.status = status
    this.requestId = requestId
    this.retryAfterSeconds = retryAfterSeconds
  }
}
