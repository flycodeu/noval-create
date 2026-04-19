import { contextBridge, ipcRenderer } from 'electron'
import type { CoreSettingsGenerationRequest } from '../src/shared/core-settings-generation'
import type { PremiseGenerationRequest } from '../src/shared/premise-generation'
import type { ProjectBriefGenerationRequest } from '../src/shared/project-brief-generation'
import type { StoryThreadBatchGenerateOptions } from '../src/shared/story-thread-generation'
import type { WorldRulesGenerationRequest } from '../src/shared/world-rules-generation'
import type { SubplotGenerationRequest } from '../src/shared/subplot-framework'
import type { ThemeVoiceGenerationRequest } from '../src/shared/theme-voice-generation'
import type { CharacterRelationInput, MapRelationInput, NovelCreateInput } from '../src/types'

interface IpcBridgeErrorPayload {
  code: string
  message: string
  detail?: string
}

type IpcBridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcBridgeErrorPayload }

function isIpcBridgeResult(value: unknown): value is IpcBridgeResult<unknown> {
  if (!value || typeof value !== 'object') return false
  if (!('ok' in value) || typeof (value as { ok?: unknown }).ok !== 'boolean') return false
  if ((value as { ok: boolean }).ok) return 'data' in value
  const error = (value as { error?: unknown }).error
  return Boolean(
    error
    && typeof error === 'object'
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { message?: unknown }).message === 'string',
  )
}

function toRendererError(payload: IpcBridgeErrorPayload) {
  const error = new Error(payload.message) as Error & { code?: string; detail?: string }
  error.name = 'IpcInvokeError'
  error.code = payload.code
  if (payload.detail) error.detail = payload.detail
  return error
}

async function invokeIpc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (!isIpcBridgeResult(result)) {
    return result as T
  }
  if (result.ok) {
    return result.data as T
  }
  throw toRendererError(result.error)
}

const api = {
  // Novel workspace APIs
  novel: {
    list: (filters?: unknown) => invokeIpc('novel:list', filters),
    get: (id: number) => invokeIpc('novel:get', id),
    create: (data: NovelCreateInput) => invokeIpc('novel:create', data),
    update: (id: number, data: unknown) => invokeIpc('novel:update', id, data),
    delete: (id: number) => invokeIpc('novel:delete', id),
    export: (id: number, format: string) => invokeIpc('novel:export', id, format),
    stats: (id: number) => invokeIpc('novel:stats', id),
    runConsistencyCheck: (id: number) => invokeIpc('novel:runConsistencyCheck', id),
    getStoryMemory: (id: number) => invokeIpc('novel:getStoryMemory', id),
    getWorldStateSnapshot: (id: number, upToChapterNum?: number) => invokeIpc('novel:getWorldStateSnapshot', id, upToChapterNum),
    getWorldStateLedgerSnapshot: (id: number, upToChapterNum?: number) => invokeIpc('novel:getWorldStateLedgerSnapshot', id, upToChapterNum),
    getWorldStateHistory: (novelId: number, entityType: string, entityId: number, stateKey?: string, limit?: number) =>
      invokeIpc('novel:getWorldStateHistory', novelId, entityType, entityId, stateKey, limit),
    getContextStatus: (id: number) => invokeIpc('novel:getContextStatus', id),
    getImpactSummary: (id: number) => invokeIpc('novel:getImpactSummary', id),
    listImpactEvents: (id: number) => invokeIpc('novel:listImpactEvents', id),
  },

  structure: {
    getTree: (novelId: number) => invokeIpc('structure:getTree', novelId),
    listVolumes: (novelId: number) => invokeIpc('structure:listVolumes', novelId),
    listPartsPage: (volumeId: number, page?: number, pageSize?: number) => invokeIpc('structure:listPartsPage', volumeId, page, pageSize),
    listChaptersPage: (partId: number, page?: number, pageSize?: number) => invokeIpc('structure:listChaptersPage', partId, page, pageSize),
    listSegments: (chapterId: number) => invokeIpc('structure:listSegments', chapterId),
    getSegment: (id: number) => invokeIpc('structure:getSegment', id),
    listSegmentsPage: (chapterId: number, page?: number, pageSize?: number) => invokeIpc('structure:listSegmentsPage', chapterId, page, pageSize),
    listCheckpoints: (novelId: number) => invokeIpc('structure:listCheckpoints', novelId),
    listCheckpointsPage: (filters: unknown, page?: number, pageSize?: number) => invokeIpc('structure:listCheckpointsPage', filters, page, pageSize),
    listLinkedTimelineEvents: (filters: unknown) => invokeIpc('structure:listLinkedTimelineEvents', filters),
    listLinkedTimelineEventsPage: (filters: unknown, page?: number, pageSize?: number) => invokeIpc('structure:listLinkedTimelineEventsPage', filters, page, pageSize),
    resolvePath: (filters: unknown) => invokeIpc('structure:resolvePath', filters),
    createVolume: (novelId: number, data: unknown) => invokeIpc('structure:createVolume', novelId, data),
    updateVolume: (id: number, data: unknown) => invokeIpc('structure:updateVolume', id, data),
    deleteVolume: (id: number) => invokeIpc('structure:deleteVolume', id),
    reorderVolumes: (novelId: number, orderedIds: number[]) => invokeIpc('structure:reorderVolumes', novelId, orderedIds),
    createPart: (volumeId: number, data: unknown) => invokeIpc('structure:createPart', volumeId, data),
    updatePart: (id: number, data: unknown) => invokeIpc('structure:updatePart', id, data),
    deletePart: (id: number) => invokeIpc('structure:deletePart', id),
    reorderParts: (novelId: number, operations: unknown[]) => invokeIpc('structure:reorderParts', novelId, operations),
    reorderPartsInVolume: (volumeId: number, orderedIds: number[]) => invokeIpc('structure:reorderPartsInVolume', volumeId, orderedIds),
    assignChapter: (chapterId: number, partId: number) => invokeIpc('structure:assignChapter', chapterId, partId),
    createSegment: (chapterId: number, data: unknown) => invokeIpc('structure:createSegment', chapterId, data),
    updateSegment: (id: number, data: unknown) => invokeIpc('structure:updateSegment', id, data),
    deleteSegment: (id: number) => invokeIpc('structure:deleteSegment', id),
    reorderSegments: (chapterId: number, orderedIds: number[]) => invokeIpc('structure:reorderSegments', chapterId, orderedIds),
    compileChapter: (chapterId: number) => invokeIpc('structure:compileChapter', chapterId),
    refreshCheckpoints: (novelId: number) => invokeIpc('structure:refreshCheckpoints', novelId),
    clear: (novelId: number) => invokeIpc('structure:clear', novelId),
    applyBatchPlan: (novelId: number, plan: unknown) => invokeIpc('structure:applyBatchPlan', novelId, plan),
    previewBatchEdit: (novelId: number, operations: unknown[]) => invokeIpc('structure:previewBatchEdit', novelId, operations),
    applyBatchEdit: (novelId: number, operations: unknown[]) => invokeIpc('structure:applyBatchEdit', novelId, operations),
  },

  endgameAsset: {
    listCommitments: (novelId: number) => invokeIpc('endgameAsset:listCommitments', novelId),
    getSummary: (novelId: number) => invokeIpc('endgameAsset:getSummary', novelId),
    syncFromSettings: (novelId: number, settingsJson?: string | null) => invokeIpc('endgameAsset:syncFromSettings', novelId, settingsJson),
    updateCommitment: (id: number, data: unknown) => invokeIpc('endgameAsset:updateCommitment', id, data),
  },

  foreshadow: {
    listLedger: (novelId: number) => invokeIpc('foreshadow:listLedger', novelId),
    upsertLedger: (novelId: number, data: unknown) => invokeIpc('foreshadow:upsertLedger', novelId, data),
    deleteLedger: (novelId: number, id: number) => invokeIpc('foreshadow:deleteLedger', novelId, id),
  },

  volumeDesign: {
    list: (novelId: number) => invokeIpc('volumeDesign:list', novelId),
    getByVolume: (volumeId: number) => invokeIpc('volumeDesign:getByVolume', volumeId),
    upsert: (volumeId: number, data: unknown) => invokeIpc('volumeDesign:upsert', volumeId, data),
    auditVolume: (volumeId: number, options?: unknown) => invokeIpc('volumeDesign:auditVolume', volumeId, options),
    syncConstraints: (volumeId: number) => invokeIpc('volumeDesign:syncConstraints', volumeId),
  },

  contract: {
    getChapter: (chapterId: number) => invokeIpc('contract:getChapter', chapterId),
    upsertChapter: (chapterId: number, data: unknown) => invokeIpc('contract:upsertChapter', chapterId, data),
    listScenes: (chapterId: number) => invokeIpc('contract:listScenes', chapterId),
    upsertScene: (chapterId: number, segmentId: number | null, data: unknown) => invokeIpc('contract:upsertScene', chapterId, segmentId, data),
  },

  storyFact: {
    list: (novelId: number) => invokeIpc('storyFact:list', novelId),
    get: (id: number) => invokeIpc('storyFact:get', id),
    create: (novelId: number, data: unknown) => invokeIpc('storyFact:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('storyFact:update', id, data),
    delete: (id: number) => invokeIpc('storyFact:delete', id),
  },

  growthSystem: {
    getDashboard: (novelId: number) => invokeIpc('growthSystem:getDashboard', novelId),
    listTracks: (novelId: number) => invokeIpc('growthSystem:listTracks', novelId),
    upsertTrack: (novelId: number, data: unknown) => invokeIpc('growthSystem:upsertTrack', novelId, data),
    deleteTrack: (novelId: number, id: number) => invokeIpc('growthSystem:deleteTrack', novelId, id),
    listPools: (novelId: number) => invokeIpc('growthSystem:listPools', novelId),
    upsertPool: (novelId: number, data: unknown) => invokeIpc('growthSystem:upsertPool', novelId, data),
    deletePool: (novelId: number, id: number) => invokeIpc('growthSystem:deletePool', novelId, id),
    listEvents: (novelId: number) => invokeIpc('growthSystem:listEvents', novelId),
    upsertEvent: (novelId: number, data: unknown) => invokeIpc('growthSystem:upsertEvent', novelId, data),
    deleteEvent: (novelId: number, id: number) => invokeIpc('growthSystem:deleteEvent', novelId, id),
    bindChapterContract: (novelId: number, data: unknown) => invokeIpc('growthSystem:bindChapterContract', novelId, data),
    bindVolumeDesign: (novelId: number, data: unknown) => invokeIpc('growthSystem:bindVolumeDesign', novelId, data),
  },

  characterArc: {
    listCharacterArcs: (novelId: number) => invokeIpc('characterArc:listCharacterArcs', novelId),
    getCharacterArc: (arcId: number) => invokeIpc('characterArc:getCharacterArc', arcId),
    upsertCharacterArc: (data: unknown) => invokeIpc('characterArc:upsertCharacterArc', data),
    upsertCharacterArcBeat: (data: unknown) => invokeIpc('characterArc:upsertCharacterArcBeat', data),
    listRelationshipArcs: (novelId: number) => invokeIpc('characterArc:listRelationshipArcs', novelId),
    upsertRelationshipArc: (data: unknown) => invokeIpc('characterArc:upsertRelationshipArc', data),
    getArcDashboard: (novelId: number) => invokeIpc('characterArc:getArcDashboard', novelId),
  },

  resistance: {
    listTracks: (novelId: number) => invokeIpc('resistance:listTracks', novelId),
    getTrack: (trackId: number) => invokeIpc('resistance:getTrack', trackId),
    upsertTrack: (data: unknown) => invokeIpc('resistance:upsertTrack', data),
    upsertBeat: (data: unknown) => invokeIpc('resistance:upsertBeat', data),
    getDashboard: (novelId: number) => invokeIpc('resistance:getDashboard', novelId),
  },

  // Chapter APIs
  chapter: {
    list: (novelId: number) => invokeIpc('chapter:list', novelId),
    get: (id: number) => invokeIpc('chapter:get', id),
    create: (novelId: number, data: unknown) => invokeIpc('chapter:create', novelId, data),
    update: (id: number, data: unknown, options?: unknown) => invokeIpc('chapter:update', id, data, options),
    delete: (id: number) => invokeIpc('chapter:delete', id),
    listVersions: (chapterId: number) => invokeIpc('chapter:listVersions', chapterId),
    restoreVersion: (versionId: number) => invokeIpc('chapter:restoreVersion', versionId),
    batchUpdate: (ids: number[], data: unknown) => invokeIpc('chapter:batchUpdate', ids, data),
    batchDelete: (ids: number[]) => invokeIpc('chapter:batchDelete', ids),
    batchRenumber: (ids: number[], startChapterNum: number) => invokeIpc('chapter:batchRenumber', ids, startChapterNum),
    getContextPreview: (chapterId: number, options?: { executionMode?: import('../src/shared/ai-execution').AiExecutionMode }) => invokeIpc('chapter:getContextPreview', chapterId, options),
    generateContent: (chapterId: number, options?: { executionMode?: import('../src/shared/ai-execution').AiExecutionMode }) => invokeIpc('chapter:generateContent', chapterId, options),
    resumeContent: (taskId: number) => invokeIpc('chapter:resumeContent', taskId),
    generateSummary: (chapterId: number) => invokeIpc('chapter:generateSummary', chapterId),
    aiCheck: (chapterId: number) => invokeIpc('chapter:aiCheck', chapterId),
    runPublishCheck: (chapterId: number) => invokeIpc('chapter:runPublishCheck', chapterId),
  },

  chapterBatch: {
    startAutoGenerate: (novelId: number, options: unknown) => invokeIpc('chapterBatch:startAutoGenerate', novelId, options),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('chapterBatch:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('chapterBatch:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number) => invokeIpc('chapterBatch:resumeAutoGenerate', taskId),
  },

  batchWorkbench: {
    getData: (novelId: number, snapshotId?: number) => invokeIpc('batchWorkbench:getData', novelId, snapshotId),
    createInspection: (snapshotId: number, data: unknown) => invokeIpc('batchWorkbench:createInspection', snapshotId, data),
    previewRollback: (snapshotId: number, mode: string) => invokeIpc('batchWorkbench:previewRollback', snapshotId, mode),
    applyRollback: (snapshotId: number, mode: string) => invokeIpc('batchWorkbench:applyRollback', snapshotId, mode),
    getGlobalLockLibrary: (novelId: number) => invokeIpc('batchWorkbench:getGlobalLockLibrary', novelId),
    updateGlobalLockLibrary: (novelId: number, patch: unknown) => invokeIpc('batchWorkbench:updateGlobalLockLibrary', novelId, patch),
  },

  writeback: {
    prepareRun: (chapterId: number, triggerSource?: string) => invokeIpc('writeback:prepareRun', chapterId, triggerSource),
    getCenterData: (chapterId: number, runId?: number) => invokeIpc('writeback:getCenterData', chapterId, runId),
    listRuns: (chapterId: number) => invokeIpc('writeback:listRuns', chapterId),
    updateDecision: (diffId: number, patch: unknown) => invokeIpc('writeback:updateDecision', diffId, patch),
    bulkUpdateDecisions: (runId: number, patch: unknown) => invokeIpc('writeback:bulkUpdateDecisions', runId, patch),
    applyRun: (runId: number) => invokeIpc('writeback:applyRun', runId),
    retryFailed: (runId: number) => invokeIpc('writeback:retryFailed', runId),
  },

  // Character APIs
  character: {
    list: (novelId: number) => invokeIpc('character:list', novelId),
    query: (filters: unknown) => invokeIpc('character:query', filters),
    getStats: (filters: unknown) => invokeIpc('character:getStats', filters),
    getFilterOptions: (novelId: number) => invokeIpc('character:getFilterOptions', novelId),
    get: (id: number) => invokeIpc('character:get', id),
    search: (novelId: number, keyword?: string, limit?: number) => invokeIpc('character:search', novelId, keyword, limit),
    getGraph: (filters: unknown) => invokeIpc('character:getGraph', filters),
    getDetailContext: (characterId: number) => invokeIpc('character:getDetailContext', characterId),
    create: (novelId: number, data: unknown) => invokeIpc('character:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('character:update', id, data),
    delete: (id: number) => invokeIpc('character:delete', id),
    regenerate: (id: number) => invokeIpc('character:regenerate', id),
    batchGenerate: (novelId: number, opts: unknown) => invokeIpc('character:batchGenerate', novelId, opts),
    startAutoGenerate: (novelId: number, opts: unknown) => invokeIpc('character:startAutoGenerate', novelId, opts),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('character:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('character:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number) => invokeIpc('character:resumeAutoGenerate', taskId),
    generateProtagonist: (novelId: number, opts: unknown) => invokeIpc('character:generateProtagonist', novelId, opts),
    getRelations: (novelId: number) => invokeIpc('character:getRelations', novelId),
    generateRelations: (novelId: number) => invokeIpc('character:generateRelations', novelId),
    upsertRelation: (data: CharacterRelationInput) => invokeIpc('character:upsertRelation', data),
    clear: (novelId: number) => invokeIpc('character:clear', novelId),
  },

  // Map APIs
  map: {
    getTree: (novelId: number) => invokeIpc('map:getTree', novelId),
    queryNodes: (filters: unknown) => invokeIpc('map:queryNodes', filters),
    getGraph: (filters: unknown) => invokeIpc('map:getGraph', filters),
    getRelations: (novelId: number, focusNodeId?: number) => invokeIpc('map:getRelations', novelId, focusNodeId),
    getStats: (novelId: number) => invokeIpc('map:getStats', novelId),
    getNode: (id: number) => invokeIpc('map:getNode', id),
    searchNodes: (novelId: number, keyword?: string, limit?: number) => invokeIpc('map:searchNodes', novelId, keyword, limit),
    create: (novelId: number, data: unknown) => invokeIpc('map:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('map:update', id, data),
    upsertRelation: (data: MapRelationInput) => invokeIpc('map:upsertRelation', data),
    deleteRelation: (id: number) => invokeIpc('map:deleteRelation', id),
    delete: (id: number) => invokeIpc('map:delete', id),
    batchGenerate: (novelId: number, structure: unknown) => invokeIpc('map:batchGenerate', novelId, structure),
    startAutoGenerate: (novelId: number, structure: unknown) => invokeIpc('map:startAutoGenerate', novelId, structure),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('map:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('map:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number) => invokeIpc('map:resumeAutoGenerate', taskId),
    clear: (novelId: number) => invokeIpc('map:clear', novelId),
  },

  worldRules: {
    startAutoGenerate: (novelId: number, options: unknown) => invokeIpc('worldRules:startAutoGenerate', novelId, options),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('worldRules:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('worldRules:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number, currentRules?: unknown) => invokeIpc('worldRules:resumeAutoGenerate', taskId, currentRules),
    clearAutoGenerateDraft: (novelId: number) => invokeIpc('worldRules:clearAutoGenerateDraft', novelId),
  },

  timeline: {
    list: (novelId: number) => invokeIpc('timeline:list', novelId),
    query: (filters: unknown) => invokeIpc('timeline:query', filters),
    search: (novelId: number, keyword?: string, limit?: number) => invokeIpc('timeline:search', novelId, keyword, limit),
    getStats: (filters: unknown) => invokeIpc('timeline:getStats', filters),
    getFilterOptions: (novelId: number) => invokeIpc('timeline:getFilterOptions', novelId),
    get: (id: number) => invokeIpc('timeline:get', id),
    create: (novelId: number, data: unknown) => invokeIpc('timeline:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('timeline:update', id, data),
    delete: (id: number) => invokeIpc('timeline:delete', id),
    batchUpdate: (ids: number[], data: unknown) => invokeIpc('timeline:batchUpdate', ids, data),
    batchDelete: (ids: number[]) => invokeIpc('timeline:batchDelete', ids),
    generate: (novelId: number, options?: unknown) => invokeIpc('timeline:generate', novelId, options),
    startAutoGenerate: (novelId: number, options?: unknown) => invokeIpc('timeline:startAutoGenerate', novelId, options),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('timeline:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('timeline:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number) => invokeIpc('timeline:resumeAutoGenerate', taskId),
    regenerate: (id: number, options?: unknown) => invokeIpc('timeline:regenerate', id, options),
    clear: (novelId: number) => invokeIpc('timeline:clear', novelId),
  },

  item: {
    list: (novelId: number) => invokeIpc('item:list', novelId),
    query: (filters: unknown) => invokeIpc('item:query', filters),
    getStats: (filters: unknown) => invokeIpc('item:getStats', filters),
    getFilterOptions: (novelId: number) => invokeIpc('item:getFilterOptions', novelId),
    get: (id: number) => invokeIpc('item:get', id),
    getDetailContext: (id: number) => invokeIpc('item:getDetailContext', id),
    search: (novelId: number, keyword?: string, itemKind?: 'template' | 'instance', limit?: number) => invokeIpc('item:search', novelId, keyword, itemKind, limit),
    create: (novelId: number, data: unknown) => invokeIpc('item:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('item:update', id, data),
    delete: (id: number) => invokeIpc('item:delete', id),
    generate: (novelId: number, options?: unknown) => invokeIpc('item:generate', novelId, options),
    startAutoGenerate: (novelId: number, options?: unknown) => invokeIpc('item:startAutoGenerate', novelId, options),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('item:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('item:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number) => invokeIpc('item:resumeAutoGenerate', taskId),
    regenerate: (id: number, options?: unknown) => invokeIpc('item:regenerate', id, options),
    clear: (novelId: number) => invokeIpc('item:clear', novelId),
  },

  // Outline APIs
  outline: {
    getArcs: (novelId: number) => invokeIpc('outline:getArcs', novelId),
    getArcProgressSnapshot: (novelId: number) => invokeIpc('outline:getArcProgressSnapshot', novelId),
    createArc: (novelId: number, data: unknown) => invokeIpc('outline:createArc', novelId, data),
    updateArc: (id: number, data: unknown) => invokeIpc('outline:updateArc', id, data),
    deleteArc: (id: number) => invokeIpc('outline:deleteArc', id),
    generateArcs: (novelId: number) => invokeIpc('outline:generateArcs', novelId),
    generateChapterOutlines: (arcId: number, options?: unknown) => invokeIpc('outline:generateChapterOutlines', arcId, options),
    clear: (novelId: number) => invokeIpc('outline:clear', novelId),
  },

  thread: {
    list: (novelId: number) => invokeIpc('thread:list', novelId),
    query: (filters: unknown) => invokeIpc('thread:query', filters),
    getStats: (filters: unknown) => invokeIpc('thread:getStats', filters),
    get: (id: number) => invokeIpc('thread:get', id),
    getForeshadowSnapshot: (novelId: number, chapterNum?: number) => invokeIpc('thread:getForeshadowSnapshot', novelId, chapterNum),
    generate: (novelId: number, options?: StoryThreadBatchGenerateOptions) => invokeIpc('thread:generate', novelId, options),
    startAutoGenerate: (novelId: number, options?: StoryThreadBatchGenerateOptions) => invokeIpc('thread:startAutoGenerate', novelId, options),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('thread:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('thread:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number) => invokeIpc('thread:resumeAutoGenerate', taskId),
    create: (novelId: number, data: unknown) => invokeIpc('thread:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('thread:update', id, data),
    delete: (id: number) => invokeIpc('thread:delete', id),
    batchUpdate: (ids: number[], data: unknown) => invokeIpc('thread:batchUpdate', ids, data),
    batchDelete: (ids: number[]) => invokeIpc('thread:batchDelete', ids),
    clear: (novelId: number) => invokeIpc('thread:clear', novelId),
    regenerate: (id: number, options?: unknown) => invokeIpc('thread:regenerate', id, options),
  },
  faction: {
    list: (novelId: number) => invokeIpc('faction:list', novelId),
    query: (filters: unknown) => invokeIpc('faction:query', filters),
    getStats: (filters: unknown) => invokeIpc('faction:getStats', filters),
    get: (id: number) => invokeIpc('faction:get', id),
    search: (novelId: number, keyword?: string, limit?: number) => invokeIpc('faction:search', novelId, keyword, limit),
    getGraph: (filters: unknown) => invokeIpc('faction:getGraph', filters),
    create: (novelId: number, data: unknown) => invokeIpc('faction:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('faction:update', id, data),
    delete: (id: number) => invokeIpc('faction:delete', id),
    clear: (novelId: number) => invokeIpc('faction:clear', novelId),
    batchGenerate: (novelId: number, opts: unknown) => invokeIpc('faction:batchGenerate', novelId, opts),
    startAutoGenerate: (novelId: number, opts: unknown) => invokeIpc('faction:startAutoGenerate', novelId, opts),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('faction:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('faction:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number) => invokeIpc('faction:resumeAutoGenerate', taskId),
    resolveNameOptions: (novelId: number) => invokeIpc('faction:resolveNameOptions', novelId),
  },
  glossary: {
    list: (novelId: number) => invokeIpc('glossary:list', novelId),
    query: (filters: unknown) => invokeIpc('glossary:query', filters),
    getStats: (filters: unknown) => invokeIpc('glossary:getStats', filters),
    get: (id: number) => invokeIpc('glossary:get', id),
    search: (novelId: number, keyword?: string, limit?: number) => invokeIpc('glossary:search', novelId, keyword, limit),
    create: (novelId: number, data: unknown) => invokeIpc('glossary:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('glossary:update', id, data),
    delete: (id: number) => invokeIpc('glossary:delete', id),
  },
  sceneTemplate: {
    list: (filters: unknown) => invokeIpc('sceneTemplate:list', filters),
    query: (filters: unknown) => invokeIpc('sceneTemplate:query', filters),
    getStats: (filters: unknown) => invokeIpc('sceneTemplate:getStats', filters),
    get: (id: number) => invokeIpc('sceneTemplate:get', id),
    search: (novelId: number, genreId?: number, keyword?: string, limit?: number) => invokeIpc('sceneTemplate:search', novelId, genreId, keyword, limit),
    create: (data: unknown) => invokeIpc('sceneTemplate:create', data),
    update: (id: number, data: unknown) => invokeIpc('sceneTemplate:update', id, data),
    delete: (id: number) => invokeIpc('sceneTemplate:delete', id),
  },
  subplot: {
    generate: (request: unknown) => invokeIpc('subplot:generate', request),
    startAutoGenerate: (request: unknown) => invokeIpc('subplot:startAutoGenerate', request),
    getAutoGenerateStatus: (taskId: number) => invokeIpc('subplot:getAutoGenerateStatus', taskId),
    getLatestAutoGenerateTask: (novelId: number) => invokeIpc('subplot:getLatestAutoGenerateTask', novelId),
    resumeAutoGenerate: (taskId: number) => invokeIpc('subplot:resumeAutoGenerate', taskId),
  },

  history: {
    listRecent: (novelId: number, limit?: number) => invokeIpc('history:listRecent', novelId, limit),
    getLatestUndoable: (novelId: number) => invokeIpc('history:getLatestUndoable', novelId),
    undo: (logId: number) => invokeIpc('history:undo', logId),
  },

  revision: {
    list: (novelId: number) => invokeIpc('revision:list', novelId),
    query: (filters: unknown) => invokeIpc('revision:query', filters),
    getStats: (filters: unknown) => invokeIpc('revision:getStats', filters),
    getSnapshot: (novelId: number) => invokeIpc('revision:getSnapshot', novelId),
    get: (id: number) => invokeIpc('revision:get', id),
    create: (novelId: number, data: unknown) => invokeIpc('revision:create', novelId, data),
    update: (id: number, data: unknown) => invokeIpc('revision:update', id, data),
    delete: (id: number) => invokeIpc('revision:delete', id),
    autoFix: (id: number) => invokeIpc('revision:autoFix', id),
  },

  // Model APIs
  model: {
    list: () => invokeIpc('model:list'),
    create: (data: unknown) => invokeIpc('model:create', data),
    update: (id: number, data: unknown) => invokeIpc('model:update', id, data),
    delete: (id: number) => invokeIpc('model:delete', id),
    setDefault: (id: number) => invokeIpc('model:setDefault', id),
    test: (id: number) => invokeIpc('model:test', id),
  },

  // Template APIs
  template: {
    list: (type?: string) => invokeIpc('template:list', type),
    create: (data: unknown) => invokeIpc('template:create', data),
    update: (id: number, data: unknown) => invokeIpc('template:update', id, data),
    delete: (id: number) => invokeIpc('template:delete', id),
  },

  prompt: {
    list: () => invokeIpc('prompt:list'),
    save: (key: string, content: string) => invokeIpc('prompt:save', key, content),
    delete: (key: string) => invokeIpc('prompt:delete', key),
  },

  // Task APIs
  task: {
    list: (novelId?: number) => invokeIpc('task:list', novelId),
    query: (filters: unknown) => invokeIpc('task:query', filters),
    getStats: (novelId?: number) => invokeIpc('task:getStats', novelId),
    getPipelineStats: (novelId?: number) => invokeIpc('task:getPipelineStats', novelId),
    getLatestChapterPipeline: (chapterId: number) => invokeIpc('task:getLatestChapterPipeline', chapterId),
    clearHistory: (filters?: unknown) => invokeIpc('task:clearHistory', filters),
    get: (id: number) => invokeIpc('task:get', id),
    cancel: (id: number) => invokeIpc('task:cancel', id),
    retry: (id: number) => invokeIpc('task:retry', id),
  },

  workflow: {
    list: (novelId?: number) => invokeIpc('workflow:list', novelId),
    get: (id: number) => invokeIpc('workflow:get', id),
    cancel: (id: number) => invokeIpc('workflow:cancel', id),
    resume: (id: number) => invokeIpc('workflow:resume', id),
  },

  premiseDraft: {
    getLatest: (novelId: number) => invokeIpc('premiseDraft:getLatest', novelId),
    markApplied: (taskId: number, appliedMode: string) => invokeIpc('premiseDraft:markApplied', taskId, appliedMode),
    clearAll: (novelId: number) => invokeIpc('premiseDraft:clearAll', novelId),
  },

  planningDraft: {
    getLatest: (novelId: number, pageKey: string) => invokeIpc('planningDraft:getLatest', novelId, pageKey),
    save: (data: unknown) => invokeIpc('planningDraft:save', data),
    markApplied: (taskId: number) => invokeIpc('planningDraft:markApplied', taskId),
    finalize: (taskId: number, finalData: Record<string, unknown>) => invokeIpc('planningDraft:finalize', taskId, finalData),
    clear: (novelId: number, pageKey: string) => invokeIpc('planningDraft:clear', novelId, pageKey),
  },

  // Quality Dashboard
  quality: {
    getDashboard: (novelId: number) => invokeIpc('quality:getDashboard', novelId),
    backfillRecallSnapshots: (novelId: number) => invokeIpc('quality:backfillRecallSnapshots', novelId),
    createRepairTask: (novelId: number, action: unknown) => invokeIpc('quality:createRepairTask', novelId, action),
    executeRepairAction: (novelId: number, action: unknown) => invokeIpc('quality:executeRepairAction', novelId, action),
  },

  // Embedding / Vector Memory
  embedding: {
    reindex: (novelId: number) => invokeIpc('embedding:reindex', novelId),
  },

  // Style Analysis
  style: {
    analyze: (text: string, modelConfigId?: number) => invokeIpc('style:analyze', text, modelConfigId),
    create: (novelId: number | null, name: string, text: string, modelConfigId?: number) => invokeIpc('style:create', novelId, name, text, modelConfigId),
    get: (id: number) => invokeIpc('style:get', id),
    list: (novelId?: number) => invokeIpc('style:list', novelId),
    delete: (id: number) => invokeIpc('style:delete', id),
  },

  // Parallel Generation
  parallel: {
    analyzePlan: (novelId: number, chapterStart: number, chapterEnd: number) => invokeIpc('parallel:analyzePlan', novelId, chapterStart, chapterEnd),
    getWorldState: (novelId: number, atChapterNum: number) => invokeIpc('parallel:getWorldState', novelId, atChapterNum),
    mergeOutputs: (segments: unknown[]) => invokeIpc('parallel:mergeOutputs', segments),
  },

  // AI generation APIs
  ai: {
    expandBackground: (input: unknown) => invokeIpc('ai:expandBackground', input),
    generateCoreSettings: (data: CoreSettingsGenerationRequest) => invokeIpc('ai:generateCoreSettings', data),
    generatePremise: (data: PremiseGenerationRequest) => invokeIpc('ai:generatePremise', data),
    generateProjectBrief: (data: ProjectBriefGenerationRequest) => invokeIpc('ai:generateProjectBrief', data),
    generateThemeVoice: (data: ThemeVoiceGenerationRequest) => invokeIpc('ai:generateThemeVoice', data),
    generateWorldRules: (data: WorldRulesGenerationRequest) => invokeIpc('ai:generateWorldRules', data),
    generateCharacter: (novelId: number, opts: unknown) => invokeIpc('ai:generateCharacter', novelId, opts),
    generateRelations: (novelId: number) => invokeIpc('ai:generateRelations', novelId),
    generateSubplotBatch: (data: SubplotGenerationRequest) => invokeIpc('ai:generateSubplotBatch', data),
    rewriteParagraph: (data: {
      originalParagraph: string
      contextBefore: string
      specificRequirements: string
      modelConfigId?: number
      novelId?: number
      executionMode?: import('../src/shared/ai-execution').AiExecutionMode
    }) => invokeIpc('ai:rewriteParagraph', data),
    // Story structure and planning generation
    runPrompt: (data: {
      messages: unknown[]
      count?: number
      modelConfigId?: number
      novelId?: number
      executionMode?: import('../src/shared/ai-execution').AiExecutionMode
    }) =>
      invokeIpc('ai:runPrompt', data),
    // Content scoring
    scoreContent: (data: {
      contentType: string
      content: string
      genreContext: string
      novelBackground: string
      modelConfigId?: number
    }) => invokeIpc('ai:scoreContent', data),
    analyzeWorkspaceQuality: (data: unknown) => invokeIpc('ai:analyzeWorkspaceQuality', data),
    repairWorkspaceQuality: (data: unknown) => invokeIpc('ai:repairWorkspaceQuality', data),
  },

  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'task:stream-chunk',
      'task:status-change',
      'task:progress',
      'task:complete',
      'character:batch-progress',
      'ai:core-settings-progress',
      'ai:premise-progress',
      'ai:world-rules-progress',
      'chapter:generation-progress',
    ]
    if (validChannels.includes(channel)) {
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    }
    return () => {}
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback as never)
  },
}

contextBridge.exposeInMainWorld('electron', api)

export type ElectronAPI = typeof api



