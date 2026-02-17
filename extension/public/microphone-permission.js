const statusEl = document.getElementById('status')
const grantBtn = document.getElementById('grant')

function setStatus(message, type) {
  statusEl.textContent = message
  statusEl.className = type
}

async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach((track) => track.stop())
    setStatus('✅ Permission micro accordée. Tu peux fermer cet onglet.', 'ok')
  } catch (error) {
    setStatus(`❌ Permission refusée: ${error?.message || error}`, 'error')
  }
}

grantBtn?.addEventListener('click', requestMicPermission)
