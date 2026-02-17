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

const LOG_PREFIX = '[B2B Coach]'
const log = (...args) => console.log(LOG_PREFIX, ...args)
const logError = (...args) => console.error(LOG_PREFIX, ...args)
const logWarn = (...args) => console.warn(LOG_PREFIX, ...args)
const MICROPHONE_PERMISSION_PAGE = 'microphone-permission.html'

const sendRuntimeMessage = (payload) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        logError('Runtime message error', chrome.runtime.lastError.message)
        resolve(null)
        return
      }
      resolve(response)
    })
  })

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL('offscreen.html')
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
  if (contexts.length) return

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Capture microphone audio for realtime coaching',
  })
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs[0]))
  })
}

function queryTabs(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || []))
  })
}

function getTabById(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      resolve(tab)
    })
  })
}

async function resolveMeetingTab(payload) {
  if (payload?.tabId) {
    const explicitTab = await getTabById(payload.tabId)
    if (explicitTab?.id && isAllowedMeetingUrl(explicitTab.url)) {
      return explicitTab
    }
  }

  const activeTab = await getActiveTab()
  if (activeTab?.id && isAllowedMeetingUrl(activeTab.url)) {
    return activeTab
  }

  const windowTabs = await queryTabs({ lastFocusedWindow: true })
  const allowedTabs = windowTabs.filter((tab) => isAllowedMeetingUrl(tab.url))
  if (!allowedTabs.length) {
    return null
  }

  const activeAllowed = allowedTabs.find((tab) => tab.active)
  if (activeAllowed) return activeAllowed

  const audibleAllowed = allowedTabs.find((tab) => tab.audible)
  if (audibleAllowed) return audibleAllowed

  return allowedTabs[0]
}

function pingContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'B2B_COACH_PING' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(false)
        return
      }
      resolve(response?.ok === true)
    })
  })
}

async function ensureContentScript(tabId) {
  const reachable = await pingContentScript(tabId)
  if (reachable) return true

  if (!chrome.scripting?.executeScript) {
    logWarn('Cannot inject content script (missing scripting permission)')
    return false
  }

  const contentScriptPath = chrome.runtime.getManifest()?.content_scripts?.[0]?.js?.[0]
  if (!contentScriptPath) {
    logWarn('No content script path found in manifest')
    return false
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentScriptPath],
    })
  } catch (error) {
    logError('Content script injection failed', error)
    return false
  }

  return pingContentScript(tabId)
}

function connectWebsocket() {
  if (!BACKEND_WS_URL) {
    throw new Error('Missing VITE_BACKEND_WS_URL')
  }

  if (state.ws && state.ws.readyState <= 1) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(BACKEND_WS_URL)
    state.ws = socket

    log('WS connecting', BACKEND_WS_URL)

    socket.addEventListener('open', () => {
      log('WS open')
      state.status = 'running'
      updateContentState({ status: 'running' })
      socket.send(
        JSON.stringify({
          type: 'START_SESSION',
          payload: {
            accessToken: state.accessToken,
            meetingType: state.meetingType,
            description: state.description,
            sources: ['tab', 'mic'],
            startedAt: Date.now(),
          },
        }),
      )
      resolve()
    })

    socket.addEventListener('message', (event) => {
      const parsed = JSON.parse(event.data)

      if (parsed.type === 'TRANSCRIPT_UPDATE') {
        log('Transcript', parsed.payload)
        // Forward transcript to both offscreen (for logging) and side panel
        sendRuntimeMessage({ type: 'OFFSCREEN_TRANSCRIPT', payload: parsed.payload })
        sendRuntimeMessage({ type: 'SIDEPANEL_TRANSCRIPT_UPDATE', payload: parsed.payload })
        return
      }

      if (parsed.type !== 'INSIGHT_UPDATE') return

      log('WS insight update', {
        suggestions: parsed.payload?.suggestions?.length ?? 0,
        objections: parsed.payload?.objections?.length ?? 0,
        battleCards: parsed.payload?.battleCards?.length ?? 0,
      })

      updateContentState(parsed.payload)
      // Forward insights to side panel
      sendRuntimeMessage({ type: 'SIDEPANEL_INSIGHT_UPDATE', payload: parsed.payload })
    })

    socket.addEventListener('close', () => {
      log('WS closed')
      state.status = 'idle'
      updateContentState({ status: 'idle' })
      sendRuntimeMessage({ type: 'SIDEPANEL_COACHING_STOPPED' })
    })

    socket.addEventListener('error', (event) => {
      logError('WS error', event)
      state.status = 'error'
      updateContentState({ status: 'error' })
      reject(new Error('WebSocket connection failed'))
    })
  })
}

function updateContentState(patch) {
  state.contentState = { ...state.contentState, ...patch }

  if (state.activeTabId) {
    chrome.tabs.sendMessage(
      state.activeTabId,
      {
        type: 'COACHING_STATE',
        payload: state.contentState,
      },
      () => {
        if (chrome.runtime.lastError) {
          const message = chrome.runtime.lastError.message || ''
          if (message.includes('The message port closed before a response was received')) {
            return
          }
          log('Content script not reachable', message)
        }
      },
    )
  }
}

// ============================================================
// Coaching lifecycle
// ============================================================

async function startCoaching(payload) {
  const tab = await resolveMeetingTab(payload)
  if (!tab?.id || !isAllowedMeetingUrl(tab.url)) {
    throw new Error('Ouvre Google Meet, Zoom web, Teams ou YouTube avant de demarrer.')
  }

  log('Starting coaching', { tabId: tab.id, url: tab.url })
  log('Target tab state', {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    audible: Boolean(tab.audible),
    muted: Boolean(tab.mutedInfo?.muted),
    discarded: Boolean(tab.discarded),
    status: tab.status,
  })

  state.activeTabId = tab.id
  state.meetingType = payload.meetingType
  state.description = payload.description || ''
  state.accessToken = payload.accessToken

  const contentReady = await ensureContentScript(tab.id)
  if (!contentReady) {
    logWarn('Content script still not reachable on target tab')
  }

  // 1) Connect WS and wait for it to be open
  await connectWebsocket()

  // 2) Start mic capture in offscreen document
  await ensureOffscreenDocument()
  log('Starting mic capture in offscreen')
  await sendRuntimeMessage({ type: 'OFFSCREEN_START_MIC' })

  // Tab capture is handled directly by the side panel via chrome.tabCapture.capture()
  log('Coaching started (tab=side panel, mic=offscreen)')
}

function stopCoaching() {
  log('Stopping coaching')

  // Stop mic in offscreen
  sendRuntimeMessage({ type: 'OFFSCREEN_STOP_MIC' })

  // Tell side panel to stop tab capture
  sendRuntimeMessage({ type: 'SIDEPANEL_COACHING_STOPPED' })

  // Close WebSocket
  if (state.ws && state.ws.readyState <= 1) {
    state.ws.close()
  }

  state.ws = null
  state.status = 'idle'
  state.activeTabId = null
  updateContentState({ status: 'idle' })
}

// ============================================================
// Message handling
// ============================================================

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

  // Tab audio chunks from side panel -> forward to backend WS
  if (message.type === 'SIDEPANEL_TAB_AUDIO_CHUNK') {
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

  // Mic audio chunks from offscreen -> forward to backend WS
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
    log('Offscreen state', message.payload)
    respond({ ok: true })
    return true
  }

  if (sender.tab?.id && !state.activeTabId) {
    state.activeTabId = sender.tab.id
  }

  return false
})

// ============================================================
// Extension lifecycle
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  // Enable side panel
  if (chrome.sidePanel?.setOptions) {
    chrome.sidePanel.setOptions({ enabled: true }).catch((e) => {
      logWarn('Failed to enable side panel', e)
    })
  }

  // Open microphone permission page on install
  chrome.tabs.create({
    url: chrome.runtime.getURL(MICROPHONE_PERMISSION_PAGE),
    active: true,
  })
})
