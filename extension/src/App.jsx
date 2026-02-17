import { useEffect, useMemo, useState } from 'react'
import { loginClient, fetchClientConfig } from './services/edgeApi'
import { getStoredSession, saveSession, clearSession } from './services/storage'

function App() {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [config, setConfig] = useState(null)
  const [selectedMeetingTypeId, setSelectedMeetingTypeId] = useState('')
  const [runtimeState, setRuntimeState] = useState({ status: 'idle', activeTabId: null })

  const [credentials, setCredentials] = useState({ username: '', password: '' })

  useEffect(() => {
    const bootstrap = async () => {
      const storedSession = await getStoredSession()

      if (!storedSession?.accessToken) {
        setLoading(false)
        return
      }

      try {
        const nextConfig = await fetchClientConfig(storedSession.accessToken)
        setSession(storedSession)
        setConfig(nextConfig)
        setSelectedMeetingTypeId(nextConfig.meetingTypes[0]?.id ?? '')
      } catch {
        await clearSession()
      }

      chrome.runtime.sendMessage({ type: 'GET_RUNTIME_STATE' }, (response) => {
        if (response?.ok) {
          setRuntimeState(response.state)
        }
      })

      setLoading(false)
    }

    bootstrap()
  }, [])

  const selectedMeetingType = useMemo(() => {
    if (!config?.meetingTypes?.length) return null
    return config.meetingTypes.find((item) => item.id === selectedMeetingTypeId) ?? config.meetingTypes[0]
  }, [config, selectedMeetingTypeId])

  const handleLogin = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const auth = await loginClient(credentials.username.trim(), credentials.password)
      const nextSession = {
        accessToken: auth.access_token,
        expiresAt: auth.expires_at,
        clientId: auth.client_id,
      }
      const nextConfig = await fetchClientConfig(auth.access_token)

      await saveSession(nextSession)
      setSession(nextSession)
      setConfig(nextConfig)
      setSelectedMeetingTypeId(nextConfig.meetingTypes[0]?.id ?? '')
      setCredentials({ username: '', password: '' })
    } catch (loginError) {
      setError(loginError.message ?? 'Connexion impossible.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLogout = async () => {
    await clearSession()
    setSession(null)
    setConfig(null)
    setSelectedMeetingTypeId('')
    chrome.runtime.sendMessage({ type: 'STOP_COACHING' })
  }

  const startCoaching = () => {
    if (!session?.accessToken || !selectedMeetingType) return

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs?.[0]
      chrome.runtime.sendMessage(
        {
          type: 'START_COACHING',
          payload: {
            accessToken: session.accessToken,
            tabId: tab?.id,
            tabUrl: tab?.url,
            meetingType: {
              id: selectedMeetingType.id,
              code: selectedMeetingType.code,
              label: selectedMeetingType.label,
              prompt: selectedMeetingType.prompt,
            },
            description: config?.description ?? '',
          },
        },
        (response) => {
          if (response?.ok) {
            setRuntimeState(response.state)
            return
          }

          if (response?.error) {
            setError(response.error)
          }
        },
      )
    })
  }

  const stopCoaching = () => {
    chrome.runtime.sendMessage({ type: 'STOP_COACHING' }, (response) => {
      if (response?.ok) {
        setRuntimeState(response.state)
      }
    })
  }

  const openMicrophonePermissionPage = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('microphone-permission.html') })
  }

  if (loading) {
    return <PopupShell title="B2B Realtime Coach">Chargement...</PopupShell>
  }

  if (!session || !config) {
    return (
      <PopupShell title="Connexion client">
        <form className="panel form" onSubmit={handleLogin}>
          <label>
            Username
            <input
              value={credentials.username}
              onChange={(event) => setCredentials((prev) => ({ ...prev, username: event.target.value }))}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials((prev) => ({ ...prev, password: event.target.value }))}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </PopupShell>
    )
  }

  return (
    <PopupShell title="Session coaching">
      <div className="panel stack">
        <p className="muted">Client: {config.clientName || config.username}</p>
        <label>
          Type de meeting
          <select value={selectedMeetingTypeId} onChange={(event) => setSelectedMeetingTypeId(event.target.value)}>
            {config.meetingTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">Etat: {runtimeState.status}</p>
        {error ? <p className="error">{error}</p> : null}
        <div className="actions">
          <button type="button" onClick={startCoaching} disabled={runtimeState.status === 'running'}>
            Demarrer
          </button>
          <button type="button" className="secondary" onClick={stopCoaching}>
            Stop
          </button>
        </div>
        <button type="button" className="secondary" onClick={openMicrophonePermissionPage}>
          Autoriser micro
        </button>
        <button type="button" className="link" onClick={handleLogout}>
          Se deconnecter
        </button>
      </div>
    </PopupShell>
  )
}

function PopupShell({ title, children }) {
  return (
    <main className="popup-root">
      <header>
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  )
}

export default App
