let micRecorder = null
let tabRecorder = null
let micStream = null
let tabStream = null

const BASE_MIME_TYPE = 'audio/webm;codecs=opus'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OFFSCREEN_START_CAPTURE') {
    startCapture(message.payload?.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }))
    return true
  }

  if (message?.type === 'OFFSCREEN_STOP_CAPTURE') {
    stopCapture()
    sendResponse({ ok: true })
    return true
  }

  return false
})

async function startCapture(streamId) {
  stopCapture()

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  })

  micRecorder = createRecorder(micStream, 'mic')
  tabRecorder = createRecorder(tabStream, 'tab')

  micRecorder.start(500)
  tabRecorder.start(500)

  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STATE', payload: { status: 'running' } })
}

function stopCapture() {
  for (const recorder of [micRecorder, tabRecorder]) {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  for (const stream of [micStream, tabStream]) {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
    }
  }

  micRecorder = null
  tabRecorder = null
  micStream = null
  tabStream = null

  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STATE', payload: { status: 'idle' } })
}

function createRecorder(stream, source) {
  const recorder = new MediaRecorder(stream, { mimeType: BASE_MIME_TYPE })
  recorder.ondataavailable = async (event) => {
    if (!event.data?.size) return

    const chunk = await blobToBase64(event.data)
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_AUDIO_CHUNK',
      payload: {
        source,
        mimeType: BASE_MIME_TYPE,
        chunk,
        ts: Date.now(),
      },
    })
  }

  return recorder
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}
