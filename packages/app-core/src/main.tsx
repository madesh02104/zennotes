import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { FloatingNoteApp } from './components/FloatingNoteApp'
import { QuickCaptureApp } from './components/QuickCaptureApp'
import './styles/index.css'

export function renderZenNotesApp(root: HTMLElement): void {
  const params = new URLSearchParams(window.location.search)
  const isFloating = params.get('floating') === '1'
  const isQuickCapture = params.get('quickCapture') === '1'
  const floatingNotePath = params.get('note')

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {isQuickCapture ? (
        <QuickCaptureApp />
      ) : isFloating && floatingNotePath ? (
        <FloatingNoteApp notePath={floatingNotePath} />
      ) : (
        <App />
      )}
    </React.StrictMode>
  )
}
