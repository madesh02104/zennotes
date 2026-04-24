import { renderZenNotesApp } from '@zennotes/app-core/main'
import { installBridge } from './bridge/http-bridge'
import { renderExportNoteWindow } from './export-window'

installBridge()

const root = document.getElementById('root')
if (!root) {
  throw new Error('Renderer root element #root was not found')
}

const params = new URLSearchParams(window.location.search)
const exportNotePath = params.get('exportNote')
if (exportNotePath) {
  renderExportNoteWindow(root, exportNotePath)
} else {
  renderZenNotesApp(root)
}
