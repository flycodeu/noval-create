import { contextBridge, ipcRenderer } from 'electron'
import type { CoreSettingsGenerationRequest } from '../src/shared/core-settings-generation'
import type { PremiseGenerationRequest } from '../src/shared/premise-generation'
import type { WorldRulesGenerationRequest } from '../src/shared/world-rules-generation'
import type { SubplotGenerationRequest } from '../src/shared/subplot-framework'

const api = {
  // 灏忚绠＄悊
  novel: {
    list: (filters?: unknown) => ipcRenderer.invoke('novel:list', filters),
    get: (id: number) => ipcRenderer.invoke('novel:get', id),
    create: (data: unknown) => ipcRenderer.invoke('novel:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('novel:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('novel:delete', id),
    export: (id: number, format: string) => ipcRenderer.invoke('novel:export', id, format),
    stats: (id: number) => ipcRenderer.invoke('novel:stats', id),
    runConsistencyCheck: (id: number) => ipcRenderer.invoke('novel:runConsistencyCheck', id),
    getStoryMemory: (id: number) => ipcRenderer.invoke('novel:getStoryMemory', id),
    getContextStatus: (id: number) => ipcRenderer.invoke('novel:getContextStatus', id),
  },

  structure: {
    getTree: (novelId: number) => ipcRenderer.invoke('structure:getTree', novelId),
    listVolumes: (novelId: number) => ipcRenderer.invoke('structure:listVolumes', novelId),
    listPartsPage: (volumeId: number, page?: number, pageSize?: number) => ipcRenderer.invoke('structure:listPartsPage', volumeId, page, pageSize),
    listChaptersPage: (partId: number, page?: number, pageSize?: number) => ipcRenderer.invoke('structure:listChaptersPage', partId, page, pageSize),
    listSegments: (chapterId: number) => ipcRenderer.invoke('structure:listSegments', chapterId),
    getSegment: (id: number) => ipcRenderer.invoke('structure:getSegment', id),
    listSegmentsPage: (chapterId: number, page?: number, pageSize?: number) => ipcRenderer.invoke('structure:listSegmentsPage', chapterId, page, pageSize),
    listCheckpoints: (novelId: number) => ipcRenderer.invoke('structure:listCheckpoints', novelId),
    listCheckpointsPage: (filters: unknown, page?: number, pageSize?: number) => ipcRenderer.invoke('structure:listCheckpointsPage', filters, page, pageSize),
    listLinkedTimelineEvents: (filters: unknown) => ipcRenderer.invoke('structure:listLinkedTimelineEvents', filters),
    listLinkedTimelineEventsPage: (filters: unknown, page?: number, pageSize?: number) => ipcRenderer.invoke('structure:listLinkedTimelineEventsPage', filters, page, pageSize),
    resolvePath: (filters: unknown) => ipcRenderer.invoke('structure:resolvePath', filters),
    createVolume: (novelId: number, data: unknown) => ipcRenderer.invoke('structure:createVolume', novelId, data),
    updateVolume: (id: number, data: unknown) => ipcRenderer.invoke('structure:updateVolume', id, data),
    deleteVolume: (id: number) => ipcRenderer.invoke('structure:deleteVolume', id),
    reorderVolumes: (novelId: number, orderedIds: number[]) => ipcRenderer.invoke('structure:reorderVolumes', novelId, orderedIds),
    createPart: (volumeId: number, data: unknown) => ipcRenderer.invoke('structure:createPart', volumeId, data),
    updatePart: (id: number, data: unknown) => ipcRenderer.invoke('structure:updatePart', id, data),
    deletePart: (id: number) => ipcRenderer.invoke('structure:deletePart', id),
    reorderParts: (novelId: number, operations: unknown[]) => ipcRenderer.invoke('structure:reorderParts', novelId, operations),
    reorderPartsInVolume: (volumeId: number, orderedIds: number[]) => ipcRenderer.invoke('structure:reorderPartsInVolume', volumeId, orderedIds),
    assignChapter: (chapterId: number, partId: number) => ipcRenderer.invoke('structure:assignChapter', chapterId, partId),
    createSegment: (chapterId: number, data: unknown) => ipcRenderer.invoke('structure:createSegment', chapterId, data),
    updateSegment: (id: number, data: unknown) => ipcRenderer.invoke('structure:updateSegment', id, data),
    deleteSegment: (id: number) => ipcRenderer.invoke('structure:deleteSegment', id),
    reorderSegments: (chapterId: number, orderedIds: number[]) => ipcRenderer.invoke('structure:reorderSegments', chapterId, orderedIds),
    compileChapter: (chapterId: number) => ipcRenderer.invoke('structure:compileChapter', chapterId),
    refreshCheckpoints: (novelId: number) => ipcRenderer.invoke('structure:refreshCheckpoints', novelId),
  },

  // 绔犺妭绠＄悊
  chapter: {
    list: (novelId: number) => ipcRenderer.invoke('chapter:list', novelId),
    get: (id: number) => ipcRenderer.invoke('chapter:get', id),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('chapter:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('chapter:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('chapter:delete', id),
    generateContent: (chapterId: number) => ipcRenderer.invoke('chapter:generateContent', chapterId),
    generateSummary: (chapterId: number) => ipcRenderer.invoke('chapter:generateSummary', chapterId),
    aiCheck: (chapterId: number) => ipcRenderer.invoke('chapter:aiCheck', chapterId),
    runPublishCheck: (chapterId: number) => ipcRenderer.invoke('chapter:runPublishCheck', chapterId),
  },

  // 浜虹墿绠＄悊
  character: {
    list: (novelId: number) => ipcRenderer.invoke('character:list', novelId),
    query: (filters: unknown) => ipcRenderer.invoke('character:query', filters),
    getStats: (filters: unknown) => ipcRenderer.invoke('character:getStats', filters),
    getFilterOptions: (novelId: number) => ipcRenderer.invoke('character:getFilterOptions', novelId),
    get: (id: number) => ipcRenderer.invoke('character:get', id),
    search: (novelId: number, keyword?: string, limit?: number) => ipcRenderer.invoke('character:search', novelId, keyword, limit),
    getGraph: (filters: unknown) => ipcRenderer.invoke('character:getGraph', filters),
    getDetailContext: (characterId: number) => ipcRenderer.invoke('character:getDetailContext', characterId),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('character:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('character:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('character:delete', id),
    regenerate: (id: number) => ipcRenderer.invoke('character:regenerate', id),
    batchGenerate: (novelId: number, opts: unknown) => ipcRenderer.invoke('character:batchGenerate', novelId, opts),
    generateProtagonist: (novelId: number, opts: unknown) => ipcRenderer.invoke('character:generateProtagonist', novelId, opts),
    getRelations: (novelId: number) => ipcRenderer.invoke('character:getRelations', novelId),
    generateRelations: (novelId: number) => ipcRenderer.invoke('character:generateRelations', novelId),
    upsertRelation: (data: unknown) => ipcRenderer.invoke('character:upsertRelation', data),
    clear: (novelId: number) => ipcRenderer.invoke('character:clear', novelId),
  },

  // 鍦板浘绠＄悊
  map: {
    getTree: (novelId: number) => ipcRenderer.invoke('map:getTree', novelId),
    queryNodes: (filters: unknown) => ipcRenderer.invoke('map:queryNodes', filters),
    getStats: (novelId: number) => ipcRenderer.invoke('map:getStats', novelId),
    getNode: (id: number) => ipcRenderer.invoke('map:getNode', id),
    searchNodes: (novelId: number, keyword?: string, limit?: number) => ipcRenderer.invoke('map:searchNodes', novelId, keyword, limit),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('map:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('map:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('map:delete', id),
    batchGenerate: (novelId: number, structure: unknown) => ipcRenderer.invoke('map:batchGenerate', novelId, structure),
    clear: (novelId: number) => ipcRenderer.invoke('map:clear', novelId),
  },

  timeline: {
    list: (novelId: number) => ipcRenderer.invoke('timeline:list', novelId),
    query: (filters: unknown) => ipcRenderer.invoke('timeline:query', filters),
    search: (novelId: number, keyword?: string, limit?: number) => ipcRenderer.invoke('timeline:search', novelId, keyword, limit),
    getStats: (filters: unknown) => ipcRenderer.invoke('timeline:getStats', filters),
    getFilterOptions: (novelId: number) => ipcRenderer.invoke('timeline:getFilterOptions', novelId),
    get: (id: number) => ipcRenderer.invoke('timeline:get', id),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('timeline:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('timeline:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('timeline:delete', id),
    generate: (novelId: number, options?: unknown) => ipcRenderer.invoke('timeline:generate', novelId, options),
    clear: (novelId: number) => ipcRenderer.invoke('timeline:clear', novelId),
  },

  item: {
    list: (novelId: number) => ipcRenderer.invoke('item:list', novelId),
    query: (filters: unknown) => ipcRenderer.invoke('item:query', filters),
    getStats: (filters: unknown) => ipcRenderer.invoke('item:getStats', filters),
    getFilterOptions: (novelId: number) => ipcRenderer.invoke('item:getFilterOptions', novelId),
    get: (id: number) => ipcRenderer.invoke('item:get', id),
    search: (novelId: number, keyword?: string, itemKind?: 'template' | 'instance', limit?: number) => ipcRenderer.invoke('item:search', novelId, keyword, itemKind, limit),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('item:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('item:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('item:delete', id),
    generate: (novelId: number, options?: unknown) => ipcRenderer.invoke('item:generate', novelId, options),
    clear: (novelId: number) => ipcRenderer.invoke('item:clear', novelId),
  },

  // 澶х翰绠＄悊
  outline: {
    getArcs: (novelId: number) => ipcRenderer.invoke('outline:getArcs', novelId),
    createArc: (novelId: number, data: unknown) => ipcRenderer.invoke('outline:createArc', novelId, data),
    updateArc: (id: number, data: unknown) => ipcRenderer.invoke('outline:updateArc', id, data),
    deleteArc: (id: number) => ipcRenderer.invoke('outline:deleteArc', id),
    generateArcs: (novelId: number) => ipcRenderer.invoke('outline:generateArcs', novelId),
    generateChapterOutlines: (arcId: number, options?: unknown) => ipcRenderer.invoke('outline:generateChapterOutlines', arcId, options),
    clear: (novelId: number) => ipcRenderer.invoke('outline:clear', novelId),
  },

  // 妯″瀷绠＄悊
  model: {
    list: () => ipcRenderer.invoke('model:list'),
    create: (data: unknown) => ipcRenderer.invoke('model:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('model:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('model:delete', id),
    setDefault: (id: number) => ipcRenderer.invoke('model:setDefault', id),
    test: (id: number) => ipcRenderer.invoke('model:test', id),
  },

  // 妯℃澘绠＄悊
  template: {
    list: (type?: string) => ipcRenderer.invoke('template:list', type),
    create: (data: unknown) => ipcRenderer.invoke('template:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('template:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('template:delete', id),
  },

  prompt: {
    list: () => ipcRenderer.invoke('prompt:list'),
    save: (key: string, content: string) => ipcRenderer.invoke('prompt:save', key, content),
    delete: (key: string) => ipcRenderer.invoke('prompt:delete', key),
  },

  // 浠诲姟绠＄悊
  task: {
    list: (novelId?: number) => ipcRenderer.invoke('task:list', novelId),
    get: (id: number) => ipcRenderer.invoke('task:get', id),
    cancel: (id: number) => ipcRenderer.invoke('task:cancel', id),
    retry: (id: number) => ipcRenderer.invoke('task:retry', id),
  },

  // AI 鍔熻兘
  ai: {
    expandBackground: (input: unknown) => ipcRenderer.invoke('ai:expandBackground', input),
    generateCoreSettings: (data: CoreSettingsGenerationRequest) => ipcRenderer.invoke('ai:generateCoreSettings', data),
    generatePremise: (data: PremiseGenerationRequest) => ipcRenderer.invoke('ai:generatePremise', data),
    generateWorldRules: (data: WorldRulesGenerationRequest) => ipcRenderer.invoke('ai:generateWorldRules', data),
    generateCharacter: (novelId: number, opts: unknown) => ipcRenderer.invoke('ai:generateCharacter', novelId, opts),
    generateRelations: (novelId: number) => ipcRenderer.invoke('ai:generateRelations', novelId),
    generateSubplotBatch: (data: SubplotGenerationRequest) => ipcRenderer.invoke('ai:generateSubplotBatch', data),
    rewriteParagraph: (data: unknown) => ipcRenderer.invoke('ai:rewriteParagraph', data),
    // 鎶藉崱锛氭壒閲忚繍琛屾彁绀鸿瘝
    runPrompt: (data: { messages: unknown[]; count?: number; modelConfigId?: number }) =>
      ipcRenderer.invoke('ai:runPrompt', data),
    // 鍐呭璇勫垎
    scoreContent: (data: {
      contentType: string
      content: string
      genreContext: string
      novelBackground: string
      modelConfigId?: number
    }) => ipcRenderer.invoke('ai:scoreContent', data),
  },

  // 浜嬩欢鐩戝惉
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'task:stream-chunk',
      'task:status-change',
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

