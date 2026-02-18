import { useEffect, useMemo, useRef, useState } from 'react'
import { loginClient, fetchClientConfig } from './services/edgeApi'
import { getStoredSession, saveSession, clearSession } from './services/storage'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

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
        setError("Impossible de capturer l'audio de l'onglet. Verifie que l'onglet est actif.")
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
    return (
      <Shell>
        <p className="text-sm text-muted-foreground px-4 py-6 text-center">Chargement...</p>
      </Shell>
    )
  }

  if (!session || !config) {
    return (
      <Shell>
        <Card className="mx-3 mt-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Connexion</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={handleLogin}>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Username</label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={credentials.username}
                  onChange={(e) => setCredentials((p) => ({ ...p, username: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Password</label>
                <input
                  type="password"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={credentials.password}
                  onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
                  required
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Connexion...' : 'Se connecter'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </Shell>
    )
  }

  const isRunning = coachingStatus === 'running'

  return (
    <Shell>
      {/* Session header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-sm font-medium truncate">{config.clientName || config.username}</span>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs h-7 px-2">
          Deconnexion
        </Button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {/* Controls card */}
        <Card>
          <CardContent className="pt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Type de meeting</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedMeetingTypeId}
                onChange={(e) => setSelectedMeetingTypeId(e.target.value)}
              >
                {config.meetingTypes.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
                  isRunning ? 'bg-primary' : coachingStatus === 'error' ? 'bg-destructive' : 'bg-muted-foreground'
                }`}
              />
              <span className="text-xs text-muted-foreground">
                {isRunning ? 'En cours' : coachingStatus === 'error' ? 'Erreur' : 'Pret'}
              </span>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button onClick={startCoaching} disabled={isRunning} className="flex-1">
                Demarrer
              </Button>
              <Button variant="outline" onClick={stopCoaching} disabled={!isRunning} className="flex-1">
                Stop
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Coaching insights — only shown when running */}
        {isRunning && (
          <>
            {/* Talk ratio */}
            {insights?.talkRatio && (
              <Card>
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Talk ratio
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span>Vendeur</span>
                      <span>{insights.talkRatio.seller}%</span>
                    </div>
                    <Progress value={insights.talkRatio.seller} className="h-2" />
                    <div className="flex justify-between text-xs mt-2 mb-1">
                      <span>Prospect</span>
                      <span>{insights.talkRatio.buyer}%</span>
                    </div>
                    <Progress value={insights.talkRatio.buyer} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Suggestions */}
            {insights?.suggestions?.length > 0 && (
              <Card>
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    Suggestions
                    <Badge variant="secondary" className="text-xs">{insights.suggestions.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  <ul className="flex flex-col gap-2">
                    {insights.suggestions.map((s, i) => (
                      <li key={i} className="text-sm leading-snug">
                        <InsightItem item={s} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Objections */}
            {insights?.objections?.length > 0 && (
              <Card className="border-warning/50">
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    Objections
                    <Badge variant="warning" className="text-xs">{insights.objections.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  <ul className="flex flex-col gap-2">
                    {insights.objections.map((o, i) => (
                      <li key={i} className="text-sm leading-snug">
                        <InsightItem item={o} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Battle Cards */}
            {insights?.battleCards?.length > 0 && (
              <Card>
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    Battle Cards
                    <Badge variant="secondary" className="text-xs">{insights.battleCards.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  <ul className="flex flex-col gap-2">
                    {insights.battleCards.map((b, i) => (
                      <li key={i} className="text-sm leading-snug">
                        <InsightItem item={b} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Missing signals */}
            {insights?.missingSignals?.length > 0 && (
              <Card className="border-warning/50">
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    Signaux manquants
                    <Badge variant="warning" className="text-xs">{insights.missingSignals.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  <ul className="flex flex-col gap-2">
                    {insights.missingSignals.map((m, i) => (
                      <li key={i} className="text-sm leading-snug">
                        <InsightItem item={m} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Next step alerts */}
            {insights?.nextStepAlerts?.length > 0 && (
              <Card className="border-destructive/50">
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    Next Steps
                    <Badge variant="destructive" className="text-xs">{insights.nextStepAlerts.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  <ul className="flex flex-col gap-2">
                    {insights.nextStepAlerts.map((n, i) => (
                      <li key={i} className="text-sm leading-snug">
                        <InsightItem item={n} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Separator />

            {/* Live transcript */}
            <Card>
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Transcription live
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3 p-0">
                <ScrollArea className="h-48 px-4 pb-3">
                  <div className="flex flex-col gap-1">
                    {transcripts.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">En attente de parole...</p>
                    )}
                    {transcripts.map((t, i) => (
                      <p key={i} className="text-xs leading-relaxed">
                        <span className={`font-semibold mr-1 ${t.source === 'mic' ? 'text-primary' : 'text-muted-foreground'}`}>
                          {t.source === 'mic' ? 'Vous' : 'Prospect'}
                        </span>
                        {t.text}
                        {!t.isFinal && <span className="text-muted-foreground">...</span>}
                      </p>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="h-2 w-2 rounded-full bg-primary" />
        <h1 className="text-sm font-semibold tracking-tight">B2B Coach</h1>
      </header>
      <div className="flex-1 overflow-auto">{children}</div>
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
        {title && <strong className="font-medium">{title}</strong>}
        {title && detailText ? ' — ' : ''}
        {detailText && <span className="text-muted-foreground">{detailText}</span>}
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
