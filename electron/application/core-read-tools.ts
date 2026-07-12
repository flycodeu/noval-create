import type {
  AgentToolDescriptor,
  AgentToolEffect,
  AgentToolJsonSchema,
  AgentToolListQuery,
} from '../../src/shared/tool-contracts'
import {
  AGENT_TOOL_SCOPES,
  isAgentToolEffect,
} from '../../src/shared/tool-contracts'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'

interface ProjectRecord {
  id: number
  title: string
  synopsis?: string | null
  genreId?: number | null
  genreName?: string | null
  launchMode?: string | null
  status?: string | null
  totalWords?: number | null
  targetWords?: number | null
  userBackground?: string | null
  expandedBackground?: string | null
  projectBriefJson?: string | null
  settingsJson?: string | null
  themeVoiceJson?: string | null
  worldRulesJson?: string | null
  contextVersion?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

interface CharacterRecord {
  id: number
  novelId: number
  roleType?: string | null
  recordStatus?: string | null
  entityType?: string | null
  species?: string | null
  fullName: string
  gender?: string | null
  age?: number | null
  occupation?: string | null
  socialIdentity?: string | null
  campFactionIdsJson?: string | null
  goals?: string | null
  surfaceDesire?: string | null
  deepNeed?: string | null
  coreFear?: string | null
  innerConflict?: string | null
  relationshipTension?: string | null
  dramaticEngine?: string | null
  characterArc?: string | null
  appearChapter?: number | null
  updatedAt?: string | null
}

interface TaskRecord {
  id: number
  novelId?: number | null
  type: string
  status?: string | null
  runnerType?: string | null
  retryable?: number | null
  parentTaskId?: number | null
  currentChildTaskId?: number | null
  pipelineRole?: string | null
  pipelineStage?: string | null
  relatedEntityType?: string | null
  relatedEntityId?: number | null
  tokensUsed?: number | null
  durationMs?: number | null
  errorMessage?: string | null
  outputText?: string | null
  progressJson?: string | null
  recoveryHintJson?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface CoreReadToolDependencies {
  listProjects: () => ProjectRecord[]
  getProject: (novelId: number) => ProjectRecord | null
  listCharacters: (novelId: number) => CharacterRecord[]
  getTask: (taskId: number) => TaskRecord | null
}

type CapabilitiesListInput = Record<string, unknown> & AgentToolListQuery
type ProjectsListInput = Record<string, unknown> & {
  status?: string
  genreId?: number
  search?: string
  limit?: number
}
type ProjectGetInput = Record<string, unknown> & { novelId: number }
type CharactersListInput = Record<string, unknown> & {
  novelId: number
  roleTypes?: string[]
  recordStatus?: 'draft' | 'confirmed' | 'all'
  search?: string
  limit?: number
}
type RunGetInput = Record<string, unknown> & { taskId: number }

const nullableString: AgentToolJsonSchema = { type: ['string', 'null'] }
const nullableInteger: AgentToolJsonSchema = { type: ['integer', 'null'] }
const positiveId: AgentToolJsonSchema = { type: 'integer', minimum: 1 }

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[],
  additionalProperties = false,
): AgentToolJsonSchema {
  return { type: 'object', properties, required, additionalProperties }
}

function createReadDescriptor(options: {
  id: string
  domain: string
  title: string
  description: string
  scopes: string[]
  inputSchema: AgentToolJsonSchema
  outputSchema: AgentToolJsonSchema
  tags: string[]
}): AgentToolDescriptor {
  return {
    ...options,
    version: '1.0.0',
    effect: 'read',
    approval: 'never',
    idempotent: true,
    taskMode: 'sync',
    timeoutClass: 'short',
  }
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toNullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function boundedText(value: unknown, maxLength: number): { value: string | null; truncated: boolean } {
  const text = toNullableString(value)
  if (!text) return { value: null, truncated: false }
  return text.length > maxLength
    ? { value: text.slice(0, maxLength), truncated: true }
    : { value: text, truncated: false }
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  }
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function parseObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function normalizeSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
}

function projectSummary(project: ProjectRecord) {
  return {
    id: project.id,
    title: project.title,
    synopsis: toNullableString(project.synopsis),
    genreId: toNullableInteger(project.genreId),
    genreName: toNullableString(project.genreName),
    launchMode: toNullableString(project.launchMode),
    status: toNullableString(project.status),
    totalWords: toNonNegativeInteger(project.totalWords),
    targetWords: toNonNegativeInteger(project.targetWords),
    contextVersion: Math.max(1, toNullableInteger(project.contextVersion) || 1),
    updatedAt: toNullableString(project.updatedAt),
  }
}

function characterSummary(character: CharacterRecord) {
  return {
    id: character.id,
    novelId: character.novelId,
    fullName: character.fullName,
    roleType: toNullableString(character.roleType) || 'minor',
    recordStatus: toNullableString(character.recordStatus) || 'confirmed',
    entityType: toNullableString(character.entityType),
    species: toNullableString(character.species),
    gender: toNullableString(character.gender),
    age: toNullableInteger(character.age),
    occupation: toNullableString(character.occupation),
    socialIdentity: toNullableString(character.socialIdentity),
    factionRefs: parseStringArray(character.campFactionIdsJson).slice(0, 20),
    goals: boundedText(character.goals, 1200).value,
    surfaceDesire: boundedText(character.surfaceDesire, 1200).value,
    deepNeed: boundedText(character.deepNeed, 1200).value,
    coreFear: boundedText(character.coreFear, 1200).value,
    innerConflict: boundedText(character.innerConflict, 1600).value,
    relationshipTension: boundedText(character.relationshipTension, 1600).value,
    dramaticEngine: boundedText(character.dramaticEngine, 1600).value,
    characterArc: boundedText(character.characterArc, 2400).value,
    appearChapter: toNullableInteger(character.appearChapter),
    updatedAt: toNullableString(character.updatedAt),
  }
}

const projectSummarySchema = objectSchema({
  id: positiveId,
  title: { type: 'string', minLength: 1 },
  synopsis: nullableString,
  genreId: nullableInteger,
  genreName: nullableString,
  launchMode: nullableString,
  status: nullableString,
  totalWords: { type: 'integer', minimum: 0 },
  targetWords: { type: 'integer', minimum: 0 },
  contextVersion: { type: 'integer', minimum: 1 },
  updatedAt: nullableString,
}, [
  'id', 'title', 'synopsis', 'genreId', 'genreName', 'launchMode', 'status',
  'totalWords', 'targetWords', 'contextVersion', 'updatedAt',
])

const characterSummarySchema = objectSchema({
  id: positiveId,
  novelId: positiveId,
  fullName: { type: 'string', minLength: 1 },
  roleType: { type: 'string', minLength: 1 },
  recordStatus: { type: 'string', minLength: 1 },
  entityType: nullableString,
  species: nullableString,
  gender: nullableString,
  age: nullableInteger,
  occupation: nullableString,
  socialIdentity: nullableString,
  factionRefs: { type: 'array', items: { type: 'string' }, maxItems: 20 },
  goals: nullableString,
  surfaceDesire: nullableString,
  deepNeed: nullableString,
  coreFear: nullableString,
  innerConflict: nullableString,
  relationshipTension: nullableString,
  dramaticEngine: nullableString,
  characterArc: nullableString,
  appearChapter: nullableInteger,
  updatedAt: nullableString,
}, [
  'id', 'novelId', 'fullName', 'roleType', 'recordStatus', 'entityType', 'species',
  'gender', 'age', 'occupation', 'socialIdentity', 'factionRefs', 'goals',
  'surfaceDesire', 'deepNeed', 'coreFear', 'innerConflict', 'relationshipTension',
  'dramaticEngine', 'characterArc', 'appearChapter', 'updatedAt',
])

export function registerCoreReadTools(
  registry: AgentToolRegistry,
  dependencies: CoreReadToolDependencies,
): AgentToolRegistry {
  registry.register<CapabilitiesListInput, { tools: AgentToolDescriptor[]; count: number }>({
    descriptor: createReadDescriptor({
      id: 'novelforge.capabilities.list',
      domain: 'capabilities',
      title: 'List NovelForge capabilities',
      description: 'Call when an agent needs to discover NovelForge tools and their exact schemas before choosing an action.',
      scopes: [AGENT_TOOL_SCOPES.discover],
      tags: ['discovery', 'tools', 'schemas'],
      inputSchema: objectSchema({
        domain: { type: 'string', maxLength: 80 },
        effect: { enum: ['read', 'draft_write', 'canonical_write', 'external_effect'] },
        search: { type: 'string', maxLength: 200 },
      }, []),
      outputSchema: objectSchema({
        tools: {
          type: 'array',
          items: objectSchema({
            id: { type: 'string' },
            version: { type: 'string' },
            domain: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
          }, ['id', 'version', 'domain', 'title', 'description'], true),
        },
        count: { type: 'integer', minimum: 0 },
      }, ['tools', 'count']),
    }),
    handler: (input) => {
      const query: AgentToolListQuery = {
        domain: typeof input.domain === 'string' ? input.domain : undefined,
        effect: isAgentToolEffect(input.effect) ? input.effect as AgentToolEffect : undefined,
        search: typeof input.search === 'string' ? input.search : undefined,
      }
      const tools = registry.list(query)
      return { tools, count: tools.length }
    },
  })

  registry.register<ProjectsListInput, { projects: ReturnType<typeof projectSummary>[]; total: number; returned: number }>({
    descriptor: createReadDescriptor({
      id: 'novelforge.projects.list',
      domain: 'projects',
      title: 'List novel projects',
      description: 'Call first when an agent needs to choose a NovelForge project without reading full project content.',
      scopes: [AGENT_TOOL_SCOPES.novelRead],
      tags: ['novels', 'projects', 'discovery'],
      inputSchema: objectSchema({
        status: { type: 'string', maxLength: 64 },
        genreId: positiveId,
        search: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      }, []),
      outputSchema: objectSchema({
        projects: { type: 'array', items: projectSummarySchema, maxItems: 200 },
        total: { type: 'integer', minimum: 0 },
        returned: { type: 'integer', minimum: 0 },
      }, ['projects', 'total', 'returned']),
    }),
    handler: (input) => {
      const search = normalizeSearch(input.search)
      const status = typeof input.status === 'string' ? input.status.trim() : ''
      const genreId = typeof input.genreId === 'number' ? input.genreId : null
      const matching = dependencies.listProjects()
        .filter((project) => !status || project.status === status)
        .filter((project) => !genreId || project.genreId === genreId)
        .filter((project) => {
          if (!search) return true
          return [project.title, project.synopsis, project.genreName]
            .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(search))
        })
      const projects = matching.slice(0, typeof input.limit === 'number' ? input.limit : 50).map(projectSummary)
      return { projects, total: matching.length, returned: projects.length }
    },
  })

  registry.register<ProjectGetInput, {
    project: ReturnType<typeof projectSummary> & {
      userBackground: string | null
      expandedBackground: string | null
      createdAt: string | null
      availableAssets: string[]
    }
    truncatedFields: string[]
  }>({
    descriptor: createReadDescriptor({
      id: 'novelforge.projects.get',
      domain: 'projects',
      title: 'Get compact project context',
      description: 'Call when an agent needs the selected novel background and content availability before planning a generation task.',
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead],
      tags: ['novel', 'background', 'context'],
      inputSchema: objectSchema({ novelId: positiveId }, ['novelId']),
      outputSchema: objectSchema({
        project: objectSchema({
          ...projectSummarySchema.properties,
          userBackground: nullableString,
          expandedBackground: nullableString,
          createdAt: nullableString,
          availableAssets: { type: 'array', items: { type: 'string' } },
        }, [
          ...(projectSummarySchema.required || []),
          'userBackground', 'expandedBackground', 'createdAt', 'availableAssets',
        ]),
        truncatedFields: { type: 'array', items: { type: 'string' } },
      }, ['project', 'truncatedFields']),
    }),
    handler: (input) => {
      const project = dependencies.getProject(input.novelId)
      if (!project) throw new AgentToolInvocationError('RESOURCE_NOT_FOUND', `Novel ${input.novelId} does not exist.`)
      const userBackground = boundedText(project.userBackground, 8000)
      const expandedBackground = boundedText(project.expandedBackground, 12000)
      const truncatedFields = [
        userBackground.truncated ? 'userBackground' : '',
        expandedBackground.truncated ? 'expandedBackground' : '',
      ].filter(Boolean)
      const availableAssets = [
        project.projectBriefJson ? 'project_brief' : '',
        project.settingsJson ? 'story_settings' : '',
        project.themeVoiceJson ? 'theme_voice' : '',
        project.worldRulesJson ? 'world_rules' : '',
      ].filter(Boolean)
      return {
        project: {
          ...projectSummary(project),
          userBackground: userBackground.value,
          expandedBackground: expandedBackground.value,
          createdAt: toNullableString(project.createdAt),
          availableAssets,
        },
        truncatedFields,
      }
    },
  })

  registry.register<CharactersListInput, {
    novelId: number
    contextVersion: number
    characters: ReturnType<typeof characterSummary>[]
    total: number
    returned: number
  }>({
    descriptor: createReadDescriptor({
      id: 'novelforge.characters.list',
      domain: 'characters',
      title: 'List character ecology',
      description: 'Call before character planning or review to inspect existing roles, motivations, tensions, and narrative functions.',
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead],
      tags: ['characters', 'cast', 'ecology', 'context'],
      inputSchema: objectSchema({
        novelId: positiveId,
        roleTypes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, maxItems: 20 },
        recordStatus: { enum: ['draft', 'confirmed', 'all'] },
        search: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      }, ['novelId']),
      outputSchema: objectSchema({
        novelId: positiveId,
        contextVersion: { type: 'integer', minimum: 1 },
        characters: { type: 'array', items: characterSummarySchema, maxItems: 200 },
        total: { type: 'integer', minimum: 0 },
        returned: { type: 'integer', minimum: 0 },
      }, ['novelId', 'contextVersion', 'characters', 'total', 'returned']),
    }),
    handler: (input) => {
      const project = dependencies.getProject(input.novelId)
      if (!project) throw new AgentToolInvocationError('RESOURCE_NOT_FOUND', `Novel ${input.novelId} does not exist.`)
      const roleTypes = new Set(Array.isArray(input.roleTypes) ? input.roleTypes : [])
      const search = normalizeSearch(input.search)
      const status = input.recordStatus || 'all'
      const matching = dependencies.listCharacters(input.novelId)
        .filter((character) => roleTypes.size === 0 || roleTypes.has(character.roleType || 'minor'))
        .filter((character) => status === 'all' || (character.recordStatus || 'confirmed') === status)
        .filter((character) => {
          if (!search) return true
          return [character.fullName, character.occupation, character.goals, character.socialIdentity]
            .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(search))
        })
      const characters = matching
        .slice(0, typeof input.limit === 'number' ? input.limit : 100)
        .map(characterSummary)
      return {
        novelId: input.novelId,
        contextVersion: Math.max(1, toNullableInteger(project.contextVersion) || 1),
        characters,
        total: matching.length,
        returned: characters.length,
      }
    },
  })

  registry.register<RunGetInput, { run: Record<string, unknown> }>({
    descriptor: createReadDescriptor({
      id: 'novelforge.runs.get',
      domain: 'runs',
      title: 'Get task run status',
      description: 'Call after a long-running NovelForge action to inspect current status, progress, recovery hints, cost, and errors.',
      scopes: [AGENT_TOOL_SCOPES.taskRead],
      tags: ['tasks', 'runs', 'progress', 'recovery'],
      inputSchema: objectSchema({ taskId: positiveId }, ['taskId']),
      outputSchema: objectSchema({
        run: objectSchema({
          id: positiveId,
          novelId: nullableInteger,
          type: { type: 'string', minLength: 1 },
          status: nullableString,
          runnerType: nullableString,
          retryable: { type: 'boolean' },
          parentTaskId: nullableInteger,
          currentChildTaskId: nullableInteger,
          pipelineRole: nullableString,
          pipelineStage: nullableString,
          relatedEntityType: nullableString,
          relatedEntityId: nullableInteger,
          tokensUsed: { type: 'integer', minimum: 0 },
          durationMs: { type: 'integer', minimum: 0 },
          errorMessage: nullableString,
          hasOutput: { type: 'boolean' },
          progress: { type: 'object', additionalProperties: true },
          recoveryHint: { type: 'object', additionalProperties: true },
          createdAt: nullableString,
          updatedAt: nullableString,
        }, [
          'id', 'novelId', 'type', 'status', 'runnerType', 'retryable', 'parentTaskId',
          'currentChildTaskId', 'pipelineRole', 'pipelineStage', 'relatedEntityType',
          'relatedEntityId', 'tokensUsed', 'durationMs', 'errorMessage', 'hasOutput',
          'progress', 'recoveryHint', 'createdAt', 'updatedAt',
        ]),
      }, ['run']),
    }),
    handler: (input) => {
      const task = dependencies.getTask(input.taskId)
      if (!task) throw new AgentToolInvocationError('RESOURCE_NOT_FOUND', `Task ${input.taskId} does not exist.`)
      return {
        run: {
          id: task.id,
          novelId: toNullableInteger(task.novelId),
          type: task.type,
          status: toNullableString(task.status),
          runnerType: toNullableString(task.runnerType),
          retryable: task.retryable === 1,
          parentTaskId: toNullableInteger(task.parentTaskId),
          currentChildTaskId: toNullableInteger(task.currentChildTaskId),
          pipelineRole: toNullableString(task.pipelineRole),
          pipelineStage: toNullableString(task.pipelineStage),
          relatedEntityType: toNullableString(task.relatedEntityType),
          relatedEntityId: toNullableInteger(task.relatedEntityId),
          tokensUsed: toNonNegativeInteger(task.tokensUsed),
          durationMs: toNonNegativeInteger(task.durationMs),
          errorMessage: boundedText(task.errorMessage, 2000).value,
          hasOutput: Boolean(task.outputText),
          progress: parseObject(task.progressJson),
          recoveryHint: parseObject(task.recoveryHintJson),
          createdAt: toNullableString(task.createdAt),
          updatedAt: toNullableString(task.updatedAt),
        },
      }
    },
  })

  return registry
}
