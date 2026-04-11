/// <reference types="vite/client" />
import type { ZenApi } from '../../preload/index'

declare global {
  interface Window {
    zen: ZenApi
  }
}

export {}
