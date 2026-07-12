import type {
  CharacterNeedsAnalysisInput,
  CharacterNeedsAnalysisResult,
} from '../../src/shared/character-cast-planning'
import type { AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { CharacterCastPlanningError } from './character-cast-planner'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'

export interface CharacterPlanningToolDependencies {
  analyzeNeeds: (input: CharacterNeedsAnalysisInput) => Promise<CharacterNeedsAnalysisResult>
}

const stringArraySchema: AgentToolJsonSchema = {
  type: 'array',
  items: { type: 'string' },
}

const dimensionScoresSchema: AgentToolJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'necessity',
    'causality',
    'worldFit',
    'tension',
    'differentiation',
    'writability',
    'growthSpace',
    'entranceFeasibility',
  ],
  properties: {
    necessity: { type: 'integer', minimum: 0, maximum: 100 },
    causality: { type: 'integer', minimum: 0, maximum: 100 },
    worldFit: { type: 'integer', minimum: 0, maximum: 100 },
    tension: { type: 'integer', minimum: 0, maximum: 100 },
    differentiation: { type: 'integer', minimum: 0, maximum: 100 },
    writability: { type: 'integer', minimum: 0, maximum: 100 },
    growthSpace: { type: 'integer', minimum: 0, maximum: 100 },
    entranceFeasibility: { type: 'integer', minimum: 0, maximum: 100 },
  },
}

export const characterNeedsInputSchema: AgentToolJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['novelId'],
  properties: {
    novelId: { type: 'integer', minimum: 1 },
    scope: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['novel', 'volume'] },
        volumeId: { type: 'integer', minimum: 1 },
        lookaheadChapters: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    goals: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string', minLength: 1, maxLength: 300 },
    },
    constraints: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxNewCharacters: { type: 'integer', minimum: 0, maximum: 30 },
        allowMergeExisting: { type: 'boolean' },
        allowArchiveExisting: { type: 'boolean' },
        requiredRoleTypes: {
          type: 'array',
          maxItems: 16,
          items: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
    executionMode: {
      type: 'string',
      enum: ['fast', 'balanced', 'premium', 'review_first', 'cost_saver'],
    },
    modelConfigId: { type: 'integer', minimum: 1 },
  },
}

export const characterNeedsOutputSchema: AgentToolJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'planId',
    'taskId',
    'reviewTaskId',
    'scopeSummary',
    'existingCount',
    'priorRange',
    'recommended',
    'existingActions',
    'mergeGroups',
    'roleSlots',
    'review',
    'deterministicChecks',
    'risks',
    'assumptions',
    'contextVersion',
  ],
  properties: {
    planId: { type: 'string', minLength: 1 },
    taskId: { type: 'integer', minimum: 1 },
    reviewTaskId: { type: ['integer', 'null'] },
    scopeSummary: { type: 'string' },
    existingCount: { type: 'integer', minimum: 0 },
    priorRange: {
      type: 'object',
      additionalProperties: false,
      required: ['min', 'suggested', 'max', 'rationale'],
      properties: {
        min: { type: 'integer', minimum: 0 },
        suggested: { type: 'integer', minimum: 0 },
        max: { type: 'integer', minimum: 0 },
        rationale: { type: 'string' },
      },
    },
    recommended: {
      type: 'object',
      additionalProperties: false,
      required: ['keep', 'update', 'mergeGroups', 'create', 'archive', 'activeCastAfterCommit', 'confidence'],
      properties: {
        keep: { type: 'integer', minimum: 0 },
        update: { type: 'integer', minimum: 0 },
        mergeGroups: { type: 'integer', minimum: 0 },
        create: { type: 'integer', minimum: 0 },
        archive: { type: 'integer', minimum: 0 },
        activeCastAfterCommit: { type: 'integer', minimum: 0 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    existingActions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['characterId', 'characterName', 'action', 'rationale', 'targetedChanges'],
        properties: {
          characterId: { type: 'integer', minimum: 1 },
          characterName: { type: 'string' },
          action: { type: 'string', enum: ['keep', 'update', 'merge', 'archive'] },
          rationale: { type: 'string' },
          targetedChanges: stringArraySchema,
        },
      },
    },
    mergeGroups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['characterIds', 'characterNames', 'rationale', 'survivorCharacterId'],
        properties: {
          characterIds: { type: 'array', minItems: 2, items: { type: 'integer', minimum: 1 } },
          characterNames: stringArraySchema,
          rationale: { type: 'string' },
          survivorCharacterId: { type: 'integer', minimum: 1 },
        },
      },
    },
    roleSlots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'slotId',
          'functionKey',
          'function',
          'coverage',
          'coveredByCharacterIds',
          'mustBeIndependent',
          'independenceReason',
          'evidenceRefs',
          'proposedAction',
          'proposedRoleType',
          'firstAppearanceWindow',
          'priority',
        ],
        properties: {
          slotId: { type: 'string' },
          functionKey: { type: 'string' },
          function: { type: 'string' },
          coverage: { type: 'string', enum: ['covered', 'partial', 'missing', 'overloaded', 'redundant'] },
          coveredByCharacterIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
          mustBeIndependent: { type: 'boolean' },
          independenceReason: { type: 'string' },
          evidenceRefs: stringArraySchema,
          proposedAction: { type: 'string', enum: ['keep', 'update', 'merge', 'create', 'archive'] },
          proposedRoleType: { type: 'string' },
          firstAppearanceWindow: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    review: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'status', 'score', 'summary', 'hardBlockers', 'warnings', 'revisionSuggestions', 'dimensionScores'],
      properties: {
        mode: { type: 'string', enum: ['deterministic', 'model'] },
        status: { type: 'string', enum: ['passed', 'needs_revision', 'blocked'] },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        summary: { type: 'string' },
        hardBlockers: stringArraySchema,
        warnings: stringArraySchema,
        revisionSuggestions: stringArraySchema,
        dimensionScores: dimensionScoresSchema,
      },
    },
    deterministicChecks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'status', 'message'],
        properties: {
          code: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
          message: { type: 'string' },
        },
      },
    },
    risks: stringArraySchema,
    assumptions: stringArraySchema,
    contextVersion: { type: 'integer', minimum: 1 },
  },
}

export function registerCharacterPlanningTools(
  registry: AgentToolRegistry,
  dependencies: CharacterPlanningToolDependencies,
): AgentToolRegistry {
  return registry.register<CharacterNeedsAnalysisInput & Record<string, unknown>, CharacterNeedsAnalysisResult>({
    descriptor: {
      id: 'novelforge.characters.analyze_needs',
      version: '1.0.0',
      domain: 'characters',
      title: '分析人物需求',
      description: '依据项目上下文、现有人物与叙事功能位动态推导人物数量和调整方案，并执行独立审校；不会写入正式人物库。',
      inputSchema: characterNeedsInputSchema,
      outputSchema: characterNeedsOutputSchema,
      effect: 'read',
      approval: 'policy',
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead, AGENT_TOOL_SCOPES.draftCreate],
      idempotent: false,
      taskMode: 'app_async',
      timeoutClass: 'model',
      tags: ['character', 'cast', 'planning', 'quality-review', 'dynamic-count'],
    },
    handler: async (input) => {
      try {
        return await dependencies.analyzeNeeds(input)
      } catch (error) {
        if (error instanceof CharacterCastPlanningError) {
          throw new AgentToolInvocationError(error.code, error.message, { detail: error.detail })
        }
        throw error
      }
    },
  })
}

