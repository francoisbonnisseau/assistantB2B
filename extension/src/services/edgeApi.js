import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config'

function assertEnv() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  }
}

async function callEdge(path, { method = 'POST', body, accessToken } = {}) {
  assertEnv()

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error ?? 'Edge function error')
  }

  return payload
}

export function loginClient(username, password) {
  return callEdge('client-login', {
    body: { username, password },
  })
}

export function fetchClientConfig(accessToken) {
  return callEdge('client-config', {
    accessToken,
  })
}
