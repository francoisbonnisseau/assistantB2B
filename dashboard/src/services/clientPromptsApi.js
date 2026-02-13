import { supabase } from './supabaseClient'

export async function listClientPrompts(clientId) {
  const { data, error } = await supabase
    .from('client_prompts')
    .select('id, prompt, updated_at, meeting_type_id, meeting_types(id, code, label, is_active)')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function createClientPrompt({ clientId, meetingTypeId, prompt }) {
  const { data, error } = await supabase
    .from('client_prompts')
    .insert({
      client_id: clientId,
      meeting_type_id: meetingTypeId,
      prompt: prompt.trim(),
    })
    .select('id, prompt, updated_at, meeting_type_id, meeting_types(id, code, label, is_active)')
    .single()

  if (error) throw error
  return data
}

export async function updateClientPrompt(promptId, prompt) {
  const { data, error } = await supabase
    .from('client_prompts')
    .update({ prompt: prompt.trim() })
    .eq('id', promptId)
    .select('id, prompt, updated_at, meeting_type_id, meeting_types(id, code, label, is_active)')
    .single()

  if (error) throw error
  return data
}

export async function deleteClientPrompt(promptId) {
  const { error } = await supabase.from('client_prompts').delete().eq('id', promptId)
  if (error) throw error
}
