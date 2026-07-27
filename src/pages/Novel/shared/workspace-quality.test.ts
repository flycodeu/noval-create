import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFallbackWorkspaceQualityAdapter } from './workspace-quality'

describe('workspace quality writing snapshot adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores summary after content because content writes invalidate derived fields', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electron: { chapter: { update } } })
    const adapter = getFallbackWorkspaceQualityAdapter('writing')
    if (!adapter?.applySnapshot) throw new Error('writing snapshot adapter is unavailable')

    await adapter.applySnapshot(
      {},
      { fields: { title: '恢复标题', outline: '恢复大纲', content: '恢复正文', summary: '恢复摘要', targetWords: 1200 } },
      { novelId: 1, currentNovel: null, currentChapter: { id: 7, title: '旧标题', targetWords: 900 } as never },
    )

    expect(update).toHaveBeenNthCalledWith(1, 7, {
      title: '恢复标题',
      outline: '恢复大纲',
      content: '恢复正文',
      emotionTone: '',
      targetWords: 1200,
    })
    expect(update).toHaveBeenNthCalledWith(2, 7, { summary: '恢复摘要' })
  })
})
