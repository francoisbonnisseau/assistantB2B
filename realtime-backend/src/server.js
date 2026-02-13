import 'dotenv/config'
import { WebSocketServer } from 'ws'
import Groq from 'groq-sdk'
import { createClient as createDeepgramClient, LiveTranscriptionEvents } from '@deepgram/sdk'

const PORT = Number(process.env.PORT || 8788)
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null
const deepgram = DEEPGRAM_API_KEY ? createDeepgramClient(DEEPGRAM_API_KEY) : null

const server = new WebSocketServer({ port: PORT })
console.log(`[backend] websocket listening on ws://localhost:${PORT}`)

server.on('connection', (socket) => {
  const session = createSession()

  socket.on('message', async (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (message.type === 'START_SESSION') {
      session.startedAt = Date.now()
      session.meetingType = message.payload?.meetingType ?? null
      session.description = message.payload?.description ?? ''
      session.prompt = message.payload?.meetingType?.prompt ?? ''
      session.deepgramSockets = initDeepgramSockets(session, socket)
      return
    }

    if (message.type === 'AUDIO_CHUNK') {
      const source = message.payload?.source
      const chunk = message.payload?.chunk
      if (!source || !chunk) return

      const buffer = Buffer.from(chunk, 'base64')
      const dgSocket = session.deepgramSockets[source]
      if (dgSocket?.getReadyState?.() === 1) {
        dgSocket.send(buffer)
      }
      return
    }
  })

  socket.on('close', () => cleanupSession(session))
  socket.on('error', () => cleanupSession(session))
})

function createSession() {
  return {
    startedAt: 0,
    meetingType: null,
    prompt: '',
    description: '',
    deepgramSockets: { mic: null, tab: null },
    transcript: [],
    tokenCounter: { sellerWords: 0, buyerWords: 0 },
    lastSummaryAt: 0,
    lastAnalysisAt: 0,
  }
}

function initDeepgramSockets(session, socket) {
  if (!deepgram) {
    console.warn('[backend] DEEPGRAM_API_KEY missing, using heuristic mode only')
    return { mic: null, tab: null }
  }

  return {
    mic: createDeepgramLiveSocket('mic', session, socket),
    tab: createDeepgramLiveSocket('tab', session, socket),
  }
}

function createDeepgramLiveSocket(source, session, extensionSocket) {
  const live = deepgram.listen.live({
    model: 'nova-2',
    language: 'fr',
    smart_format: true,
    punctuate: true,
    interim_results: true,
    encoding: 'opus',
    channels: 1,
    sample_rate: 48000,
  })

  live.on(LiveTranscriptionEvents.Open, () => {
    console.log(`[backend] deepgram socket open (${source})`)
  })

  live.on(LiveTranscriptionEvents.Transcript, async (event) => {
    const transcript = event.channel?.alternatives?.[0]?.transcript?.trim()
    if (!transcript) return

    const role = source === 'mic' ? 'seller' : 'buyer'
    session.transcript.push({
      role,
      text: transcript,
      isFinal: Boolean(event.is_final),
      ts: Date.now(),
    })

    const wordCount = transcript.split(/\s+/).filter(Boolean).length
    if (role === 'seller') session.tokenCounter.sellerWords += wordCount
    if (role === 'buyer') session.tokenCounter.buyerWords += wordCount

    await pushInsights(session, extensionSocket)
  })

  live.on(LiveTranscriptionEvents.Error, (error) => {
    console.error(`[backend] deepgram error (${source})`, error)
  })

  live.on(LiveTranscriptionEvents.Close, () => {
    console.log(`[backend] deepgram socket closed (${source})`)
  })

  return live
}

async function pushInsights(session, extensionSocket) {
  const now = Date.now()
  const ratio = computeTalkRatio(session.tokenCounter)
  const heuristics = heuristicInsights(session)

  let llmInsights = null
  if (groq && now - session.lastAnalysisAt > 5000) {
    session.lastAnalysisAt = now
    llmInsights = await generateGroqInsights(session).catch(() => null)
  }

  const summaryLines =
    now - session.lastSummaryAt > 60000
      ? createMinuteSummary(session)
      : session.cachedSummary ?? ['Resume en cours de construction...']
  if (now - session.lastSummaryAt > 60000) {
    session.lastSummaryAt = now
    session.cachedSummary = summaryLines
  }

  const payload = {
    status: 'running',
    talkRatio: ratio,
    suggestions: llmInsights?.suggestions ?? heuristics.suggestions,
    objections: llmInsights?.objections ?? heuristics.objections,
    battleCards: llmInsights?.battleCards ?? heuristics.battleCards,
    frameworkScores: llmInsights?.frameworkScores ?? heuristics.frameworkScores,
    missingSignals: llmInsights?.missingSignals ?? heuristics.missingSignals,
    nextStepAlerts: llmInsights?.nextStepAlerts ?? heuristics.nextStepAlerts,
    summaryLines,
  }

  extensionSocket.send(JSON.stringify({ type: 'INSIGHT_UPDATE', payload }))
}

function computeTalkRatio(counter) {
  const total = counter.sellerWords + counter.buyerWords
  if (!total) return { seller: 0, buyer: 0 }

  const seller = Math.round((counter.sellerWords / total) * 100)
  return { seller, buyer: 100 - seller }
}

function heuristicInsights(session) {
  const merged = session.transcript.slice(-40).map((item) => item.text.toLowerCase()).join(' ')
  const objections = []
  const battleCards = []
  const suggestions = []

  if (/(trop cher|cher|prix)/.test(merged)) {
    objections.push('Objection prix detectee -> recadrer sur ROI et impact business.')
    suggestions.push('Question: Quel cout de non-resolution avez-vous aujourd\'hui ?')
  }

  if (/(deja un outil|outil actuel|solution actuelle)/.test(merged)) {
    objections.push('Objection outil existant -> creuser les limites de la solution actuelle.')
  }

  if (/(salesforce|hubspot|pipedrive|gong|clari)/.test(merged)) {
    battleCards.push('Concurrent mentionne -> demander les gaps perçus avant de comparer les features.')
  }

  const frameworkScores = {
    meddic: scoreKeyword(merged, ['budget', 'decideur', 'timeline', 'metric']),
    bant: scoreKeyword(merged, ['budget', 'autorite', 'besoin', 'timeline']),
    spiced: scoreKeyword(merged, ['situation', 'pain', 'impact', 'critical event', 'decision']),
  }

  const missingSignals = []
  if (!/decideur|decisionnaire/.test(merged)) missingSignals.push('Decideur final non identifie.')
  if (!/budget/.test(merged)) missingSignals.push('Budget non qualifie.')

  const nextStepAlerts = []
  if (!/prochaine etape|next step|rendez-vous|date/.test(merged) && callDurationMinutes(session) > 15) {
    nextStepAlerts.push('Tu n\'as pas verrouille de next step concret.')
  }

  if (!suggestions.length) {
    suggestions.push('Pose une question de qualification pour faire avancer le cycle.')
  }

  return { suggestions, objections, battleCards, frameworkScores, missingSignals, nextStepAlerts }
}

function scoreKeyword(text, keywords) {
  const hits = keywords.filter((keyword) => text.includes(keyword)).length
  return Math.round((hits / keywords.length) * 100)
}

function callDurationMinutes(session) {
  if (!session.startedAt) return 0
  return (Date.now() - session.startedAt) / 60000
}

function createMinuteSummary(session) {
  const lines = []
  const recent = session.transcript.slice(-20)

  for (const item of recent) {
    lines.push(`${item.role === 'seller' ? 'Vendeur' : 'Prospect'}: ${item.text}`)
    if (lines.length >= 20) break
  }

  return lines.length ? lines : ['Pas assez de contenu pour un resume pour l\'instant.']
}

async function generateGroqInsights(session) {
  const recentTranscript = session.transcript.slice(-30).map((item) => `${item.role}: ${item.text}`).join('\n')
  if (!recentTranscript) return null

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Tu es un coach sales B2B en temps reel. Retourne uniquement du JSON valide avec les cles: suggestions, objections, battleCards, frameworkScores, missingSignals, nextStepAlerts.',
      },
      {
        role: 'user',
        content: `Prompt client:\n${session.prompt}\n\nDescription client:\n${session.description}\n\nType meeting:\n${session.meetingType?.label || ''}\n\nTranscript:\n${recentTranscript}`,
      },
    ],
  })

  const content = completion.choices?.[0]?.message?.content
  if (!content) return null

  const parsed = JSON.parse(content)
  return {
    suggestions: parsed.suggestions || [],
    objections: parsed.objections || [],
    battleCards: parsed.battleCards || [],
    frameworkScores: parsed.frameworkScores || { meddic: 0, bant: 0, spiced: 0 },
    missingSignals: parsed.missingSignals || [],
    nextStepAlerts: parsed.nextStepAlerts || [],
  }
}

function cleanupSession(session) {
  for (const socket of [session.deepgramSockets.mic, session.deepgramSockets.tab]) {
    if (socket?.getReadyState?.() === 1) {
      socket.finish()
    }
  }
}
