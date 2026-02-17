import { useState } from 'react'

function App() {
  const [message, setMessage] = useState('')

  const openSidePanel = async () => {
    try {
      // chrome.sidePanel.open() requires a windowId
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId })
        // Close the popup after opening side panel
        window.close()
      } else {
        setMessage('Impossible d\'ouvrir le panneau lateral.')
      }
    } catch (error) {
      console.error('Failed to open side panel', error)
      setMessage('Erreur: ' + (error.message || 'Impossible d\'ouvrir le panneau lateral.'))
    }
  }

  const openMicrophonePermissionPage = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('microphone-permission.html') })
  }

  return (
    <main className="popup-root">
      <header>
        <h1>B2B Realtime Coach</h1>
      </header>
      <div className="panel stack">
        <p className="muted">
          Le coaching se fait dans le panneau lateral.
          Clique ci-dessous pour l'ouvrir.
        </p>
        <button type="button" onClick={openSidePanel}>
          Ouvrir le panneau lateral
        </button>
        <button type="button" className="secondary" onClick={openMicrophonePermissionPage}>
          Autoriser micro
        </button>
        {message && <p className="error">{message}</p>}
      </div>
    </main>
  )
}

export default App
