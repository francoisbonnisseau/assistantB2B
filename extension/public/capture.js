/**
 * Tab audio capture in a real extension page (popup window).
 *
 * Offscreen documents have a Chrome bug where tab capture streams produce silence
 * in all audio APIs (ScriptProcessorNode, AudioWorklet, MediaRecorder).
 * A real extension page (opened via chrome.windows.create) does NOT have this bug.
 *
 * This page receives a streamId from the background, captures tab audio via
 * getUserMedia + ScriptProcessorNode, converts to PCM Int16 @ 16kHz, and sends
 * chunks back to the background via chrome.runtime.sendMessage.
 */

const TARGET_SAMPLE_RATE = 16000
const SAMPLES_PER_CHUNK = 2048
const LOG_PREFIX = '[B2B Tab Capture]'
const log = (...args) => console.log(LOG_PREFIX, ...args)
const logError = (...args) => console.error(LOG_PREFIX, ...args)

const statusEl = document.getElementById('status')
function setStatus(text) {
  if (statusEl) statusEl.textContent = text
  log(text)
}

let tabStream = null
let audioContext = null
let sourceNode = null
let processorNode = null
let sampleBuffer = new Float32Array(0)
let chunkCount = 0
let totalSamples = 0

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TAB_CAPTURE_START') {
    startTabCapture(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        logError('Start failed', error)
        sendResponse({ ok: false, error: error.message })
      })
    return true
  }

  if (message?.type === 'TAB_CAPTURE_STOP') {
    stopTabCapture()
    sendResponse({ ok: true })
    return true
  }

  return false
})

// Notify background that capture window is ready
chrome.runtime.sendMessage({ type: 'TAB_CAPTURE_WINDOW_READY' })
setStatus('Waiting for capture command...')

async function startTabCapture(payload) {
  stopTabCapture()

  const streamId = payload?.streamId
  const tabId = payload?.tabId
  setStatus('Starting tab capture... streamId=' + (streamId ? 'yes' : 'no'))

  if (!streamId) {
    throw new Error('Missing streamId for tab capture')
  }

  // Get tab audio stream
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  })

  const tracks = tabStream.getAudioTracks()
  log('Tab stream active:', tabStream.active, 'Tracks:', tracks.length)
  tracks.forEach((track, i) => {
    const s = track.getSettings?.() || {}
    log(`Track[${i}] enabled=${track.enabled} muted=${track.muted} readyState=${track.readyState} sampleRate=${s.sampleRate} channelCount=${s.channelCount}`)
  })

  // Set up AudioContext + ScriptProcessorNode
  audioContext = new AudioContext()
  if (audioContext.state !== 'running') {
    await audioContext.resume()
  }
  log('AudioContext state:', audioContext.state, 'sampleRate:', audioContext.sampleRate)

  sourceNode = audioContext.createMediaStreamSource(tabStream)
  processorNode = audioContext.createScriptProcessor(4096, 1, 1)

  chunkCount = 0
  totalSamples = 0
  sampleBuffer = new Float32Array(0)

  processorNode.onaudioprocess = (event) => {
    const inputData = event.inputBuffer.getChannelData(0)

    // CRITICAL: Copy input → output so the tab audio keeps playing for the user
    const outputData = event.outputBuffer.getChannelData(0)
    outputData.set(inputData)

    const downsampled = downsample(inputData, event.inputBuffer.sampleRate, TARGET_SAMPLE_RATE)

    // Accumulate samples
    const newBuffer = new Float32Array(sampleBuffer.length + downsampled.length)
    newBuffer.set(sampleBuffer)
    newBuffer.set(downsampled, sampleBuffer.length)
    sampleBuffer = newBuffer

    // Send in fixed-size chunks
    while (sampleBuffer.length >= SAMPLES_PER_CHUNK) {
      const toSend = sampleBuffer.slice(0, SAMPLES_PER_CHUNK)
      sampleBuffer = sampleBuffer.slice(SAMPLES_PER_CHUNK)

      const int16 = float32ToInt16(toSend)
      const base64 = uint8ArrayToBase64(new Uint8Array(int16.buffer))

      chrome.runtime.sendMessage({
        type: 'TAB_AUDIO_CHUNK',
        payload: {
          source: 'tab',
          chunk: base64,
          ts: Date.now(),
        },
      })

      chunkCount += 1
      totalSamples += SAMPLES_PER_CHUNK

      if (chunkCount % 50 === 0) {
        let maxAbs = 0
        for (let i = 0; i < toSend.length; i++) {
          const abs = Math.abs(toSend[i])
          if (abs > maxAbs) maxAbs = abs
        }
        const durationSec = (totalSamples / TARGET_SAMPLE_RATE).toFixed(1)
        const msg = `Sent ${chunkCount} chunks (${durationSec}s), peak=${maxAbs.toFixed(6)}`
        setStatus(msg)
      }
    }
  }

  sourceNode.connect(processorNode)
  processorNode.connect(audioContext.destination)

  setStatus('Tab audio capture ACTIVE')
  chrome.runtime.sendMessage({ type: 'TAB_CAPTURE_STATE', payload: { status: 'running' } })
}

function stopTabCapture() {
  if (processorNode) {
    processorNode.onaudioprocess = null
    processorNode.disconnect()
    processorNode = null
  }
  if (sourceNode) {
    sourceNode.disconnect()
    sourceNode = null
  }
  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
  }
  if (tabStream) {
    tabStream.getTracks().forEach((track) => track.stop())
    tabStream = null
  }

  sampleBuffer = new Float32Array(0)
  chunkCount = 0
  totalSamples = 0

  setStatus('Tab capture stopped')
  chrome.runtime.sendMessage({ type: 'TAB_CAPTURE_STATE', payload: { status: 'idle' } })
}

// ============================================================
// Utility functions
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
