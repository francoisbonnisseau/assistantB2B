import { createClient } from 'npm:@supabase/supabase-js@2.49.8'
import bcrypt from 'npm:bcryptjs@2.4.3'
import { SignJWT } from 'npm:jose@5.9.6'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { username, password } = await request.json()
    if (!username || !password) {
      return json({ error: 'username and password are required' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const jwtSecret = Deno.env.get('CLIENT_JWT_SECRET')

    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return json({ error: 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or CLIENT_JWT_SECRET' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: client, error } = await supabase
      .from('clients')
      .select('id, username, password_hash, is_active')
      .eq('username', username)
      .maybeSingle()

    if (error || !client || !client.is_active) {
      return json({ error: 'Invalid credentials' }, 401)
    }

    const isValidPassword = bcrypt.compareSync(password, client.password_hash)
    if (!isValidPassword) {
      return json({ error: 'Invalid credentials' }, 401)
    }

    const expiresInSeconds = 60 * 60 * 24 * 7
    const secret = new TextEncoder().encode(jwtSecret)
    const token = await new SignJWT({ sub: client.id, username: client.username })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .sign(secret)

    return json({
      access_token: token,
      token_type: 'bearer',
      expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      client_id: client.id,
    })
  } catch (error) {
    return json({ error: error.message ?? 'Unexpected error' }, 500)
  }
})

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
