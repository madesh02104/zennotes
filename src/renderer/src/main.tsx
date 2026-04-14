import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { FloatingNoteApp } from './components/FloatingNoteApp'
import './styles/index.css'

// A second BrowserWindow can boot the same renderer bundle and arrive
// with `?floating=1&note=<path>` to pop a single note out into its own
// always-visible window. The full sidebar/tabs/splits app is too heavy
// for that — we mount a stripped FloatingNoteApp instead.
const params = new URLSearchParams(window.location.search)
const isFloating = params.get('floating') === '1'
const floatingNotePath = params.get('note')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFloating && floatingNotePath ? (
      <FloatingNoteApp notePath={floatingNotePath} />
    ) : (
      <App />
    )}
  </React.StrictMode>
)
