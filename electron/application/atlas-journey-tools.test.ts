import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { queryStoryAtlas, StoryAtlasError } from '../services/story-atlas.service'
import { registerAtlasJourneyTools } from './atlas-journey-tools'
import { AgentToolRegistry } from './tool-registry'

vi.mock('../services/story-atlas.service', () => ({
  queryStoryAtlas: vi.fn(),
  StoryAtlasError: class StoryAtlasError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  },
}))

function invokeJourney() {
  const registry = new AgentToolRegistry()
  registerAtlasJourneyTools(registry)
  return registry.invoke({ toolId: 'novelforge.atlas.journey', input: { novelId: 1, fromId: 'location:1', toId: 'location:2' } }, {
    actor: { type: 'human', actorId: 'tester', clientId: 'vitest' }, scopes: [AGENT_TOOL_SCOPES.novelRead],
    requestId: 'journey-request', correlationId: 'journey-run',
  })
}

describe('atlas journey tool error boundary', () => {
  beforeEach(() => { vi.mocked(queryStoryAtlas).mockReset() })

  it('preserves declared atlas business errors', async () => {
    vi.mocked(queryStoryAtlas).mockImplementation(() => { throw new StoryAtlasError('PROJECT_NOT_FOUND', '小说项目不存在。') })
    expect(await invokeJourney()).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND', message: '小说项目不存在。', retryable: false } })
  })

  it.each(['SQLITE_BUSY', 'PROJECT_NOT_FOUND'])('redacts arbitrary coded errors even when the code is %s', async code => {
    vi.mocked(queryStoryAtlas).mockImplementation(() => {
      throw Object.assign(new Error('sqlite C:/private/novelforge.db token=private-value'), { code, detail: 'private-value', retryable: true })
    })
    const result = await invokeJourney()
    expect(result).toMatchObject({ ok: false, error: { code: 'TOOL_EXECUTION_FAILED', retryable: false } })
    expect(JSON.stringify(result)).not.toMatch(/SQLITE_BUSY|C:\/private|private-value|token=/u)
  })
})
