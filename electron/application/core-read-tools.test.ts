import { describe, expect, it } from 'vitest'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { registerCoreReadTools, type CoreReadToolDependencies } from './core-read-tools'
import { AgentToolRegistry } from './tool-registry'

const dependencies: CoreReadToolDependencies = {
  listProjects: () => [{
    id: 1,
    title: '雾城档案',
    synopsis: '调查一份被篡改的旧档案。',
    genreId: 2,
    genreName: '悬疑',
    launchMode: 'professional_longform',
    status: 'draft',
    totalWords: 12000,
    targetWords: 300000,
    contextVersion: 7,
    updatedAt: '2026-07-11T00:00:00.000Z',
  }],
  getProject: (novelId) => novelId === 1 ? {
    id: 1,
    title: '雾城档案',
    synopsis: '调查一份被篡改的旧档案。',
    genreId: 2,
    genreName: '悬疑',
    status: 'draft',
    totalWords: 12000,
    targetWords: 300000,
    contextVersion: 7,
    userBackground: '主角在档案馆发现异常。',
    expandedBackground: '旧城失踪案与档案篡改互相咬合。',
    projectBriefJson: '{}',
    worldRulesJson: '{}',
  } : null,
  listCharacters: (novelId) => novelId === 1 ? [{
    id: 10,
    novelId: 1,
    fullName: '林雾',
    roleType: 'protagonist',
    recordStatus: 'confirmed',
    occupation: '档案修复员',
    goals: '找出篡改者。',
    surfaceDesire: '保住工作。',
    deepNeed: '承认自己也曾逃避真相。',
    contextVersion: 7,
  } as never] : [],
  getTask: (taskId) => taskId === 99 ? {
    id: 99,
    novelId: 1,
    type: 'character_auto_generate',
    status: 'running',
    runnerType: 'workflow',
    retryable: 1,
    tokensUsed: 400,
    durationMs: 1200,
    progressJson: JSON.stringify({ currentBatch: 1, totalBatches: 3 }),
  } : null,
}

function createRegistry() {
  return registerCoreReadTools(new AgentToolRegistry(), dependencies)
}

function context(scopes: string[]) {
  return {
    actor: { type: 'human' as const, actorId: 'tester', clientId: 'vitest' },
    scopes,
    correlationId: 'core-read-run',
  }
}

describe('core NovelForge read tools', () => {
  it('publishes five stable, read-only capabilities', () => {
    const descriptors = createRegistry().list()
    expect(descriptors.map((tool) => tool.id)).toEqual([
      'novelforge.capabilities.list',
      'novelforge.characters.list',
      'novelforge.projects.get',
      'novelforge.projects.list',
      'novelforge.runs.get',
    ])
    expect(descriptors.every((tool) => tool.effect === 'read' && tool.idempotent)).toBe(true)
  })

  it('discovers tools through the capability tool itself', async () => {
    const result = await createRegistry().invoke({
      toolId: 'novelforge.capabilities.list',
      input: { domain: 'characters' },
    }, context([AGENT_TOOL_SCOPES.discover]))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatchObject({ count: 1 })
      expect((result.data as { tools: Array<{ id: string }> }).tools[0].id).toBe('novelforge.characters.list')
    }
  })

  it('returns bounded project and character context with context versions', async () => {
    const projectResult = await createRegistry().invoke({
      toolId: 'novelforge.projects.get',
      input: { novelId: 1 },
    }, context([AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead]))
    const charactersResult = await createRegistry().invoke({
      toolId: 'novelforge.characters.list',
      input: { novelId: 1, roleTypes: ['protagonist'] },
    }, context([AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead]))

    expect(projectResult.ok).toBe(true)
    if (projectResult.ok) {
      expect(projectResult.data).toMatchObject({
        project: { id: 1, contextVersion: 7, availableAssets: ['project_brief', 'world_rules'] },
      })
    }
    expect(charactersResult.ok).toBe(true)
    if (charactersResult.ok) {
      expect(charactersResult.data).toMatchObject({
        novelId: 1,
        contextVersion: 7,
        total: 1,
        returned: 1,
        characters: [{ id: 10, fullName: '林雾', roleType: 'protagonist' }],
      })
    }
  })

  it('does not expose task input or output bodies in run status', async () => {
    const result = await createRegistry().invoke({
      toolId: 'novelforge.runs.get',
      input: { taskId: 99 },
    }, context([AGENT_TOOL_SCOPES.taskRead]))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const run = (result.data as { run: Record<string, unknown> }).run
      expect(run).toMatchObject({ id: 99, status: 'running', hasOutput: false })
      expect(run).not.toHaveProperty('inputJson')
      expect(run).not.toHaveProperty('outputText')
    }
  })

  it('returns resource-not-found without leaking implementation errors', async () => {
    const result = await createRegistry().invoke({
      toolId: 'novelforge.projects.get',
      input: { novelId: 404 },
    }, context([AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead]))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', retryable: false })
  })
})
