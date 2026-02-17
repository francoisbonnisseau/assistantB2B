import { useEffect, useMemo, useRef, useState } from 'react'
import { loginClient, fetchClientConfig } from './services/edgeApi'
import { getStoredSession, saveSession, clearSession } from './services/storage'

const LOG_PREFIX = '[B2B SidePanel]'
const log = (...args) => console.log(LOG_PREFIX, ...args)
const logError = (...args) => console.error(LOG_PREFIX, ...args)

const TARGET_SAMPLE_RATE = 16000
const SAMPLES_PER_CHUNK = 2048

export default function SidePanel() {
  // --- Auth state ---
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [config, setConfig] = useState(null)
  const [selectedMeetingTypeId, setSelectedMeetingTypeId] = useState('')
  const [credentials, setCredentials] = useState({ username: '', password: '' })

  // --- Coaching state ---
  const [coachingStatus, setCoachingStatus] = useState('idle') // idle | running | error
  const [insights, setInsights] = useState(null)
  const [transcripts, setTranscripts] = useState([])

  // --- Tab capture refs ---
  const tabStreamRef = useRef(null)
  const audioContextRef = useRef(null)
  const sourceNodeRef = useRef(null)
  const processorNodeRef = useRef(null)
  const audioPlaybackRef = useRef(null)
  const sampleBufferRef = useRef(new Float32Array(0))
  const chunkCountRef = useRef(0)
  const totalSamplesRef = useRef(0)

  // Bootstrap session
  useEffect(() => {
    const bootstrap = async () => {
      const storedSession = await getStoredSession()
      if (storedSession?.accessToken) {
        try {
          const nextConfig = await fetchClientConfig(storedSession.accessToken)
          setSession(storedSession)
          setConfig(nextConfig)
          setSelectedMeetingTypeId(nextConfig.meetingTypes[0]?.id ?? '')
        } catch {
          await clearSession()
        }
      }
      setLoading(false)
    }
    bootstrap()
  }, [])

  // Listen for messages from background (insights, transcripts)
  useEffect(() => {
    const handler = (message, _sender, sendResponse) => {
      if (message.type === 'SIDEPANEL_INSIGHT_UPDATE') {
        setInsights(message.payload)
        sendResponse?.({ ok: true })
        return true
      }
      if (message.type === 'SIDEPANEL_TRANSCRIPT_UPDATE') {
        const t = message.payload
        setTranscripts((prev) => [...prev.slice(-50), t])
        sendResponse?.({ ok: true })
        return true
      }
      if (message.type === 'SIDEPANEL_COACHING_STOPPED') {
        stopTabCapture()
        setCoachingStatus('idle')
        sendResponse?.({ ok: true })
        return true
      }
      return false
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  const selectedMeetingType = useMemo(() => {
    if (!config?.meetingTypes?.length) return null
    return config.meetingTypes.find((item) => item.id === selectedMeetingTypeId) ?? config.meetingTypes[0]
  }, [config, selectedMeetingTypeId])

  // ============================================================
  // Auth handlers
  // ============================================================

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
    stopCoaching()
    await clearSession()
    setSession(null)
    setConfig(null)
    setSelectedMeetingTypeId('')
  }

  // ============================================================
  // Tab audio capture (runs directly in side panel)
  // ============================================================

  function startTabCapture() {
    if (!chrome.tabCapture) {
      logError('chrome.tabCapture not available')
      return
    }

    chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
      if (!stream) {
        logError('tabCapture.capture() returned null stream')
        setError('Impossible de capturer l\'audio de l\'onglet. Verifie que l\'onglet est actif.')
        return
      }

      tabStreamRef.current = stream
      const tracks = stream.getAudioTracks()
      log('Tab stream captured', { active: stream.active, tracks: tracks.length })
      tracks.forEach((track, i) => {
        const s = track.getSettings?.() || {}
        log(`Tab Track[${i}] sampleRate=${s.sampleRate} channelCount=${s.channelCount}`)
      })

      // Play back the captured audio so the user still hears it
      const audio = new Audio()
      audio.srcObject = stream
      audio.play().catch((e) => logError('Audio playback error', e))
      audioPlaybackRef.current = audio

      // Process audio through ScriptProcessorNode for transcription
      const ctx = new AudioContext()
      audioContextRef.current = ctx

      const sourceNode = ctx.createMediaStreamSource(stream)
      const processorNode = ctx.createScriptProcessor(4096, 1, 1)

      sampleBufferRef.current = new Float32Array(0)
      chunkCountRef.current = 0
      totalSamplesRef.current = 0

      processorNode.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0)

        const downsampled = downsample(inputData, event.inputBuffer.sampleRate, TARGET_SAMPLE_RATE)

        const prev = sampleBufferRef.current
        const newBuf = new Float32Array(prev.length + downsampled.length)
        newBuf.set(prev)
        newBuf.set(downsampled, prev.length)
        sampleBufferRef.current = newBuf

        while (sampleBufferRef.current.length >= SAMPLES_PER_CHUNK) {
          const toSend = sampleBufferRef.current.slice(0, SAMPLES_PER_CHUNK)
          sampleBufferRef.current = sampleBufferRef.current.slice(SAMPLES_PER_CHUNK)

          const int16 = float32ToInt16(toSend)
          const base64 = uint8ArrayToBase64(new Uint8Array(int16.buffer))

          chrome.runtime.sendMessage({
            type: 'SIDEPANEL_TAB_AUDIO_CHUNK',
            payload: { source: 'tab', chunk: base64, ts: Date.now() },
          })

          chunkCountRef.current += 1
          totalSamplesRef.current += SAMPLES_PER_CHUNK

          if (chunkCountRef.current % 50 === 0) {
            let maxAbs = 0
            for (let i = 0; i < toSend.length; i++) {
              const abs = Math.abs(toSend[i])
              if (abs > maxAbs) maxAbs = abs
            }
            const dur = (totalSamplesRef.current / TARGET_SAMPLE_RATE).toFixed(1)
            log(`[tab] Sent ${chunkCountRef.current} chunks (${dur}s), peak=${maxAbs.toFixed(6)}`)
          }
        }
      }

      sourceNode.connect(processorNode)
      processorNode.connect(ctx.destination)
      sourceNodeRef.current = sourceNode
      processorNodeRef.current = processorNode

      log('Tab audio capture active')
    })
  }

  function stopTabCapture() {
    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null
      processorNodeRef.current.disconnect()
      processorNodeRef.current = null
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect()
      sourceNodeRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause()
      audioPlaybackRef.current.srcObject = null
      audioPlaybackRef.current = null
    }
    if (tabStreamRef.current) {
      tabStreamRef.current.getTracks().forEach((track) => track.stop())
      tabStreamRef.current = null
    }
    sampleBufferRef.current = new Float32Array(0)
    chunkCountRef.current = 0
    totalSamplesRef.current = 0
  }

  // ============================================================
  // Coaching lifecycle
  // ============================================================

  const startCoaching = () => {
    if (!session?.accessToken || !selectedMeetingType) return
    setError('')
    setTranscripts([])
    setInsights(null)

    // Tell background to connect WS + start mic capture in offscreen
    chrome.runtime.sendMessage(
      {
        type: 'START_COACHING',
        payload: {
          accessToken: session.accessToken,
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
          setCoachingStatus('running')
          // Start tab capture directly in side panel
          startTabCapture()
        } else {
          setError(response?.error || 'Erreur au demarrage')
          setCoachingStatus('error')
        }
      },
    )
  }

  const stopCoaching = () => {
    stopTabCapture()
    chrome.runtime.sendMessage({ type: 'STOP_COACHING' })
    setCoachingStatus('idle')
  }

  // ============================================================
  // Render
  // ============================================================

  if (loading) {
    return <Shell>Chargement...</Shell>
  }

  if (!session || !config) {
    return (
      <Shell>
        <h2 className="section-title">Connexion</h2>
        <form className="panel form" onSubmit={handleLogin}>
          <label>
            Username
            <input
              value={credentials.username}
              onChange={(e) => setCredentials((p) => ({ ...p, username: e.target.value }))}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell>
      {/* Session header */}
      <div className="session-header">
        <span className="client-name">{config.clientName || config.username}</span>
        <button type="button" className="link" onClick={handleLogout}>Deconnexion</button>
      </div>

      {/* Controls */}
      <div className="panel stack">
        <label>
          Type de meeting
          <select value={selectedMeetingTypeId} onChange={(e) => setSelectedMeetingTypeId(e.target.value)}>
            {config.meetingTypes.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>

        <div className="status-line">
          <span className={`status-dot ${coachingStatus}`} />
          <span>{coachingStatus === 'running' ? 'En cours' : coachingStatus === 'error' ? 'Erreur' : 'Pret'}</span>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" onClick={startCoaching} disabled={coachingStatus === 'running'}>
            Demarrer
          </button>
          <button type="button" className="secondary" onClick={stopCoaching} disabled={coachingStatus !== 'running'}>
            Stop
          </button>
        </div>
      </div>

      {/* Coaching insights */}
      {coachingStatus === 'running' && (
        <>
          {/* Talk ratio */}
          {insights?.talkRatio && (
            <div className="panel">
              <h3 className="section-title">Talk ratio</h3>
              <div className="talk-ratio-bar">
                <div className="talk-ratio-seller" style={{ width: `${insights.talkRatio.seller}%` }}>
                  {insights.talkRatio.seller > 10 ? `Vendeur ${insights.talkRatio.seller}%` : ''}
                </div>
                <div className="talk-ratio-buyer" style={{ width: `${insights.talkRatio.buyer}%` }}>
                  {insights.talkRatio.buyer > 10 ? `Prospect ${insights.talkRatio.buyer}%` : ''}
                </div>
              </div>
            </div>
          )}

          {/* Suggestions */}
          {insights?.suggestions?.length > 0 && (
            <div className="panel">
              <h3 className="section-title">Suggestions</h3>
              <ul className="insight-list">
                {insights.suggestions.map((s, i) => <li key={i}><InsightItem item={s} /></li>)}
              </ul>
            </div>
          )}

          {/* Objections */}
          {insights?.objections?.length > 0 && (
            <div className="panel warning">
              <h3 className="section-title">Objections</h3>
              <ul className="insight-list">
                {insights.objections.map((o, i) => <li key={i}><InsightItem item={o} /></li>)}
              </ul>
            </div>
          )}

          {/* Battle Cards */}
          {insights?.battleCards?.length > 0 && (
            <div className="panel">
              <h3 className="section-title">Battle Cards</h3>
              <ul className="insight-list">
                {insights.battleCards.map((b, i) => <li key={i}><InsightItem item={b} /></li>)}
              </ul>
            </div>
          )}

          {/* Missing signals */}
          {insights?.missingSignals?.length > 0 && (
            <div className="panel warning">
              <h3 className="section-title">Signaux manquants</h3>
              <ul className="insight-list">
                {insights.missingSignals.map((m, i) => <li key={i}><InsightItem item={m} /></li>)}
              </ul>
            </div>
          )}

          {/* Next step alerts */}
          {insights?.nextStepAlerts?.length > 0 && (
            <div className="panel alert">
              <h3 className="section-title">Next Steps</h3>
              <ul className="insight-list">
                {insights.nextStepAlerts.map((n, i) => <li key={i}><InsightItem item={n} /></li>)}
              </ul>
            </div>
          )}

          {/* Live transcript */}
          <div className="panel transcript-panel">
            <h3 className="section-title">Transcription live</h3>
            <div className="transcript-scroll">
              {transcripts.map((t, i) => (
                <p key={i} className={`transcript-line ${t.source}`}>
                  <span className="transcript-role">{t.source === 'mic' ? 'Vous' : 'Prospect'}</span>
                  {' '}{t.text}
                  {!t.isFinal && <span className="interim">...</span>}
                </p>
              ))}
            </div>
          </div>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <main className="sidepanel-root">
      <header className="sp-header">
        <h1>B2B Coach</h1>
      </header>
      <div className="sp-content">{children}</div>
    </main>
  )
}

/**
 * Safely render an insight item.
 * Groq may return plain strings OR objects like { title, keyPoints }.
 */
function InsightItem({ item }) {
  if (typeof item === 'string') return <>{item}</>
  if (item && typeof item === 'object') {
    const title = item.title || item.label || item.message || ''
    const details = item.keyPoints || item.points || item.details || item.description || ''
    const detailText = Array.isArray(details) ? details.join(' / ') : String(details || '')
    return (
      <>
        {title && <strong>{title}</strong>}
        {title && detailText ? ' — ' : ''}
        {detailText}
        {!title && !detailText && JSON.stringify(item)}
      </>
    )
  }
  return <>{String(item)}</>
}

// ============================================================
// Audio utility functions
// ============================================================

function downsample(buffer, sourceSampleRate, targetSampleRate) {
  if (sourceSampleRate === targetSampleRate) return buffer
  const ratio = sourceSampleRate / targetSampleRate
  const newLength = Math.round(buffer.length / ratio)
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio
    const srcIndexFloor = Math.floor(srcIndex)
    const srcIndexCeil = Math.min(srcIndexFloor + 1, buffer.length - 1)
    const frac = srcIndex - srcIndexFloor
    result[i] = buffer[srcIndexFloor] * (1 - frac) + buffer[srcIndexCeil] * frac
  }
  return result
}

function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32Array[i]))
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return int16
}

function uint8ArrayToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
