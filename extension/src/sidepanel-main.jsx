import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './sidepanel.css'
import SidePanel from './SidePanel.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
)
