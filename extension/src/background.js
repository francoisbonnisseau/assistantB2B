import { BACKEND_WS_URL, isAllowedMeetingUrl } from './config'

const state = {
  status: 'idle',
  activeTabId: null,
  meetingType: null,
  description: '',
  accessToken: '',
  ws: null,
  contentState: {
    status: 'idle',
    suggestions: [],
    objections: [],
    battleCards: [],
    frameworkScores: { meddic: 0, bant: 0, spiced: 0 },
    missingSignals: [],
    talkRatio: { seller: 0, buyer: 0 },
    nextStepAlerts: [],
    summaryLines: [],
  },
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL('offscreen.html')
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
  if (contexts.length) return

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Capture audio from tab and microphone for realtime coaching',
  })
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]))
  })
}

function connectWebsocket() {
  if (!BACKEND_WS_URL) {
    throw new Error('Missing VITE_BACKEND_WS_URL')
  }

  if (state.ws && state.ws.readyState <= 1) {
    return
  }

  const socket = new WebSocket(BACKEND_WS_URL)
  state.ws = socket

  socket.addEventListener('open', () => {
    state.status = 'running'
    updateContentState({ status: 'running' })
    socket.send(
      JSON.stringify({
        type: 'START_SESSION',
        payload: {
          accessToken: state.accessToken,
          meetingType: state.meetingType,
          description: state.description,
          startedAt: Date.now(),
        },
      }),
    )
  })

  socket.addEventListener('message', (event) => {
    const parsed = JSON.parse(event.data)
    if (parsed.type !== 'INSIGHT_UPDATE') return

    updateContentState(parsed.payload)
  })

  socket.addEventListener('close', () => {
    state.status = 'idle'
    updateContentState({ status: 'idle' })
  })

  socket.addEventListener('error', () => {
    state.status = 'error'
    updateContentState({ status: 'error' })
  })
}

function updateContentState(patch) {
  state.contentState = { ...state.contentState, ...patch }

  if (state.activeTabId) {
    chrome.tabs.sendMessage(state.activeTabId, {
      type: 'COACHING_STATE',
      payload: state.contentState,
    })
  }
}

async function startCoaching(payload) {
  const tab = await getActiveTab()
  if (!tab?.id || !isAllowedMeetingUrl(tab.url)) {
    throw new Error('Ouvre Google Meet, Zoom web ou Teams avant de demarrer.')
  }

  state.activeTabId = tab.id
  state.meetingType = payload.meetingType
  state.description = payload.description || ''
  state.accessToken = payload.accessToken

  connectWebsocket()
  await ensureOffscreenDocument()

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })

  chrome.runtime.sendMessage({
    type: 'OFFSCREEN_START_CAPTURE',
    payload: { streamId },
  })
}

function stopCoaching() {
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_CAPTURE' })

  if (state.ws && state.ws.readyState <= 1) {
    state.ws.close()
  }

  state.ws = null
  state.status = 'idle'
  state.activeTabId = null
  updateContentState({ status: 'idle' })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = (payload) => sendResponse(payload)

  if (message.type === 'GET_RUNTIME_STATE') {
    respond({ ok: true, state: { status: state.status, activeTabId: state.activeTabId } })
    return true
  }

  if (message.type === 'REQUEST_CONTENT_STATE') {
    respond({ ok: true, payload: state.contentState })
    return true
  }

  if (message.type === 'START_COACHING') {
    startCoaching(message.payload)
      .then(() => respond({ ok: true, state: { status: state.status, activeTabId: state.activeTabId } }))
      .catch((error) => respond({ ok: false, error: error.message }))
    return true
  }

  if (message.type === 'STOP_COACHING') {
    stopCoaching()
    respond({ ok: true, state: { status: state.status, activeTabId: state.activeTabId } })
    return true
  }

  if (message.type === 'OFFSCREEN_AUDIO_CHUNK') {
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(
        JSON.stringify({
          type: 'AUDIO_CHUNK',
          payload: message.payload,
        }),
      )
    }
    respond({ ok: true })
    return true
  }

  if (message.type === 'OFFSCREEN_STATE') {
    updateContentState({ status: message.payload.status })
    respond({ ok: true })
    return true
  }

  if (sender.tab?.id && !state.activeTabId) {
    state.activeTabId = sender.tab.id
  }

  return false
})
