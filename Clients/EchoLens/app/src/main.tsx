import React from 'react'
import ReactDOM from 'react-dom/client'
import { SpotlightOverlay } from './overlay/SpotlightOverlay'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SpotlightOverlay />
  </React.StrictMode>,
)
