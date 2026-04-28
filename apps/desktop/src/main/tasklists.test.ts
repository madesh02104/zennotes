import { describe, expect, it } from 'vitest'
import {
  setTaskCheckedAtIndex,
  setTaskPriorityAtIndex,
  setTaskWaitingAtIndex,
  toggleTaskAtIndex
} from '@shared/tasklists'

describe('toggleTaskAtIndex', () => {
  it('checks the right task by index', () => {
    const md = ['- [ ] a', '- [ ] b', '- [ ] c'].join('\n')
    expect(toggleTaskAtIndex(md, 1, true)).toBe(['- [ ] a', '- [x] b', '- [ ] c'].join('\n'))
  })

  it('skips fenced code blocks', () => {
    const md = ['- [ ] a', '```', '- [ ] inside', '```', '- [ ] b'].join('\n')
    // index 1 is the second OUTSIDE task ("b"), not the one inside the fence
    const next = toggleTaskAtIndex(md, 1, true)
    expect(next).toBe(['- [ ] a', '```', '- [ ] inside', '```', '- [x] b'].join('\n'))
  })

  it('returns markdown unchanged when index is out of range', () => {
    const md = '- [ ] only one'
    expect(toggleTaskAtIndex(md, 5, true)).toBe(md)
  })
})

describe('setTaskCheckedAtIndex', () => {
  it('is an alias for toggleTaskAtIndex', () => {
    const md = '- [ ] a'
    expect(setTaskCheckedAtIndex(md, 0, true)).toBe('- [x] a')
    expect(setTaskCheckedAtIndex('- [x] a', 0, false)).toBe('- [ ] a')
  })
})

describe('setTaskWaitingAtIndex', () => {
  it('appends @waiting when not present', () => {
    expect(setTaskWaitingAtIndex('- [ ] a', 0, true)).toBe('- [ ] a @waiting')
  })

  it('does nothing when @waiting is already there', () => {
    const md = '- [ ] a @waiting'
    expect(setTaskWaitingAtIndex(md, 0, true)).toBe(md)
  })

  it('removes @waiting and tidies whitespace', () => {
    expect(setTaskWaitingAtIndex('- [ ] a @waiting', 0, false)).toBe('- [ ] a')
    expect(setTaskWaitingAtIndex('- [ ] a @waiting due:2026-04-30', 0, false)).toBe(
      '- [ ] a due:2026-04-30'
    )
  })

  it('does nothing when @waiting is absent and waiting=false', () => {
    const md = '- [ ] a'
    expect(setTaskWaitingAtIndex(md, 0, false)).toBe(md)
  })

  it('only touches the indexed task', () => {
    const md = ['- [ ] a', '- [ ] b'].join('\n')
    expect(setTaskWaitingAtIndex(md, 1, true)).toBe(['- [ ] a', '- [ ] b @waiting'].join('\n'))
  })
})

describe('setTaskPriorityAtIndex', () => {
  it('appends a priority token when none is set', () => {
    expect(setTaskPriorityAtIndex('- [ ] a', 0, 'high')).toBe('- [ ] a !high')
  })

  it('replaces an existing priority token', () => {
    expect(setTaskPriorityAtIndex('- [ ] a !med', 0, 'high')).toBe('- [ ] a !high')
    expect(setTaskPriorityAtIndex('- [ ] !low a', 0, 'high')).toBe('- [ ] a !high')
  })

  it('removes the priority token when priority=null', () => {
    expect(setTaskPriorityAtIndex('- [ ] a !high', 0, null)).toBe('- [ ] a')
    expect(setTaskPriorityAtIndex('- [ ] a !high due:2026-04-30', 0, null)).toBe(
      '- [ ] a due:2026-04-30'
    )
  })

  it('handles short alias forms (h/m/l)', () => {
    expect(setTaskPriorityAtIndex('- [ ] a !h', 0, 'low')).toBe('- [ ] a !low')
  })

  it('does not match priority-like substrings inside content', () => {
    // `!medical` should NOT be treated as a `!med` token (word boundary).
    expect(setTaskPriorityAtIndex('- [ ] !medical record', 0, 'high')).toBe(
      '- [ ] !medical record !high'
    )
  })

  it('only touches the indexed task', () => {
    const md = ['- [ ] a !high', '- [ ] b'].join('\n')
    expect(setTaskPriorityAtIndex(md, 1, 'med')).toBe(['- [ ] a !high', '- [ ] b !med'].join('\n'))
  })
})
