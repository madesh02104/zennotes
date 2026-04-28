import { describe, expect, it } from 'vitest'
import {
  bucketTasksByDueDate,
  buildTaskDigest,
  parseTasksFromBody,
  tasksDueOn,
  toIsoDateLocal,
  type ParseTasksContext
} from '@shared/tasks'

const ctx: ParseTasksContext = {
  path: 'inbox/test.md',
  title: 'test',
  folder: 'inbox'
}

function tasks(body: string): ReturnType<typeof parseTasksFromBody> {
  return parseTasksFromBody(body, ctx)
}

describe('toIsoDateLocal', () => {
  it('formats local Y-M-D with zero padding', () => {
    expect(toIsoDateLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('tasksDueOn', () => {
  it('returns only unchecked, non-waiting tasks matching the iso', () => {
    const all = tasks(
      [
        '- [ ] today  due:2026-04-30',
        '- [ ] tomorrow  due:2026-05-01',
        '- [x] done  due:2026-04-30',
        '- [ ] waiting  due:2026-04-30 @waiting'
      ].join('\n')
    )
    const due = tasksDueOn(all, '2026-04-30')
    expect(due).toHaveLength(1)
    expect(due[0].content).toBe('today')
  })
})

describe('bucketTasksByDueDate', () => {
  it('groups by due date and surfaces unscheduled separately', () => {
    const all = tasks(
      [
        '- [ ] a  due:2026-04-30',
        '- [ ] b  due:2026-04-30',
        '- [ ] c  due:2026-05-01',
        '- [ ] d nodate'
      ].join('\n')
    )
    const buckets = bucketTasksByDueDate(all)
    expect(buckets.get('2026-04-30')?.length).toBe(2)
    expect(buckets.get('2026-05-01')?.length).toBe(1)
    expect(buckets.get('unscheduled')?.length).toBe(1)
  })

  it('drops checked + waiting tasks', () => {
    const all = tasks(
      [
        '- [x] done  due:2026-04-30',
        '- [ ] waiting  due:2026-04-30 @waiting',
        '- [ ] live  due:2026-04-30'
      ].join('\n')
    )
    const buckets = bucketTasksByDueDate(all)
    expect(buckets.get('2026-04-30')?.length).toBe(1)
  })
})

describe('buildTaskDigest', () => {
  const today = new Date(2026, 3, 30) // 2026-04-30, local
  it('counts due-today and overdue', () => {
    const all = tasks(
      [
        '- [ ] today  due:2026-04-30',
        '- [ ] also-today  due:2026-04-30',
        '- [ ] overdue  due:2026-04-29',
        '- [ ] way-overdue  due:2026-01-15',
        '- [ ] future  due:2026-05-15',
        '- [x] done  due:2026-04-30',
        '- [ ] waiting  due:2026-04-30 @waiting',
        '- [ ] no-date'
      ].join('\n')
    )
    const digest = buildTaskDigest(all, today)
    expect(digest.dueToday).toBe(2)
    expect(digest.overdue).toBe(2)
    expect(digest.total).toBe(4)
  })

  it('returns zeros when nothing matches', () => {
    const all = tasks(['- [ ] no-date', '- [ ] future  due:2026-12-25'].join('\n'))
    expect(buildTaskDigest(all, today)).toEqual({ dueToday: 0, overdue: 0, total: 0 })
  })
})
