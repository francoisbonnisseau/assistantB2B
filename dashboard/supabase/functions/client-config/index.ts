import { createClient } from 'npm:@supabase/supabase-js@2.49.8'
import { jwtVerify } from 'npm:jose@5.9.6'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = request.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()

    if (!token) {
      return json({ error: 'Missing bearer token' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const jwtSecret = Deno.env.get('CLIENT_JWT_SECRET')
    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return json({ error: 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or CLIENT_JWT_SECRET' }, 500)
    }

    const secret = new TextEncoder().encode(jwtSecret)
    const verified = await jwtVerify(token, secret)
    const clientId = verified.payload.sub

    if (!clientId) {
      return json({ error: 'Invalid token' }, 401)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, username, is_active, metadata')
      .eq('id', clientId)
      .single()

    if (clientError || !client || !client.is_active) {
      return json({ error: 'Client not found or inactive' }, 404)
    }

    const { data: promptRows, error: promptError } = await supabase
      .from('client_prompts')
      .select('id, prompt, meeting_type_id, meeting_types(id, code, label, is_active)')
      .eq('client_id', client.id)

    if (promptError) {
      return json({ error: promptError.message }, 500)
    }

    const meetingTypes = (promptRows ?? [])
      .filter((row) => row.meeting_types && row.meeting_types.is_active)
      .map((row) => ({
        id: row.meeting_types.id,
        code: row.meeting_types.code,
        label: row.meeting_types.label,
        prompt: row.prompt,
      }))

    return json({
      username: client.username,
      clientName: client.metadata?.name ?? '',
      description: client.metadata?.description ?? '',
      meetingTypes,
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
