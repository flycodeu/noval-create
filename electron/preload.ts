import { contextBridge, ipcRenderer } from 'electron'
import type { CoreSettingsGenerationRequest } from '../src/shared/core-settings-generation'
import type { WorldRulesGenerationRequest } from '../src/shared/world-rules-generation'
import type { SubplotGenerationRequest } from '../src/shared/subplot-framework'

const api = {
  // 小说管理
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
  },

  // 章节管理
  chapter: {
    list: (novelId: number) => ipcRenderer.invoke('chapter:list', novelId),
    get: (id: number) => ipcRenderer.invoke('chapter:get', id),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('chapter:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('chapter:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('chapter:delete', id),
    generateContent: (chapterId: number) => ipcRenderer.invoke('chapter:generateContent', chapterId),
    generateSummary: (chapterId: number) => ipcRenderer.invoke('chapter:generateSummary', chapterId),
    aiCheck: (chapterId: number) => ipcRenderer.invoke('chapter:aiCheck', chapterId),
  },

  // 人物管理
  character: {
    list: (novelId: number) => ipcRenderer.invoke('character:list', novelId),
    get: (id: number) => ipcRenderer.invoke('character:get', id),
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

  // 地图管理
  map: {
    getTree: (novelId: number) => ipcRenderer.invoke('map:getTree', novelId),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('map:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('map:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('map:delete', id),
    batchGenerate: (novelId: number, structure: unknown) => ipcRenderer.invoke('map:batchGenerate', novelId, structure),
    clear: (novelId: number) => ipcRenderer.invoke('map:clear', novelId),
  },

  timeline: {
    list: (novelId: number) => ipcRenderer.invoke('timeline:list', novelId),
    get: (id: number) => ipcRenderer.invoke('timeline:get', id),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('timeline:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('timeline:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('timeline:delete', id),
    generate: (novelId: number, options?: unknown) => ipcRenderer.invoke('timeline:generate', novelId, options),
    clear: (novelId: number) => ipcRenderer.invoke('timeline:clear', novelId),
  },

  item: {
    list: (novelId: number) => ipcRenderer.invoke('item:list', novelId),
    get: (id: number) => ipcRenderer.invoke('item:get', id),
    create: (novelId: number, data: unknown) => ipcRenderer.invoke('item:create', novelId, data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('item:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('item:delete', id),
    generate: (novelId: number, options?: unknown) => ipcRenderer.invoke('item:generate', novelId, options),
    clear: (novelId: number) => ipcRenderer.invoke('item:clear', novelId),
  },

  // 大纲管理
  outline: {
    getArcs: (novelId: number) => ipcRenderer.invoke('outline:getArcs', novelId),
    createArc: (novelId: number, data: unknown) => ipcRenderer.invoke('outline:createArc', novelId, data),
    updateArc: (id: number, data: unknown) => ipcRenderer.invoke('outline:updateArc', id, data),
    deleteArc: (id: number) => ipcRenderer.invoke('outline:deleteArc', id),
    generateArcs: (novelId: number) => ipcRenderer.invoke('outline:generateArcs', novelId),
    generateChapterOutlines: (arcId: number, options?: unknown) => ipcRenderer.invoke('outline:generateChapterOutlines', arcId, options),
    clear: (novelId: number) => ipcRenderer.invoke('outline:clear', novelId),
  },

  // 模型管理
  model: {
    list: () => ipcRenderer.invoke('model:list'),
    create: (data: unknown) => ipcRenderer.invoke('model:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('model:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('model:delete', id),
    setDefault: (id: number) => ipcRenderer.invoke('model:setDefault', id),
    test: (id: number) => ipcRenderer.invoke('model:test', id),
  },

  // 模板管理
  template: {
    list: (type?: string) => ipcRenderer.invoke('template:list', type),
    create: (data: unknown) => ipcRenderer.invoke('template:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('template:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('template:delete', id),
  },

  // 任务管理
  task: {
    list: (novelId?: number) => ipcRenderer.invoke('task:list', novelId),
    get: (id: number) => ipcRenderer.invoke('task:get', id),
    cancel: (id: number) => ipcRenderer.invoke('task:cancel', id),
    retry: (id: number) => ipcRenderer.invoke('task:retry', id),
  },

  // AI 功能
  ai: {
    expandBackground: (input: unknown) => ipcRenderer.invoke('ai:expandBackground', input),
    generateCoreSettings: (data: CoreSettingsGenerationRequest) => ipcRenderer.invoke('ai:generateCoreSettings', data),
    generateWorldRules: (data: WorldRulesGenerationRequest) => ipcRenderer.invoke('ai:generateWorldRules', data),
    generateCharacter: (novelId: number, opts: unknown) => ipcRenderer.invoke('ai:generateCharacter', novelId, opts),
    generateRelations: (novelId: number) => ipcRenderer.invoke('ai:generateRelations', novelId),
    generateSubplotBatch: (data: SubplotGenerationRequest) => ipcRenderer.invoke('ai:generateSubplotBatch', data),
    rewriteParagraph: (data: unknown) => ipcRenderer.invoke('ai:rewriteParagraph', data),
    // 抽卡：批量运行提示词
    runPrompt: (data: { messages: unknown[]; count?: number; modelConfigId?: number }) =>
      ipcRenderer.invoke('ai:runPrompt', data),
    // 内容评分
    scoreContent: (data: {
      contentType: string
      content: string
      genreContext: string
      novelBackground: string
      modelConfigId?: number
    }) => ipcRenderer.invoke('ai:scoreContent', data),
  },

  // 事件监听
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'task:stream-chunk',
      'task:status-change',
      'task:complete',
      'character:batch-progress',
      'ai:core-settings-progress',
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
