import { SUPABASE_URL, ANON_KEY, AUTH_REQUEST_TIMEOUT_MS } from "./config.ts"

type AuthResult =
  | { ok: true; userId: string | null }
  | { ok: false; error: string; status: number }

export async function resolveAuthUser(request: Request): Promise<AuthResult> {
  const authorization = request.headers.get("authorization")?.trim() ?? ""
  const apiKey = request.headers.get("apikey")?.trim() ?? ""

  if (!authorization) {
    return { ok: true, userId: null }
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    return { ok: false, error: "Invalid authorization header", status: 401 }
  }

  const token = match[1].trim()

  if (!token || token === ANON_KEY || (apiKey && token === apiKey)) {
    return { ok: true, userId: null }
  }

  if (!SUPABASE_URL || !ANON_KEY) {
    return { ok: false, error: "Gateway authentication is not configured", status: 500 }
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      return { ok: false, error: "User session is not valid", status: 401 }
    }

    const user = await response.json()
    const userId = user && typeof user === "object" && "id" in user && typeof user.id === "string"
      ? user.id
      : ""

    if (!userId) {
      return { ok: false, error: "User session is not valid", status: 401 }
    }

    return { ok: true, userId }
  } catch {
    return { ok: false, error: "Gateway authentication is unavailable", status: 503 }
  }
}
