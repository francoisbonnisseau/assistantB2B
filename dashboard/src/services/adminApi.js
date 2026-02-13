import { supabase } from './supabaseClient'

export async function isUserAdmin(userId) {
  if (!userId) return false

  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return false
  return Boolean(data)
}
