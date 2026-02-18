import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

const ROOT_ID = 'b2b-coach-overlay-root'

const INLINE_CSS = `
  *{box-sizing:border-box;margin:0;padding:0;}
  .overlay{
    position:fixed;top:12px;right:12px;z-index:2147483647;
    font-family:Inter,system-ui,sans-serif;font-size:12px;
    display:flex;flex-direction:column;gap:6px;
    pointer-events:none;
  }
  .chip{
    pointer-events:auto;
    background:rgba(15,23,42,0.92);
    color:#f8fafc;
    border-radius:10px;
    padding:8px 12px;
    max-width:280px;
    line-height:1.4;
    box-shadow:0 4px 16px rgba(0,0,0,0.4);
    border:1px solid rgba(255,255,255,0.08);
    display:flex;align-items:flex-start;gap:8px;
  }
  .chip.suggestion{border-left:3px solid #14b8a6;}
  .chip.objection{border-left:3px solid #f59e0b;}
  .dot{flex-shrink:0;width:6px;height:6px;border-radius:50%;margin-top:4px;}
  .dot.s{background:#14b8a6;}
  .dot.o{background:#f59e0b;}
  .text{flex:1;word-break:break-word;}
`

function getItemText(item) {
  if (!item) return ''
  if (typeof item === 'string') return item
  if (typeof item === 'object') {
    const title = item.title || item.label || item.message || ''
    const details = item.keyPoints || item.points || item.details || item.description || ''
    const detailText = Array.isArray(details) ? details[0] || '' : String(details || '')
    return title ? (detailText ? `${title} — ${detailText}` : title) : detailText || JSON.stringify(item)
  }
  return String(item)
}

function OverlayApp() {
  const [suggestion, setSuggestion] = useState(null)
  const [objection, setObjection] = useState(null)
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    const handler = (message, _sender, sendResponse) => {
      if (message?.type === 'B2B_COACH_PING') {
        sendResponse({ ok: true })
        return true
      }
      if (message?.type === 'COACHING_STATE') {
        const p = message.payload
        if (p.status !== undefined) setStatus(p.status)
        if (p.suggestions !== undefined) setSuggestion(p.suggestions?.[0] ?? null)
        if (p.objections !== undefined) setObjection(p.objections?.[0] ?? null)
      }
      return false
    }

    chrome.runtime.onMessage.addListener(handler)
    chrome.runtime.sendMessage({ type: 'REQUEST_CONTENT_STATE' }, (response) => {
      if (response?.ok && response.payload) {
        const p = response.payload
        if (p.status !== undefined) setStatus(p.status)
        if (p.suggestions !== undefined) setSuggestion(p.suggestions?.[0] ?? null)
        if (p.objections !== undefined) setObjection(p.objections?.[0] ?? null)
      }
    })

    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  // Only show chips when coaching is running and there's something to show
  if (status !== 'running') return null

  const suggestionText = getItemText(suggestion)
  const objectionText = getItemText(objection)

  if (!suggestionText && !objectionText) return null

  return (
    <div className="overlay">
      {suggestionText && (
        <div className="chip suggestion">
          <span className="dot s" />
          <span className="text">{suggestionText}</span>
        </div>
      )}
      {objectionText && (
        <div className="chip objection">
          <span className="dot o" />
          <span className="text">{objectionText}</span>
        </div>
      )}
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
  style.textContent = INLINE_CSS

  const mount = document.createElement('div')
  shadow.append(style, mount)

  createRoot(mount).render(<OverlayApp />)
}

injectOverlay()
