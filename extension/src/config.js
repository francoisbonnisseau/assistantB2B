export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL

export const ALLOWED_HOST_PATTERNS = [
  'meet.google.com',
  '.zoom.us',
  'teams.microsoft.com',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]

export function isAllowedMeetingUrl(url = '') {
  try {
    const parsed = new URL(url)
    return ALLOWED_HOST_PATTERNS.some((pattern) =>
      pattern.startsWith('.') ? parsed.hostname.endsWith(pattern) : parsed.hostname === pattern,
    )
  } catch {
    return false
  }
}
