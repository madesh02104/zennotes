import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate
} from '@codemirror/view'

/**
 * Live-preview extension: hides markdown syntax markers on lines where
 * the cursor (or any part of the selection) does not currently live.
 *
 * Obsidian-style WYSIWYG feel. When you move off a line the `#`, `**`,
 * `[`, `](url)`, backticks, etc. fade away and the heading/bold/link
 * renders cleanly. When you land on that line again, the markers come
 * back so you can edit them.
 */

/** Node names from @lezer/markdown that correspond to syntax markers. */
const SIMPLE_HIDE = new Set([
  'EmphasisMark',
  'CodeMark',
  'LinkMark',
  'URL',
  'StrikethroughMark',
  'CodeInfo'
])

/** Marks that typically have a trailing space we also want to hide. */
const PREFIX_HIDE_WITH_SPACE = new Set(['HeaderMark', 'QuoteMark'])

const hide = Decoration.replace({})

function computeDecorations(view: EditorView): DecorationSet {
  const { state } = view

  // Every line that holds part of a selection range is "active" and
  // therefore keeps its syntax markers visible for editing.
  const activeLines = new Set<number>()
  for (const r of state.selection.ranges) {
    const fromLine = state.doc.lineAt(r.from).number
    const toLine = state.doc.lineAt(r.to).number
    for (let l = fromLine; l <= toLine; l++) activeLines.add(l)
  }

  const builder = new RangeSetBuilder<Decoration>()

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        const isPrefix = PREFIX_HIDE_WITH_SPACE.has(name)
        const isSimple = SIMPLE_HIDE.has(name)
        if (!isPrefix && !isSimple) return

        const line = state.doc.lineAt(node.from).number
        if (activeLines.has(line)) return

        let start = node.from
        let end = node.to
        if (end === start) return

        if (isPrefix) {
          // Swallow the whitespace that follows the marker so the
          // rendered line doesn't start with a visible leading space.
          const next = state.doc.sliceString(end, end + 1)
          if (next === ' ' || next === '\t') end += 1
        }

        builder.add(start, end, hide)
      }
    })
  }
  return builder.finish()
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = computeDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged
      ) {
        this.decorations = computeDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations
  }
)
