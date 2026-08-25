import { useCallback, useEffect, useState, type FormEvent, type RefObject } from 'react'
import { message } from 'antd'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { Chapter } from '../../../types'
import { countChapterWords, normalizeEditorText } from './useChapterEditor'
import { createChapterSaveCoordinator } from './chapter-save-coordinator'
import { persistWritingChapter, type WritingChapterVersionSource } from './writing-editor-lifecycle'

interface UseWritingEditorLifecycleInput {
  currentChapter: Chapter | null
  content: string
  editorRef: RefObject<HTMLDivElement>
  currentChapterIdRef: { current: number | null }
  applyEditorInput(text: string): string
  commitContentState(text: string): string
  syncEditorSelection(disabled?: boolean): void
  undoEditor(disabled?: boolean): string | null
  redoEditor(disabled?: boolean): string | null
  updateChapter(chapterId: number, changes: Partial<Chapter>): void
  refreshContextStatus(): Promise<void>
  refreshPublishCheck(chapterId: number): Promise<void>
  registerSaveHandler(handler: (() => void) | null): void
  clearChapterArtifacts(): void
}

export type WritingSaveState = 'saved' | 'unsaved' | 'saving' | 'error'

function useChapterPersistence(
  input: UseWritingEditorLifecycleInput,
  setCurrentSaveState: (chapterId: number, state: WritingSaveState) => void,
) {
  const { currentChapterIdRef, refreshContextStatus, refreshPublishCheck, updateChapter } = input
  const [saveCoordinator] = useState(() => createChapterSaveCoordinator())
  const persistChapter = useCallback(async (chapterId: number, text: string, versionSource: WritingChapterVersionSource = 'manual-save') => {
    setCurrentSaveState(chapterId, 'saving')
    try {
      await persistWritingChapter({
        chapterId,
        text,
        versionSource,
        isCurrentChapter: (id) => currentChapterIdRef.current === id,
        updateRemote: (id, nextText, wordCount, source) => window.electron.chapter.update(
          id,
          { content: nextText, wordCount },
          { versionSource: source },
        ),
        refreshContextStatus,
        refreshPublishCheck,
        updateStore: (id, nextText, wordCount) => updateChapter(id, { content: nextText, wordCount }),
      })
      setCurrentSaveState(chapterId, 'saved')
    } catch (error) {
      setCurrentSaveState(chapterId, 'error')
      throw error
    }
  }, [currentChapterIdRef, refreshContextStatus, refreshPublishCheck, setCurrentSaveState, updateChapter])
  const saveNow = useCallback((chapterId: number, text: string, versionSource: WritingChapterVersionSource = 'manual-save') => (
    saveCoordinator.runNow(chapterId, () => persistChapter(chapterId, text, versionSource))
  ), [persistChapter, saveCoordinator])
  const queueSave = useCallback((chapterId: number, text: string, versionSource: WritingChapterVersionSource = 'manual-save') => {
    setCurrentSaveState(chapterId, 'unsaved')
    saveCoordinator.schedule(chapterId, () => persistChapter(chapterId, text, versionSource))
  }, [persistChapter, saveCoordinator, setCurrentSaveState])
  return { queueSave, saveCoordinator, saveNow }
}

function useEditorMutations(input: UseWritingEditorLifecycleInput, queueSave: ReturnType<typeof useChapterPersistence>['queueSave']) {
  const {
    applyEditorInput,
    commitContentState,
    content,
    currentChapter,
    editorRef,
    redoEditor,
    syncEditorSelection,
    undoEditor,
    updateChapter,
  } = input
  const handleContentChange = useCallback((event: FormEvent<HTMLDivElement>) => {
    if ((currentChapter?.segmentCount || 0) > 1) return
    const text = applyEditorInput(event.currentTarget.innerText || '')
    if (currentChapter) queueSave(currentChapter.id, text)
  }, [applyEditorInput, currentChapter, queueSave])
  const syncSelectedSnippet = useCallback(() => {
    syncEditorSelection((currentChapter?.segmentCount || 0) > 1)
  }, [currentChapter?.segmentCount, syncEditorSelection])
  const applyChapterContent = useCallback((nextText: string, versionSource: WritingChapterVersionSource = 'manual-save') => {
    const normalized = commitContentState(nextText)
    if (!currentChapter) return
    queueSave(currentChapter.id, normalized, versionSource)
    updateChapter(currentChapter.id, { content: normalized, wordCount: countChapterWords(normalized) })
  }, [commitContentState, currentChapter, queueSave, updateChapter])
  const handleUndoEditor = useCallback(() => {
    const previous = undoEditor((currentChapter?.segmentCount || 0) > 1)
    if (previous === null || !currentChapter) return
    queueSave(currentChapter.id, previous)
    updateChapter(currentChapter.id, { content: previous, wordCount: countChapterWords(previous) })
  }, [currentChapter, queueSave, undoEditor, updateChapter])
  const handleRedoEditor = useCallback(() => {
    const next = redoEditor((currentChapter?.segmentCount || 0) > 1)
    if (next === null || !currentChapter) return
    queueSave(currentChapter.id, next)
    updateChapter(currentChapter.id, { content: next, wordCount: countChapterWords(next) })
  }, [currentChapter, queueSave, redoEditor, updateChapter])
  const getEditorText = useCallback(() => normalizeEditorText(editorRef.current?.innerText || content), [content, editorRef])
  return { applyChapterContent, getEditorText, handleContentChange, handleRedoEditor, handleUndoEditor, syncSelectedSnippet }
}

function useEditorLifecycleEffects(
  input: UseWritingEditorLifecycleInput,
  saveCoordinator: ReturnType<typeof useChapterPersistence>['saveCoordinator'],
  handleSaveCurrentChapter: () => void,
  handleUndoEditor: () => void,
  handleRedoEditor: () => void,
  hasUnsavedChanges: boolean,
) {
  const { clearChapterArtifacts, currentChapter, registerSaveHandler } = input
  useEffect(() => {
    registerSaveHandler(handleSaveCurrentChapter)
    return () => registerSaveHandler(null)
  }, [handleSaveCurrentChapter, registerSaveHandler])
  useEffect(() => () => {
    void saveCoordinator.flushAll().catch((error) => {
      console.error('Failed to flush pending chapter saves', error)
    })
    clearChapterArtifacts()
  }, [clearChapterArtifacts, saveCoordinator])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((currentChapter?.segmentCount || 0) > 1 || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        handleUndoEditor()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        handleRedoEditor()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentChapter?.segmentCount, handleRedoEditor, handleUndoEditor])
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])
}

export function useWritingEditorLifecycle(input: UseWritingEditorLifecycleInput) {
  const { content, currentChapter, editorRef } = input
  const [saveRecord, setSaveRecord] = useState<{ chapterId: number; state: WritingSaveState } | null>(null)
  const setCurrentSaveState = useCallback((chapterId: number, state: WritingSaveState) => {
    setSaveRecord({ chapterId, state })
  }, [])
  const { queueSave, saveCoordinator, saveNow } = useChapterPersistence(input, setCurrentSaveState)
  const editor = useEditorMutations(input, queueSave)
  const saveState = saveRecord && currentChapter && saveRecord.chapterId === currentChapter.id ? saveRecord.state : 'saved'
  const hasUnsavedChanges = saveState !== 'saved'
  const handleSaveCurrentChapter = useCallback(async () => {
    if (!currentChapter || (currentChapter.segmentCount || 0) > 1) return false
    const latestText = normalizeEditorText(editorRef.current?.innerText || content)
    try {
      await saveNow(currentChapter.id, latestText)
      message.success(getUserFacingMessage('writing.saved'))
      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'writing.saveFailed'))
      return false
    }
  }, [content, currentChapter, editorRef, saveNow])
  useEditorLifecycleEffects(
    input,
    saveCoordinator,
    handleSaveCurrentChapter,
    editor.handleUndoEditor,
    editor.handleRedoEditor,
    hasUnsavedChanges,
  )
  return {
    queueSave,
    saveCoordinator,
    saveNow,
    saveState,
    hasUnsavedChanges,
    ...editor,
    handleSaveCurrentChapter,
  }
}
