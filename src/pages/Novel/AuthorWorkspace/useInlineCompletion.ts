import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { InlineCompletionInput, InlineCompletionMode, InlineCompletionResult } from '../../../shared/inline-completion'
import { insertInlineCompletion } from '../../../shared/inline-completion'
import { callAuthorTool } from './workflow-client'

interface Options { novelId: number; chapterId: number; value: string; disabled: boolean; editorRef: RefObject<HTMLTextAreaElement>; onChange: (value: string) => void }
interface Suggestion { value: string; cursor: number; text: string; epoch: number }
export function useInlineCompletion({ novelId, chapterId, value, disabled, editorRef, onChange }: Options) {
  const [editorId] = useState(() => crypto.randomUUID())
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<InlineCompletionMode>('sentence')
  const [modelId, setModelId] = useState<number | undefined>()
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [undo, setUndo] = useState<{ before: string; after: string; cursor: number } | null>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const composing = useRef(false), mounted = useRef(true), epoch = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const request = useRef<InlineCompletionInput | null>(null)
  const expectedValue = useRef(value), lastAttempt = useRef(''), caret = useRef('')
  const cancelPending = useCallback(() => {
    epoch.current += 1
    clearTimeout(timer.current)
    const current = request.current
    request.current = null
    if (current) void callAuthorTool('novelforge.writing.cancel_completion', { novelId, chapterId, editorId, requestId: current.requestId }).catch(() => {})
  }, [novelId, chapterId, editorId])
  const invalidate = () => { cancelPending(); setSuggestion(null); setPending(false); setFeedback('') }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelPending() } }, [cancelPending])
  useEffect(() => {
    if (disabled || value !== expectedValue.current) {
      cancelPending()
      const invalidatedEpoch = epoch.current
      // Clear an already delivered candidate too, before an external workflow enables the editor again.
      queueMicrotask(() => { if (mounted.current) setSuggestion(current => current && current.epoch < invalidatedEpoch ? null : current) })
    }
    expectedValue.current = value
  }, [value, disabled, cancelPending])
  const schedule = (allow = enabled, nextMode = mode, nextModelId = modelId, immediate = false) => {
    clearTimeout(timer.current)
    if (!allow || disabled || composing.current) return
    timer.current = setTimeout(() => {
      const field = editorRef.current
      if (!field || document.activeElement !== field || field.selectionStart !== field.selectionEnd || composing.current) return
      const text = field.value, cursor = field.selectionStart
      const signature = JSON.stringify([text, cursor, nextMode, nextModelId])
      if (!immediate && lastAttempt.current === signature) return
      lastAttempt.current = signature
      const version = epoch.current, requestId = crypto.randomUUID()
      const input: InlineCompletionInput = { novelId, chapterId, editorId, requestId, editVersion: version, cursor,
        before: text.slice(Math.max(0, cursor - 1500), cursor), after: text.slice(cursor, cursor + 300), mode: nextMode,
        ...(nextModelId ? { modelConfigId: nextModelId } : {}) }
      request.current = input; setPending(true); setFeedback('')
      void callAuthorTool<InlineCompletionResult>('novelforge.writing.complete', { ...input }).then(result => {
        if (!mounted.current || epoch.current !== version || request.current?.requestId !== requestId) return
        if (result.requestId !== requestId || result.editVersion !== version || result.cursor !== cursor || field.value !== text || field.selectionStart !== cursor || field.selectionEnd !== cursor || document.activeElement !== field || composing.current) return
        if (!result.cancelled && result.text) setSuggestion({ value: text, cursor, text: result.text, epoch: version })
        else setFeedback(result.busy ? '模型正在处理其他任务，可稍后手动补全。' : result.cancelled ? '本轮补全已停止，可手动重试。' : '本轮没有可用建议。')
      }).catch(cause => { if (mounted.current && epoch.current === version) setFeedback(cause instanceof Error ? cause.message : '补全失败，请手动重试。') })
        .finally(() => { if (mounted.current && (!request.current || request.current.requestId === requestId)) { request.current = null; setPending(false) } })
    }, immediate ? 0 : 900)
  }
  const current = enabled && !disabled && suggestion?.value === value ? suggestion : null
  const accept = () => {
    const field = editorRef.current
    if (!current || !field || composing.current || field.selectionStart !== current.cursor || field.selectionEnd !== current.cursor) return
    const after = insertInlineCompletion(value, current.cursor, current.text)
    invalidate(); setUndo({ before: value, after, cursor: current.cursor }); expectedValue.current = after
    caret.current = `${current.cursor + current.text.length}:${current.cursor + current.text.length}`
    lastAttempt.current = JSON.stringify([after, current.cursor + current.text.length, mode, modelId])
    onChange(after)
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(current.cursor + current.text.length, current.cursor + current.text.length) })
  }
  const undoAccept = () => {
    const field = editorRef.current
    if (!undo || value !== undo.after) return
    invalidate(); expectedValue.current = undo.before; onChange(undo.before); setUndo(null)
    caret.current = `${undo.cursor}:${undo.cursor}`
    lastAttempt.current = JSON.stringify([undo.before, undo.cursor, mode, modelId])
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(undo.cursor, undo.cursor) })
  }
  return { enabled, mode, modelId, pending: enabled && !disabled && pending, feedback: enabled ? feedback : '', suggestion: current,
    canUndo: Boolean(undo && value === undo.after), accept, undoAccept,
    toggle: (next: boolean) => { invalidate(); setEnabled(next); if (next) { editorRef.current?.focus(); schedule(true) } },
    changeMode: (next: InlineCompletionMode) => { invalidate(); setMode(next) },
    changeModel: (next?: number) => { invalidate(); setModelId(next) },
    manual: () => { invalidate(); editorRef.current?.focus(); schedule(true, mode, modelId, true) },
    cancel: invalidate,
    input: (field: HTMLTextAreaElement) => { invalidate(); setUndo(null); expectedValue.current = field.value; caret.current = `${field.selectionStart}:${field.selectionEnd}`; onChange(field.value); schedule() },
    select: (field: HTMLTextAreaElement) => { const next = `${field.selectionStart}:${field.selectionEnd}`; if (next !== caret.current) { caret.current = next; invalidate(); schedule() } },
    compositionStart: () => { composing.current = true; invalidate() },
    compositionEnd: () => { composing.current = false; invalidate(); schedule() },
    keyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
      if (event.key === 'Tab' && current) { event.preventDefault(); accept() }
      else if (event.key === 'Escape') { if (current || request.current || timer.current) { event.preventDefault(); invalidate() } }
      else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && undo && value === undo.after) { event.preventDefault(); undoAccept() }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'].includes(event.key)) invalidate()
    },
  }
}
