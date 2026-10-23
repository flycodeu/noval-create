import { describe, expect, it } from 'vitest'
import { formatUserFacingMessage } from './user-facing-messages'
import { WORKSPACE_USER_FACING_MESSAGES } from './user-facing-messages.workspace'
import { getErrorMessage, getUserFacingMessage, isUserFacingMessage } from '../utils/user-facing-message'

describe('workspace user-facing messages', () => {
  it.each(Object.entries(WORKSPACE_USER_FACING_MESSAGES))('registers %s in the shared formatter', (key, text) => {
    const params = { field: 'draftPatch', chunk: '第 1 批', methodName: 'novel.delete', service: 'sourceSearch', method: 'test', reason: '字段不完整', preview: '{broken}' }
    expect(formatUserFacingMessage(key as keyof typeof WORKSPACE_USER_FACING_MESSAGES, params)).toBe(text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => params[name as keyof typeof params]))
  })

  it('preserves exported paths without escaping or interpreting their content', () => {
    const path = 'D:\\作品\\照夜行 {{title}}.docx'
    expect(getUserFacingMessage('novel.exportedTo', { path })).toBe(`已导出到 ${path}`)
  })

  it('keeps validation details inside the original message without interpreting field values', () => {
    const field = '作者字段 {{title}}'
    const detail = getUserFacingMessage('guidedStep.validation.draftPatchFieldUnknown', { field })
    expect(getUserFacingMessage('common.aiJsonShapeInvalid', { detail })).toBe(`AI 输出格式不符合字段要求：draftPatch 出现未要求的字段“${field}”`)
  })

  it('keeps migrated errors identifiable while preserving explicit service errors', () => {
    const error = new Error(getUserFacingMessage('workspace.manuscript.saveConflictRequiresResolution'))
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('请先处理正文保存冲突')
    expect(isUserFacingMessage(error, 'workspace.manuscript.saveConflictRequiresResolution')).toBe(true)
    expect(getErrorMessage(new Error(getUserFacingMessage('workspace.manuscript.saveFailedDraftPreserved')), 'workspace.manuscript.saveFailedCheckFeedback')).toBe('保存失败，正文仍保留在编辑器中')
    expect(getErrorMessage(null, 'workspace.manuscript.saveFailedCheckFeedback')).toBe('保存失败，请检查正文提示')
  })
})
