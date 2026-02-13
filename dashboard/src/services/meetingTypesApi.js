import { supabase } from './supabaseClient'

export async function listMeetingTypes() {
  const { data, error } = await supabase
    .from('meeting_types')
    .select('id, code, label, is_active, created_at')
    .order('label', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function createMeetingType({ code, label, isActive = true }) {
  const { data, error } = await supabase
    .from('meeting_types')
    .insert({ code: code.trim(), label: label.trim(), is_active: isActive })
    .select('id, code, label, is_active, created_at')
    .single()

  if (error) throw error
  return data
}

export async function updateMeetingType(meetingTypeId, { code, label, isActive }) {
  const { data, error } = await supabase
    .from('meeting_types')
    .update({ code: code.trim(), label: label.trim(), is_active: isActive })
    .eq('id', meetingTypeId)
    .select('id, code, label, is_active, created_at')
    .single()

  if (error) throw error
  return data
}

export async function deleteMeetingType(meetingTypeId) {
  const { error } = await supabase.from('meeting_types').delete().eq('id', meetingTypeId)
  if (error) throw error
}
