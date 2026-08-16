import { useCallback, useRef, useState } from 'react'

export interface TextSelectionSnapshot {
  start: number
  end: number
  text: string
}

export const countChapterWords = (text: string) => (
  (text.match(/[一-龥]/g) || []).length
  + (text.match(/\b[a-zA-Z]+\b/g) || []).length
)

export function normalizeEditorText(value?: string | null): string {
  return (value || '').replace(/\r\n/g, '\n')
}

function writePlainEditorText(element: HTMLElement | null, value?: string | null) {
  if (!element) return
  element.textContent = normalizeEditorText(value)
}

function getSelectionSnapshot(container: HTMLElement): TextSelectionSnapshot | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null

  const prefixRange = range.cloneRange()
  prefixRange.selectNodeContents(container)
  prefixRange.setEnd(range.startContainer, range.startOffset)

  const rawText = normalizeEditorText(range.toString())
  const text = rawText.trim()
  if (!text) return null

  const leadingTrimmed = rawText.length - rawText.trimStart().length
  const start = normalizeEditorText(prefixRange.toString()).length + leadingTrimmed
  return { start, end: start + text.length, text }
}

export interface ChapterEditorHistory {
  reset(text: string, now?: number): void
  record(text: string, now?: number): void
  adopt(text: string, now?: number): void
  undo(currentText: string): string | null
  redo(currentText: string): string | null
}

export function createChapterEditorHistory(): ChapterEditorHistory {
  let undoStack: string[] = []
  let redoStack: string[] = []
  let baseline = ''
  let lastHistoryAt = 0

  const adopt = (text: string, now = Date.now()) => {
    baseline = normalizeEditorText(text)
    lastHistoryAt = now
  }

  return {
    reset(text, now = Date.now()) {
      undoStack = []
      redoStack = []
      adopt(text, now)
    },
    record(text, now = Date.now()) {
      const normalized = normalizeEditorText(text)
      if (normalized === baseline) return
      const shouldCommit = !baseline
        || (now - lastHistoryAt) > 700
        || Math.abs(normalized.length - baseline.length) > 120
      if (shouldCommit && baseline) undoStack = [...undoStack.slice(-59), baseline]
      baseline = normalized
      lastHistoryAt = now
      redoStack = []
    },
    adopt,
    undo(currentText) {
      const previous = undoStack.pop()
      if (typeof previous !== 'string') return null
      redoStack = [...redoStack, normalizeEditorText(currentText)]
      adopt(previous)
      return previous
    },
    redo(currentText) {
      const next = redoStack.pop()
      if (typeof next !== 'string') return null
      undoStack = [...undoStack, normalizeEditorText(currentText)]
      adopt(next)
      return next
    },
  }
}

/**
 * Owns the editor DOM, text state, selection and bounded undo/redo history.
 * Persistence stays with the workspace controller so chapter switching can
 * continue to use the single chapter-save coordinator.
 */
export function useChapterEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef(createChapterEditorHistory())
  const [content, setContent] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [selectedSnippet, setSelectedSnippet] = useState<TextSelectionSnapshot | null>(null)

  const resetHistory = useCallback((nextText: string) => {
    historyRef.current.reset(nextText)
  }, [])

  const recordInput = useCallback((nextText: string) => {
    historyRef.current.record(nextText)
  }, [])

  const commitContentState = useCallback((nextText: string) => {
    const normalized = normalizeEditorText(nextText)
    setContent(normalized)
    setWordCount(countChapterWords(normalized))
    setSelectedSnippet(null)
    writePlainEditorText(editorRef.current, normalized)
    historyRef.current.adopt(normalized)
    return normalized
  }, [])

  const loadContent = useCallback((nextText: string) => {
    const normalized = commitContentState(nextText)
    resetHistory(normalized)
  }, [commitContentState, resetHistory])

  const applyInput = useCallback((nextText: string) => {
    recordInput(nextText)
    const normalized = normalizeEditorText(nextText)
    setContent(normalized)
    setWordCount(countChapterWords(normalized))
    return normalized
  }, [recordInput])

  const syncSelection = useCallback((disabled = false) => {
    if (disabled || !editorRef.current) {
      setSelectedSnippet(null)
      return
    }
    setSelectedSnippet(getSelectionSnapshot(editorRef.current))
  }, [])

  const undo = useCallback((disabled = false): string | null => {
    if (disabled) return null
    const previous = historyRef.current.undo(editorRef.current?.innerText || content)
    if (previous === null) return null
    return commitContentState(previous)
  }, [commitContentState, content])

  const redo = useCallback((disabled = false): string | null => {
    if (disabled) return null
    const next = historyRef.current.redo(editorRef.current?.innerText || content)
    if (next === null) return null
    return commitContentState(next)
  }, [commitContentState, content])

  return {
    editorRef,
    content,
    wordCount,
    selectedSnippet,
    setSelectedSnippet,
    resetHistory,
    loadContent,
    applyInput,
    commitContentState,
    syncSelection,
    undo,
    redo,
  }
}
