const SESSION_KEY = 'b2b_session'

export function getStoredSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SESSION_KEY], (result) => {
      resolve(result[SESSION_KEY] ?? null)
    })
  })
}

export function saveSession(session) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SESSION_KEY]: session }, () => resolve())
  })
}

export function clearSession() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([SESSION_KEY], () => resolve())
  })
}
