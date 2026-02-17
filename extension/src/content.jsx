import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SuggestionBox } from './components/SuggestionBox'
import { Checklist } from './components/Checklist'
import { TimerAlert } from './components/TimerAlert'

const ROOT_ID = 'b2b-coach-overlay-root'

const INITIAL_STATE = {
  status: 'idle',
  suggestions: [],
  objections: [],
  battleCards: [],
  frameworkScores: { meddic: 0, bant: 0, spiced: 0 },
  missingSignals: [],
  talkRatio: { seller: 0, buyer: 0 },
  nextStepAlerts: [],
  summaryLines: [],
}

function OverlayApp() {
  const [state, setState] = useState(INITIAL_STATE)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const handler = (message, _sender, sendResponse) => {
      if (message?.type === 'B2B_COACH_PING') {
        sendResponse({ ok: true })
        return true
      }

      if (message?.type === 'COACHING_STATE') {
        setState((prev) => ({ ...prev, ...message.payload }))
      }

      return false
    }

    chrome.runtime.onMessage.addListener(handler)
    chrome.runtime.sendMessage({ type: 'REQUEST_CONTENT_STATE' }, (response) => {
      if (response?.ok) {
        setState((prev) => ({ ...prev, ...response.payload }))
      }
    })

    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  return (
    <div className={`b2b-overlay ${collapsed ? 'collapsed' : ''}`}>
      <button className="toggle" type="button" onClick={() => setCollapsed((value) => !value)}>
        {collapsed ? 'Coach' : 'Masquer'}
      </button>

      {!collapsed ? (
        <>
          <header>
            <h2>B2B Coach</h2>
            <span className={`status ${state.status}`}>{state.status}</span>
          </header>
          <TimerAlert talkRatio={state.talkRatio} nextStepAlerts={state.nextStepAlerts} summaryLines={state.summaryLines} />
          <SuggestionBox
            suggestions={state.suggestions}
            objections={state.objections}
            battleCards={state.battleCards}
          />
          <Checklist frameworkScores={state.frameworkScores} missingSignals={state.missingSignals} />
        </>
      ) : null}
    </div>
  )
}

function injectOverlay() {
  if (document.getElementById(ROOT_ID)) return

  const container = document.createElement('div')
  container.id = ROOT_ID
  document.body.appendChild(container)

  const shadow = container.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    .b2b-overlay {position: fixed; top: 12px; right: 12px; width: 360px; max-height: calc(100vh - 24px); overflow:auto; z-index: 2147483647; background: #0f172a; color: #f8fafc; border-radius: 12px; padding: 12px; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.45); font-family: Inter, system-ui, sans-serif;}
    .b2b-overlay.collapsed {width: auto; padding: 8px;}
    .b2b-overlay header {display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;}
    .b2b-overlay h2 {margin:0; font-size: 14px;}
    .b2b-overlay .status {font-size: 11px; padding: 2px 8px; border-radius: 999px; background:#334155;}
    .b2b-overlay .status.running {background:#0f766e;}
    .b2b-overlay .status.error {background:#b91c1c;}
    .b2b-overlay .toggle {width:100%; margin-bottom:8px; background:#1e293b; border:1px solid #475569; color:#e2e8f0; border-radius:8px; padding:8px; cursor:pointer;}
    .overlay-card {background: #1e293b; border:1px solid #334155; border-radius:10px; padding:10px; margin-bottom:10px;}
    .overlay-card h3,.overlay-card h4 {margin:0 0 8px 0; font-size: 12px;}
    .overlay-card ul {margin:0; padding-left: 16px; font-size:11px;}
    .overlay-card li {margin-bottom:4px;}
    .score-row {margin-bottom:8px;}
    .score-label {display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;}
    .score-track {height:6px; background:#334155; border-radius:999px; overflow:hidden;}
    .score-fill {height:100%; background: linear-gradient(90deg, #14b8a6, #22d3ee);}
  `

  const mount = document.createElement('div')
  shadow.append(style, mount)

  createRoot(mount).render(<OverlayApp />)
}

injectOverlay()
