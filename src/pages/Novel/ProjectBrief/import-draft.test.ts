import { describe, expect, it } from 'vitest'
import { assertDraftContextCurrent, parseImportableProjectBriefDraft } from './import-draft'

describe('project brief external draft import', () => {
  it('accepts only filled known fields and never clears existing values', () => {
    expect(parseImportableProjectBriefDraft(JSON.stringify({
      reader_promise: '每章都能看到主角作出选择并承担后果',
      target_reader: '',
      unknown_field: '忽略',
      platform_mode: 'not-a-platform',
    }))).toEqual({ readerPromise: '每章都能看到主角作出选择并承担后果' })
  })

  it('rejects malformed or empty imported drafts', () => {
    expect(() => parseImportableProjectBriefDraft('not json')).toThrow('有效 JSON')
    expect(() => parseImportableProjectBriefDraft('{"random":"value"}')).toThrow('没有可回填')
  })

  it('blocks an imported draft after the project context changes', () => {
    expect(() => assertDraftContextCurrent(2, 3)).toThrow('旧版项目资料')
    expect(() => assertDraftContextCurrent(3, 3)).not.toThrow()
  })
})
