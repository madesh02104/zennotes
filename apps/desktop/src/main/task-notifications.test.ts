import { describe, expect, it, vi } from 'vitest'

// Electron's `app` object pulls in native bindings. The scheduler
// references it for the before-quit teardown but never during the
// pure date-math we test here, so a minimal stub is fine.
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
    on(): void {}
    show(): void {}
  }
}))

// vault.ts imports `electron`'s real `app` for paths; mock loadConfig
// so the import doesn't crash and so we can drive the scheduler under
// test without touching disk.
vi.mock('./vault', () => ({
  DEFAULT_TASK_NOTIFICATIONS: { enabled: false, timeOfDay: '09:00' },
  loadConfig: vi.fn(),
  updateConfig: vi.fn()
}))

import { __test } from './task-notifications'

const { computeNextTrigger, parseTimeOfDay, localIsoDate } = __test

describe('parseTimeOfDay', () => {
  it('parses HH:MM strings', () => {
    expect(parseTimeOfDay('09:00')).toEqual({ hours: 9, minutes: 0 })
    expect(parseTimeOfDay('18:45')).toEqual({ hours: 18, minutes: 45 })
  })

  it('falls back to default for malformed input', () => {
    expect(parseTimeOfDay('25:00')).toEqual({ hours: 9, minutes: 0 })
    expect(parseTimeOfDay('garbage')).toEqual({ hours: 9, minutes: 0 })
  })
})

describe('computeNextTrigger', () => {
  it('returns today if the slot is in the future', () => {
    const now = new Date(2026, 3, 30, 8, 0, 0) // 8:00am
    const next = computeNextTrigger(now, { enabled: true, timeOfDay: '09:00' })
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
    expect(next.getDate()).toBe(30)
  })

  it('rolls to tomorrow if the slot is in the past', () => {
    // April 30 11:00am — today's 09:00 slot has already passed, so we
    // expect to land on May 1 09:00 (April only has 30 days).
    const now = new Date(2026, 3, 30, 11, 0, 0)
    const next = computeNextTrigger(now, { enabled: true, timeOfDay: '09:00' })
    expect(next.getHours()).toBe(9)
    expect(next.getDate()).toBe(1)
    expect(next.getMonth()).toBe(4)
  })
})

describe('localIsoDate', () => {
  it('formats a date with zero-padded local Y-M-D', () => {
    expect(localIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
