import bcrypt from 'bcryptjs'
import { supabase } from './supabaseClient'
import { cleanMetadata } from '../utils/validators'

const SALT_ROUNDS = 10

async function hashPassword(rawPassword) {
  return bcrypt.hash(rawPassword, SALT_ROUNDS)
}

export async function listClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('id, username, is_active, metadata, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function getClientById(clientId) {
  const { data, error } = await supabase
    .from('clients')
    .select('id, username, is_active, metadata, created_at, updated_at')
    .eq('id', clientId)
    .single()

  if (error) throw error
  return data
}

export async function createClient({ username, password, isActive = true, metadata = {} }) {
  const passwordHash = await hashPassword(password)

  const { data, error } = await supabase
    .from('clients')
    .insert({
      username: username.trim(),
      password_hash: passwordHash,
      is_active: isActive,
      metadata: cleanMetadata(metadata),
    })
    .select('id, username, is_active, metadata, created_at, updated_at')
    .single()

  if (error) throw error
  return data
}

export async function updateClient(clientId, { username, password, isActive, metadata }) {
  const payload = {
    username: username.trim(),
    is_active: isActive,
    metadata: cleanMetadata(metadata),
  }

  if (password?.trim()) {
    payload.password_hash = await hashPassword(password)
  }

  const { data, error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', clientId)
    .select('id, username, is_active, metadata, created_at, updated_at')
    .single()

  if (error) throw error
  return data
}

export async function deleteClient(clientId) {
  const { error } = await supabase.from('clients').delete().eq('id', clientId)
  if (error) throw error
}
