import 'dotenv/config'
import { WebSocketServer } from 'ws'
import Groq from 'groq-sdk'
import { createClient as createDeepgramClient, LiveTranscriptionEvents } from '@deepgram/sdk'

const PORT = Number(process.env.PORT || 8788)
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

// How often (ms) the LLM analysis runs
const LLM_COOLDOWN_MS = 10_000

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
      const requestedSources = message.payload?.sources
      session.deepgramSockets = initDeepgramSockets(session, socket, requestedSources)
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
      if (session.audioStats[source]) {
        session.audioStats[source].chunks += 1
        session.audioStats[source].bytes += buffer.length
        session.audioStats[source].lastReadyState = dgSocket?.getReadyState?.()

        const now = Date.now()
        if (now - session.audioStats[source].lastLogAt > 5000) {
          session.audioStats[source].lastLogAt = now
          console.log(
            `[backend] audio stats (${source}) chunks=${session.audioStats[source].chunks} bytes=${session.audioStats[source].bytes} dg=${session.audioStats[source].lastReadyState}`,
          )
        }
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
    audioStats: {
      mic: { chunks: 0, bytes: 0, lastLogAt: 0, lastReadyState: null },
      tab: { chunks: 0, bytes: 0, lastLogAt: 0, lastReadyState: null },
    },
    transcript: [],       // all utterances: { role, text, isFinal, ts }
    tokenCounter: { sellerWords: 0, buyerWords: 0 },
    lastAnalysisAt: 0,
    lastInsights: null,   // cache last LLM result so we can push it while cooling down
  }
}

function initDeepgramSockets(session, socket, sources) {
  if (!deepgram) {
    console.warn('[backend] DEEPGRAM_API_KEY missing, skipping transcription')
    return { mic: null, tab: null }
  }

  const enabledSources = Array.isArray(sources) && sources.length ? sources : ['mic', 'tab']
  const sockets = { mic: null, tab: null }

  if (enabledSources.includes('mic')) {
    sockets.mic = createDeepgramLiveSocket('mic', session, socket)
  }
  if (enabledSources.includes('tab')) {
    sockets.tab = createDeepgramLiveSocket('tab', session, socket)
  }

  return sockets
}

function createDeepgramLiveSocket(source, session, extensionSocket) {
  const live = deepgram.listen.live({
    model: 'nova-2',
    language: 'fr',
    smart_format: true,
    punctuate: true,
    interim_results: true,
    channels: 1,
    encoding: 'linear16',
    sample_rate: 16000,
  })

  live.on(LiveTranscriptionEvents.Open, () => {
    console.log(`[backend] deepgram socket open (${source})`)
  })

  live.on(LiveTranscriptionEvents.Transcript, async (event) => {
    const transcript = event.channel?.alternatives?.[0]?.transcript?.trim()
    if (!transcript) return

    console.log(
      `[backend] transcript (${source}) ${event.is_final ? 'final' : 'partial'}: ${transcript}`,
    )

    const role = source === 'mic' ? 'seller' : 'buyer'
    session.transcript.push({
      role,
      text: transcript,
      isFinal: Boolean(event.is_final),
      ts: Date.now(),
    })

    extensionSocket.send(
      JSON.stringify({
        type: 'TRANSCRIPT_UPDATE',
        payload: { source, text: transcript, isFinal: Boolean(event.is_final) },
      }),
    )

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

// ============================================================
// Insights pipeline
// ============================================================

async function pushInsights(session, extensionSocket) {
  const now = Date.now()
  const talkRatio = computeTalkRatio(session.tokenCounter)

  // Always update talk ratio immediately
  // Only run LLM analysis when cooldown has passed AND there is transcript to analyse
  let insights = session.lastInsights
  if (groq && now - session.lastAnalysisAt >= LLM_COOLDOWN_MS) {
    session.lastAnalysisAt = now
    const fresh = await generateGroqInsights(session).catch((err) => {
      console.error('[backend] groq error', err?.message)
      return null
    })
    if (fresh) {
      session.lastInsights = fresh
      insights = fresh
    }
  }

  const payload = {
    status: 'running',
    talkRatio,
    suggestions:     insights?.suggestions     ?? [],
    objections:      insights?.objections      ?? [],
    battleCards:     insights?.battleCards     ?? [],
    frameworkScores: insights?.frameworkScores ?? { meddic: 0, bant: 0, spiced: 0 },
    missingSignals:  insights?.missingSignals  ?? [],
    nextStepAlerts:  insights?.nextStepAlerts  ?? [],
  }

  extensionSocket.send(JSON.stringify({ type: 'INSIGHT_UPDATE', payload }))
}

function computeTalkRatio(counter) {
  const total = counter.sellerWords + counter.buyerWords
  if (!total) return { seller: 0, buyer: 0 }
  const seller = Math.round((counter.sellerWords / total) * 100)
  return { seller, buyer: 100 - seller }
}

// ============================================================
// Groq LLM analysis — full transcript, structured JSON output
// ============================================================

/**
 * Build the full transcript string, keeping the most recent utterances
 * if the transcript grows very long (token budget ~6000 words).
 */
function buildTranscriptText(session) {
  // Keep all final utterances; trim to last 200 utterances if very long
  const utterances = session.transcript
    .filter((u) => u.isFinal)
    .slice(-200)

  if (!utterances.length) {
    // Fall back to partials if nothing is final yet
    return session.transcript.slice(-30).map((u) => `${u.role}: ${u.text}`).join('\n')
  }

  return utterances.map((u) => `${u.role}: ${u.text}`).join('\n')
}

async function generateGroqInsights(session) {
  const transcriptText = buildTranscriptText(session)
  if (!transcriptText) return null

  const durationMin = callDurationMinutes(session)
  const sellerRatio = computeTalkRatio(session.tokenCounter).seller

  const systemPrompt = `Tu es un coach sales B2B expert qui assiste un commercial en temps réel pendant un appel.
Tu analyses le transcript complet et retournes UNIQUEMENT du JSON valide (aucun texte hors du JSON).

Structure JSON attendue :
{
  "suggestions": [
    { "title": "...", "keyPoints": ["...", "..."] }
  ],
  "objections": [
    { "title": "Objection détectée", "keyPoints": ["Réponse suggérée 1", "Réponse suggérée 2"] }
  ],
  "battleCards": [
    { "title": "Concurrent mentionné", "keyPoints": ["Argument différenciant 1", "Question piège à poser"] }
  ],
  "frameworkScores": {
    "meddic": 0,
    "bant": 0,
    "spiced": 0
  },
  "missingSignals": ["..."],
  "nextStepAlerts": ["..."]
}

Règles :
- suggestions : 1 à 3 actions concrètes que le commercial devrait faire maintenant (question à poser, point à valider, argument à avancer). Vide si le call se passe bien.
- objections : liste les objections détectées avec 2-3 réponses/frameworks adaptés. Vide si aucune objection.
- battleCards : uniquement si un concurrent est explicitement mentionné. Arguments différenciants + questions pièges. Vide sinon.
- frameworkScores : score 0-100 pour chaque framework basé sur les infos collectées dans le transcript (budget, décideur, timeline, métriques, situation, pain, impact, next step...).
- missingSignals : critères critiques non encore abordés selon le stade du call. Vide si tout a été couvert.
- nextStepAlerts : alerte si le call dure plus de ${Math.round(durationMin)} minutes et qu'aucun next step concret n'a été verrouillé. Vide sinon.
- Toutes les réponses en français.
- Sois précis et actionnable. Pas de généralités.`

  const userMessage = `Contexte client : ${session.description || 'Non fourni'}
Type de meeting : ${session.meetingType?.label || 'Non spécifié'}
Instructions spécifiques : ${session.prompt || 'Aucune'}
Durée du call : ${durationMin.toFixed(1)} minutes
Ratio vendeur/prospect : ${sellerRatio}% / ${100 - sellerRatio}%

Transcript complet :
${transcriptText}`

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.2,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })

  const content = completion.choices?.[0]?.message?.content
  if (!content) return null

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    console.error('[backend] groq JSON parse error', e?.message, content?.slice(0, 200))
    return null
  }

  return {
    suggestions:     Array.isArray(parsed.suggestions)     ? parsed.suggestions     : [],
    objections:      Array.isArray(parsed.objections)      ? parsed.objections      : [],
    battleCards:     Array.isArray(parsed.battleCards)     ? parsed.battleCards     : [],
    frameworkScores: parsed.frameworkScores && typeof parsed.frameworkScores === 'object'
      ? {
          meddic: Number(parsed.frameworkScores.meddic ?? 0),
          bant:   Number(parsed.frameworkScores.bant   ?? 0),
          spiced: Number(parsed.frameworkScores.spiced ?? 0),
        }
      : { meddic: 0, bant: 0, spiced: 0 },
    missingSignals:  Array.isArray(parsed.missingSignals)  ? parsed.missingSignals  : [],
    nextStepAlerts:  Array.isArray(parsed.nextStepAlerts)  ? parsed.nextStepAlerts  : [],
  }
}

function callDurationMinutes(session) {
  if (!session.startedAt) return 0
  return (Date.now() - session.startedAt) / 60000
}

function cleanupSession(session) {
  for (const socket of [session.deepgramSockets.mic, session.deepgramSockets.tab]) {
    if (socket?.getReadyState?.() === 1) {
      socket.finish()
    }
  }
}
