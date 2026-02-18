import { useState } from 'react'
import { Button } from '@/components/ui/button'

function App() {
  const [message, setMessage] = useState('')

  const openSidePanel = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId })
        window.close()
      } else {
        setMessage("Impossible d'ouvrir le panneau lateral.")
      }
    } catch (error) {
      console.error('Failed to open side panel', error)
      setMessage('Erreur: ' + (error.message || "Impossible d'ouvrir le panneau lateral."))
    }
  }

  const openMicrophonePermissionPage = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('microphone-permission.html') })
  }

  return (
    <main className="w-64 bg-background text-foreground p-4 flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-primary" />
        <h1 className="text-sm font-semibold tracking-tight">B2B Realtime Coach</h1>
      </header>
      <p className="text-xs text-muted-foreground">
        Le coaching se fait dans le panneau lateral. Clique ci-dessous pour l'ouvrir.
      </p>
      <Button className="w-full" onClick={openSidePanel}>
        Ouvrir le panneau lateral
      </Button>
      <Button variant="outline" className="w-full" onClick={openMicrophonePermissionPage}>
        Autoriser micro
      </Button>
      {message && <p className="text-xs text-destructive">{message}</p>}
    </main>
  )
}

export default App
