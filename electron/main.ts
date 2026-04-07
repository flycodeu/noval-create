import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { desc, eq } from 'drizzle-orm'
import type { CoreSettingsGenerationRequest } from '../src/shared/core-settings-generation'
import type { PremiseGenerationRequest } from '../src/shared/premise-generation'
import type { ProjectBriefGenerationRequest } from '../src/shared/project-brief-generation'
import type { ThemeVoiceGenerationRequest } from '../src/shared/theme-voice-generation'
import type { WorldRulesGenerationRequest } from '../src/shared/world-rules-generation'
import type { SubplotGenerationRequest } from '../src/shared/subplot-framework'
import type {
  CharacterRelationInput,
  MapRelationInput,
  NovelCreateInput,
  PlanningDraftPageKey,
} from '../src/types'
import { closeDb, getDb, initDb } from './database/db'
import {
  chapters,
  genres as genresTable,
  modelConfigs,
  novels as novelsTable,
  storyArcs,
  tasks,
  templates,
} from './database/schema'
import * as chapterService from './services/chapter.service'
import * as characterService from './services/character.service'
import * as consistencyService from './services/consistency.service'
import * as coreSettingsService from './services/core-settings.service'
import * as premiseService from './services/premise.service'
import * as planningDraftService from './services/planning-draft.service'
import * as projectBriefService from './services/project-brief.service'
import { buildOutlineGenerationContext, buildStoryProfile } from './services/context.service'
import * as worldRulesService from './services/world-rules.service'
import * as exportService from './services/export.service'
import * as factionService from './services/faction.service'
import * as glossaryService from './services/glossary.service'
import * as qualityDashboardService from './services/quality-dashboard.service'
import * as embeddingService from './services/embedding.service'
import * as styleAnalysisService from './services/style-analysis.service'
import * as parallelGenerationService from './services/parallel-generation.service'
import * as batchWorkflowService from './services/batch-workflow.service'
import * as itemService from './services/item.service'
import * as mapService from './services/map.service'
import * as modelService from './services/model.service'
import { encryptApiKey } from './services/model.service'
import { throwUserFacingError } from './utils/user-facing-error'
import * as novelService from './services/novel.service'
import * as subplotService from './services/subplot.service'
import * as themeVoiceService from './services/theme-voice.service'
import * as timelineService from './services/timeline.service'
import * as historyService from './services/history.service'
import * as storyMemoryService from './services/story-memory.service'
import * as promptOverrideService from './services/prompt-override.service'
import * as revisionTaskService from './services/revision-task.service'
import * as sceneTemplateService from './services/scene-template.service'
import * as storyStructureService from './services/story-structure.service'
import * as storyThreadService from './services/story-thread.service'
import * as workflowTaskService from './services/workflow-task.service'
import { discoverEntitiesFromContent } from './services/entity-discovery.service'
import { parseObjectPayload, requireId, requireIds, requireObject, requireString } from './utils/ipc-validate'
import {
  buildBackgroundExpansionRepairPrompt,
  collectForbiddenBackgroundNaming,
  contentScoringPrompt,
  expandBackgroundPrompt,
  normalizeBackgroundExpansionPayload,
  rewriteParagraphPrompt,
  sanitizeBackgroundExpansionResult,
} from './services/prompts'
import {
  buildChapterOutlinePlanningPrompt,
  buildStoryArcPlanningPrompt,
} from './services/story-prompts'
import * as taskService from './services/task.service'
import { safeParseJson } from './utils/json'
import { getNovelContextStatus, markNovelContextChanged } from './services/context-impact.service'
import {
  appendVariationMessage,
  buildVariationDigest,
  isCandidateTooSimilar,
} from './services/variation-control.service'

let mainWindow: BrowserWindow | null = null

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
}

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    return JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf-8')) as WindowState
  } catch {
    return { width: 1400, height: 900 }
  }
}

function saveWindowState(win: BrowserWindow) {
  try {
    const isMaximized = win.isMaximized()
    const bounds = win.getBounds()
    const state: WindowState = isMaximized
      ? { width: bounds.width, height: bounds.height, isMaximized: true }
      : {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          isMaximized: false,
        }

    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf-8')
  } catch {
    // Ignore state persistence failures.
  }
}

function createWindow() {
  const winState = loadWindowState()

  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width || 1400,
    height: winState.height || 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (winState.isMaximized) {
    mainWindow.maximize()
  }

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (process.env.NOVELFORGE_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('close', () => {
    if (mainWindow) saveWindowState(mainWindow)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toLedgerText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()

  const items = toStringArray(value)
  return items.length > 0 ? items.join('；') : ''
}

function formatGeneratedOutline(outline: Record<string, unknown>): string {
  const characters = toStringArray(outline.characters)
  const growthLedger = toLedgerText(outline.growth_ledger)
  const costLedger = toLedgerText(outline.cost_ledger)

  return [
    typeof outline.goal === 'string' && outline.goal.trim() ? `目标：${outline.goal.trim()}` : '',
    growthLedger ? `成长账本：${growthLedger}` : '',
    costLedger ? `代价账本：${costLedger}` : '',
    characters.length > 0 ? `人物：${characters.join('、')}` : '',
    typeof outline.location === 'string' && outline.location.trim() ? `场景：${outline.location.trim()}` : '',
    ...toStringArray(outline.plot_points).map((item) => `- ${item}`),
    typeof outline.bridge_in === 'string' && outline.bridge_in.trim() ? `承接：${outline.bridge_in.trim()}` : '',
    typeof outline.bridge_out === 'string' && outline.bridge_out.trim() ? `转出：${outline.bridge_out.trim()}` : '',
  ].filter(Boolean).join('\n')
}

app.whenReady().then(() => {
  initDb()
  taskService.recoverOrphanedTasks()
  createWindow()
  registerIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

function registerIpcHandlers() {
  ipcMain.handle('novel:list', (_, filters) => novelService.listNovels(filters))
  ipcMain.handle('novel:get', (_, id) => novelService.getNovel(requireId(id)))
  ipcMain.handle('novel:create', (_, data) => novelService.createNovel(parseObjectPayload<NovelCreateInput>(data, 'data')))
  ipcMain.handle('novel:update', (_, id, data) => novelService.updateNovel(requireId(id), data))
  ipcMain.handle('novel:delete', (_, id) => novelService.deleteNovel(requireId(id)))
  ipcMain.handle('novel:export', (_, id, format) => exportService.exportNovel(requireId(id), format))
  ipcMain.handle('novel:stats', (_, id) => novelService.getNovelStats(requireId(id)))

  // Quality Dashboard
  ipcMain.handle('quality:getDashboard', (_, novelId) => qualityDashboardService.getQualityDashboardData(novelId))

  // Embedding
  ipcMain.handle('embedding:reindex', async (_, novelId: number) => {
    const db = getDb()
    const chapterList = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
    let succeeded = 0
    let failed = 0
    for (const chapter of chapterList) {
      try {
        await embeddingService.generateChapterEmbeddings(novelId, chapter.id)
        succeeded += 1
      } catch (err) {
        console.warn(`[embedding:reindex] 章节 ${chapter.id} 向量化失败:`, err)
        failed += 1
      }
    }
    return { reindexed: succeeded, failed, total: chapterList.length }
  })

  // Style Analysis
  ipcMain.handle('style:analyze', (_, text: string, modelConfigId?: number) =>
    styleAnalysisService.analyzeReferenceText(text, modelConfigId))
  ipcMain.handle('style:create', (_, novelId: number | null, name: string, text: string, modelConfigId?: number) =>
    styleAnalysisService.createStyleFingerprint(novelId, name, text, modelConfigId))
  ipcMain.handle('style:get', (_, id: number) =>
    styleAnalysisService.getStyleFingerprint(id))
  ipcMain.handle('style:list', (_, novelId?: number) =>
    styleAnalysisService.listStyleFingerprints(novelId))
  ipcMain.handle('style:delete', (_, id: number) =>
    styleAnalysisService.deleteStyleFingerprint(requireId(id)))

  // Parallel Generation
  ipcMain.handle('parallel:analyzePlan', (_, novelId: number, chapterStart: number, chapterEnd: number) =>
    parallelGenerationService.identifyParallelizableSegments(novelId, chapterStart, chapterEnd))
  ipcMain.handle('parallel:getWorldState', (_, novelId: number, atChapterNum: number) =>
    parallelGenerationService.buildSharedWorldState(novelId, atChapterNum))
  ipcMain.handle('parallel:mergeOutputs', (_, segments: unknown[]) =>
    parallelGenerationService.mergeParallelOutputs(segments as any))
  ipcMain.handle('novel:runConsistencyCheck', (_, id) => consistencyService.buildNovelConsistencyReport(id))
  ipcMain.handle('novel:getStoryMemory', (_, id) => storyMemoryService.buildStoryMemorySnapshot(id))
  ipcMain.handle('novel:getContextStatus', (_, id) => getNovelContextStatus(id))

  ipcMain.handle('structure:getTree', (_, novelId) => storyStructureService.listStoryStructure(novelId))
  ipcMain.handle('structure:listVolumes', (_, novelId) => storyStructureService.listStructureVolumes(novelId))
  ipcMain.handle('structure:listPartsPage', (_, volumeId, page, pageSize) => storyStructureService.listStructurePartsPage(volumeId, page, pageSize))
  ipcMain.handle('structure:listChaptersPage', (_, partId, page, pageSize) => storyStructureService.listStructureChaptersPage(partId, page, pageSize))
  ipcMain.handle('structure:listSegments', (_, chapterId) => storyStructureService.listChapterSegments(chapterId))
  ipcMain.handle('structure:getSegment', (_, id) => storyStructureService.getChapterSegment(id))
  ipcMain.handle('structure:listSegmentsPage', (_, chapterId, page, pageSize) => storyStructureService.listChapterSegmentsPage(chapterId, page, pageSize))
  ipcMain.handle('structure:listCheckpoints', (_, novelId) => storyStructureService.listStoryCheckpoints(novelId))
  ipcMain.handle('structure:listCheckpointsPage', (_, filters, page, pageSize) => storyStructureService.listStoryCheckpointsPage(filters, page, pageSize))
  ipcMain.handle('structure:listLinkedTimelineEvents', (_, filters) => timelineService.listLinkedTimelineEvents(filters))
  ipcMain.handle('structure:listLinkedTimelineEventsPage', (_, filters, page, pageSize) => timelineService.listLinkedTimelineEventsPage(filters, page, pageSize))
  ipcMain.handle('structure:resolvePath', (_, filters) => storyStructureService.resolveStructurePath(filters))
  ipcMain.handle('structure:createVolume', (_, novelId, data) => storyStructureService.createStoryVolume(requireId(novelId, 'novelId'), data))
  ipcMain.handle('structure:updateVolume', (_, id, data) => storyStructureService.updateStoryVolume(requireId(id), data))
  ipcMain.handle('structure:deleteVolume', (_, id) => storyStructureService.deleteStoryVolume(requireId(id)))
  ipcMain.handle('structure:reorderVolumes', (_, novelId, orderedIds) => storyStructureService.reorderStoryVolumes(requireId(novelId, 'novelId'), requireIds(orderedIds, 'orderedIds')))
  ipcMain.handle('structure:createPart', (_, volumeId, data) => storyStructureService.createStoryPart(requireId(volumeId, 'volumeId'), data))
  ipcMain.handle('structure:updatePart', (_, id, data) => storyStructureService.updateStoryPart(requireId(id), data))
  ipcMain.handle('structure:deletePart', (_, id) => storyStructureService.deleteStoryPart(requireId(id)))
  ipcMain.handle('structure:reorderParts', (_, novelId, operations) => storyStructureService.reorderStoryParts(requireId(novelId, 'novelId'), operations))
  ipcMain.handle('structure:reorderPartsInVolume', (_, volumeId, orderedIds) => storyStructureService.reorderStoryPartsInVolume(requireId(volumeId, 'volumeId'), requireIds(orderedIds, 'orderedIds')))
  ipcMain.handle('structure:assignChapter', (_, chapterId, partId) => storyStructureService.assignChapterToPart(requireId(chapterId, 'chapterId'), requireId(partId, 'partId')))
  ipcMain.handle('structure:createSegment', (_, chapterId, data) => storyStructureService.createChapterSegment(requireId(chapterId, 'chapterId'), data))
  ipcMain.handle('structure:updateSegment', (_, id, data) => storyStructureService.updateChapterSegment(requireId(id), data))
  ipcMain.handle('structure:deleteSegment', (_, id) => storyStructureService.deleteChapterSegment(requireId(id)))
  ipcMain.handle('structure:reorderSegments', (_, chapterId, orderedIds) => storyStructureService.reorderChapterSegments(requireId(chapterId, 'chapterId'), requireIds(orderedIds, 'orderedIds')))
  ipcMain.handle('structure:compileChapter', (_, chapterId) => storyStructureService.compileChapterFromSegments(requireId(chapterId, 'chapterId')))
  ipcMain.handle('structure:refreshCheckpoints', (_, novelId) => storyMemoryService.refreshStoryMemoryCheckpoints(requireId(novelId, 'novelId')))
  ipcMain.handle('structure:applyBatchPlan', (_, novelId, plan) => storyStructureService.applyStructureBatchPlan(requireId(novelId, 'novelId'), plan))
  ipcMain.handle('structure:previewBatchEdit', (_, novelId, operations) => storyStructureService.previewStructureBatchEdit(requireId(novelId, 'novelId'), operations))
  ipcMain.handle('structure:applyBatchEdit', (_, novelId, operations) => storyStructureService.applyStructureBatchEdit(requireId(novelId, 'novelId'), operations))

  ipcMain.handle('chapter:list', (_, novelId) => chapterService.listChapters(requireId(novelId, 'novelId')))
  ipcMain.handle('chapter:get', (_, id) => chapterService.getChapter(requireId(id)))
  ipcMain.handle('chapter:create', (_, novelId, data) => chapterService.createChapter(requireId(novelId, 'novelId'), data))
  ipcMain.handle('chapter:update', (_, id, data, options) => chapterService.updateChapter(requireId(id), data, options))
  ipcMain.handle('chapter:delete', (_, id) => chapterService.deleteChapter(requireId(id)))
  ipcMain.handle('chapter:listVersions', (_, chapterId) => chapterService.listChapterVersions(requireId(chapterId, 'chapterId')))
  ipcMain.handle('chapter:restoreVersion', (_, versionId) => chapterService.restoreChapterVersion(requireId(versionId, 'versionId')))
  ipcMain.handle('chapter:batchUpdate', (_, ids, data) => chapterService.batchUpdateChapters(requireIds(ids), data))
  ipcMain.handle('chapter:batchDelete', (_, ids) => chapterService.batchDeleteChapters(requireIds(ids)))
  ipcMain.handle('chapter:batchRenumber', (_, ids, startChapterNum) => chapterService.batchRenumberChapters(requireIds(ids), startChapterNum))
  ipcMain.handle('chapter:generateContent', (event, chapterId) =>
    chapterService.generateChapterContent(chapterId, event.sender))
  ipcMain.handle('chapter:generateSummary', (_, chapterId) =>
    chapterService.generateChapterSummary(chapterId))
  ipcMain.handle('chapter:aiCheck', (_, chapterId) =>
    chapterService.aiCheckChapter(chapterId))
  ipcMain.handle('chapter:runPublishCheck', (_, chapterId) =>
    chapterService.runChapterPublishCheck(chapterId))

  ipcMain.handle('character:list', (_, novelId) => characterService.listCharacters(novelId))
  ipcMain.handle('character:query', (_, filters) => characterService.queryCharacters(filters))
  ipcMain.handle('character:getStats', (_, filters) => characterService.getCharacterStats(filters))
  ipcMain.handle('character:getFilterOptions', (_, novelId) => characterService.getCharacterFilterOptions(novelId))
  ipcMain.handle('character:get', (_, id) => characterService.getCharacter(id))
  ipcMain.handle('character:search', (_, novelId, keyword, limit) => characterService.searchCharacters(novelId, keyword, limit))
  ipcMain.handle('character:getGraph', (_, filters) => characterService.getCharacterGraph(filters))
  ipcMain.handle('character:getDetailContext', (_, characterId) => characterService.getCharacterDetailContext(characterId))
  ipcMain.handle('character:create', (_, novelId, data) => characterService.createCharacter(requireId(novelId, 'novelId'), data))
  ipcMain.handle('character:update', (_, id, data) => characterService.updateCharacter(requireId(id), data))
  ipcMain.handle('character:delete', (_, id) => characterService.deleteCharacter(requireId(id)))
  ipcMain.handle('character:regenerate', (_, id) => characterService.regenerateCharacter(id))
  ipcMain.handle('character:startAutoGenerate', (event, novelId, opts) =>
    batchWorkflowService.startCharacterAutoGenerateWorkflow(novelId, opts, event.sender))
  ipcMain.handle('character:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getCharacterAutoGenerateStatus(taskId))
  ipcMain.handle('character:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestCharacterAutoGenerateTask(novelId))
  ipcMain.handle('character:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))
  ipcMain.handle('character:getRelations', (_, novelId) => characterService.getCharacterRelations(novelId))
  ipcMain.handle('character:generateProtagonist', (_, novelId, opts) =>
    characterService.generateProtagonist(novelId, opts))
  ipcMain.handle('character:batchGenerate', (event, novelId, opts) =>
    batchWorkflowService.generateCharactersViaWorkflow(novelId, opts, event.sender))
  ipcMain.handle('character:generateRelations', (_, novelId) =>
    characterService.generateCharacterRelations(novelId))
  ipcMain.handle('character:upsertRelation', (_, data) =>
    characterService.upsertRelation(parseObjectPayload<CharacterRelationInput>(data, 'data')))
  ipcMain.handle('character:clear', (_, novelId) => characterService.clearCharactersByNovel(requireId(novelId, 'novelId')))

  ipcMain.handle('map:getTree', (_, novelId) => mapService.getMapTree(novelId))
  ipcMain.handle('map:queryNodes', (_, filters) => mapService.queryMapNodes(filters))
  ipcMain.handle('map:getGraph', (_, filters) => mapService.getMapGraph(filters))
  ipcMain.handle('map:getRelations', (_, novelId, focusNodeId) => mapService.getMapRelations(novelId, focusNodeId))
  ipcMain.handle('map:getStats', (_, novelId) => mapService.getMapStats(novelId))
  ipcMain.handle('map:getNode', (_, id) => mapService.getMapNode(id))
  ipcMain.handle('map:searchNodes', (_, novelId, keyword, limit) => mapService.searchMapNodes(novelId, keyword, limit))
  ipcMain.handle('map:create', (_, novelId, data) => mapService.createMapItem(requireId(novelId, 'novelId'), data))
  ipcMain.handle('map:update', (_, id, data) => mapService.updateMapItem(requireId(id), data))
  ipcMain.handle('map:upsertRelation', (_, data) =>
    mapService.upsertMapRelation(parseObjectPayload<MapRelationInput>(data, 'data')))
  ipcMain.handle('map:deleteRelation', (_, id) => mapService.deleteMapRelation(requireId(id)))
  ipcMain.handle('map:delete', (_, id) => mapService.deleteMapItem(requireId(id)))
  ipcMain.handle('map:batchGenerate', (_, novelId, structure) =>
    mapService.batchGenerateMap(novelId, structure))
  ipcMain.handle('map:startAutoGenerate', (event, novelId, structure) =>
    workflowTaskService.startMapAutoGenerateWorkflow(novelId, structure, event.sender))
  ipcMain.handle('map:getAutoGenerateStatus', (_, taskId) =>
    workflowTaskService.getMapAutoGenerateStatus(taskId))
  ipcMain.handle('map:getLatestAutoGenerateTask', (_, novelId) =>
    workflowTaskService.getLatestMapAutoGenerateTask(novelId))
  ipcMain.handle('map:resumeAutoGenerate', (event, taskId) =>
    workflowTaskService.resumeWorkflowTask(taskId, event.sender))
  ipcMain.handle('map:clear', (_, novelId) => mapService.clearMapByNovel(requireId(novelId, 'novelId')))

  ipcMain.handle('worldRules:startAutoGenerate', (event, novelId, options) =>
    workflowTaskService.startWorldRulesAutoGenerateWorkflow(novelId, options, event.sender))
  ipcMain.handle('worldRules:getAutoGenerateStatus', (_, taskId) =>
    workflowTaskService.getWorldRulesAutoGenerateStatus(taskId))
  ipcMain.handle('worldRules:getLatestAutoGenerateTask', (_, novelId) =>
    workflowTaskService.getLatestWorldRulesAutoGenerateTask(novelId))
  ipcMain.handle('worldRules:resumeAutoGenerate', (event, taskId, currentRules) =>
    workflowTaskService.resumeWorldRulesAutoGenerateWorkflow(taskId, currentRules, event.sender))
  ipcMain.handle('worldRules:clearAutoGenerateDraft', (_, novelId) =>
    workflowTaskService.clearWorldRulesAutoGenerateDraft(novelId))

  ipcMain.handle('timeline:list', (_, novelId) => timelineService.listTimelineEvents(novelId))
  ipcMain.handle('timeline:query', (_, filters) => timelineService.queryTimelineEvents(filters))
  ipcMain.handle('timeline:search', (_, novelId, keyword, limit) => timelineService.searchTimelineEvents(novelId, keyword, limit))
  ipcMain.handle('timeline:getStats', (_, filters) => timelineService.getTimelineStats(filters))
  ipcMain.handle('timeline:getFilterOptions', (_, novelId) => timelineService.getTimelineFilterOptions(novelId))
  ipcMain.handle('timeline:get', (_, id) => timelineService.getTimelineEvent(id))
  ipcMain.handle('timeline:create', (_, novelId, data) => timelineService.createTimelineEvent(requireId(novelId, 'novelId'), data))
  ipcMain.handle('timeline:update', (_, id, data) => timelineService.updateTimelineEvent(requireId(id), data))
  ipcMain.handle('timeline:delete', (_, id) => timelineService.deleteTimelineEvent(requireId(id)))
  ipcMain.handle('timeline:batchUpdate', (_, ids, data) => timelineService.batchUpdateTimelineEvents(requireIds(ids), data))
  ipcMain.handle('timeline:batchDelete', (_, ids) => timelineService.batchDeleteTimelineEvents(requireIds(ids)))
  ipcMain.handle('timeline:generate', (event, novelId, options) =>
    batchWorkflowService.generateTimelineViaWorkflow(novelId, options, event.sender))
  ipcMain.handle('timeline:startAutoGenerate', (event, novelId, options) =>
    batchWorkflowService.startTimelineAutoGenerateWorkflow(novelId, options, event.sender))
  ipcMain.handle('timeline:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getTimelineAutoGenerateStatus(taskId))
  ipcMain.handle('timeline:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestTimelineAutoGenerateTask(novelId))
  ipcMain.handle('timeline:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))
  ipcMain.handle('timeline:regenerate', (_, id, options) => timelineService.regenerateTimelineEvent(id, options))
  ipcMain.handle('timeline:clear', (_, novelId) => timelineService.clearTimelineByNovel(requireId(novelId, 'novelId')))

  ipcMain.handle('item:list', (_, novelId) => itemService.listStoryItems(novelId))
  ipcMain.handle('item:query', (_, filters) => itemService.queryStoryItems(filters))
  ipcMain.handle('item:getStats', (_, filters) => itemService.getStoryItemStats(filters))
  ipcMain.handle('item:getFilterOptions', (_, novelId) => itemService.getStoryItemFilterOptions(novelId))
  ipcMain.handle('item:get', (_, id) => itemService.getStoryItem(id))
  ipcMain.handle('item:getDetailContext', (_, id) => itemService.getStoryItemDetailContext(id))
  ipcMain.handle('item:search', (_, novelId, keyword, itemKind, limit) => itemService.searchStoryItems(novelId, keyword, itemKind, limit))
  ipcMain.handle('item:create', (_, novelId, data) => itemService.createStoryItem(requireId(novelId, 'novelId'), data))
  ipcMain.handle('item:update', (_, id, data) => itemService.updateStoryItem(requireId(id), data))
  ipcMain.handle('item:delete', (_, id) => itemService.deleteStoryItem(requireId(id)))
  ipcMain.handle('item:generate', (event, novelId, options) => batchWorkflowService.generateItemsViaWorkflow(novelId, options, event.sender))
  ipcMain.handle('item:startAutoGenerate', (event, novelId, options) =>
    batchWorkflowService.startItemAutoGenerateWorkflow(novelId, options, event.sender))
  ipcMain.handle('item:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getItemAutoGenerateStatus(taskId))
  ipcMain.handle('item:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestItemAutoGenerateTask(novelId))
  ipcMain.handle('item:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))
  ipcMain.handle('item:regenerate', (_, id, options) => itemService.regenerateStoryItem(id, options))
  ipcMain.handle('item:clear', (_, novelId) => itemService.clearStoryItemsByNovel(requireId(novelId, 'novelId')))

  ipcMain.handle('outline:getArcs', (_, novelId) => {
    requireId(novelId, 'novelId')
    const db = getDb()
    return db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  })

  ipcMain.handle('outline:createArc', (_, novelId, data) => {
    requireId(novelId, 'novelId')
    requireObject(data, 'data')
    const db = getDb()
    const result = db.insert(storyArcs).values({ novelId, ...data }).run()
    markNovelContextChanged(novelId, 'Story outline changed')
    const arcId = Number(result.lastInsertRowid)
    const content = [data.arcGoal, data.arcSummary, data.growthLedger, data.costLedger].filter(Boolean).join('\n')
    if (content.trim()) {
      void discoverEntitiesFromContent({
        novelId,
        sourcePage: 'outline',
        sourceLabel: `故事弧 ${data.arcName || arcId}`,
        sourceEntityId: arcId,
        content,
      }).catch(console.error)
    }
    return arcId
  })

  ipcMain.handle('outline:updateArc', (_, id, data) => {
    requireId(id)
    requireObject(data, 'data')
    const db = getDb()
    const current = db.select().from(storyArcs).where(eq(storyArcs.id, id)).all()[0]
    db.update(storyArcs).set(data).where(eq(storyArcs.id, id)).run()
    if (current) {
      markNovelContextChanged(current.novelId, 'Story outline changed')
      const content = [data.arcGoal, data.arcSummary, data.growthLedger, data.costLedger].filter(Boolean).join('\n')
      if (content.trim()) {
        void discoverEntitiesFromContent({
          novelId: current.novelId,
          sourcePage: 'outline',
          sourceLabel: `故事弧 ${data.arcName || current.arcName || id}`,
          sourceEntityId: id,
          content,
        }).catch(console.error)
      }
    }
  })

  ipcMain.handle('outline:deleteArc', (_, id) => {
    requireId(id)
    const db = getDb()
    const current = db.select().from(storyArcs).where(eq(storyArcs.id, id)).all()[0]
    db.delete(storyArcs).where(eq(storyArcs.id, id)).run()
    if (current) {
      markNovelContextChanged(current.novelId, 'Story outline changed')
    }
  })

  ipcMain.handle('outline:clear', (_, novelId) => {
    requireId(novelId, 'novelId')
    const db = getDb()
    db.delete(storyArcs).where(eq(storyArcs.novelId, novelId)).run()
    db.update(chapters).set({
      arcId: null,
      outline: null,
      emotionTone: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.novelId, novelId)).run()
    markNovelContextChanged(novelId, 'Story outline changed')
  })

  ipcMain.handle('outline:generateArcs', async (_, novelId) => {
    const db = getDb()
    const novel = db.select().from(novelsTable).where(eq(novelsTable.id, novelId)).all()[0]
    if (!novel) throwUserFacingError('novel.notFound')

    const profile = await buildStoryProfile(novelId)
    const result = await taskService.runChatTask({
      type: 'generate_arcs',
      novelId,
      messages: [{
        role: 'user',
        content: buildStoryArcPlanningPrompt({
          novelTitle: profile.novelTitle,
          genre: profile.genre,
          storyGoal: profile.storyGoal,
          coreConflict: profile.coreConflict,
          mainPlot: profile.mainPlot,
          subPlots: profile.subPlots,
          ending: profile.ending,
          totalChapters: Math.ceil((novel.targetWords || 200000) / 3000),
          rhythmSummary: profile.rhythmSummary,
          background: profile.background,
          protagonistReference: profile.protagonistReference,
          protagonistRule: profile.protagonistRule,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    const arcs = safeParseJson<Record<string, unknown>[]>(result)
    db.delete(storyArcs).where(eq(storyArcs.novelId, novelId)).run()
    db.update(chapters).set({
      arcId: null,
      outline: null,
      emotionTone: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.novelId, novelId)).run()
    for (const [index, arc] of arcs.entries()) {
      const resultArc = {
        novelId,
        arcName: typeof arc.arc_name === 'string' ? arc.arc_name : typeof arc.name === 'string' ? arc.name : `故事弧 ${index + 1}`,
        arcOrder: typeof arc.order === 'number' ? arc.order : index + 1,
        chapterStart: typeof arc.chapter_start === 'number' ? arc.chapter_start : null,
        chapterEnd: typeof arc.chapter_end === 'number' ? arc.chapter_end : null,
        arcGoal: typeof arc.arc_goal === 'string' ? arc.arc_goal : typeof arc.goal === 'string' ? arc.goal : '',
        arcSummary: typeof arc.summary === 'string' ? arc.summary : '',
        growthLedger: toLedgerText(arc.growth_ledger),
        costLedger: toLedgerText(arc.cost_ledger),
      }
      const insertResult = db.insert(storyArcs).values(resultArc).run()
      const discoveryText = [resultArc.arcGoal, resultArc.arcSummary, resultArc.growthLedger, resultArc.costLedger].filter(Boolean).join('\n')
      if (discoveryText.trim()) {
        void discoverEntitiesFromContent({
          novelId,
          sourcePage: 'outline',
          sourceLabel: `故事弧 ${resultArc.arcName}`,
          sourceEntityId: Number(insertResult.lastInsertRowid),
          content: discoveryText,
        }).catch(console.error)
      }
    }

    markNovelContextChanged(novelId, 'Story outline changed')
    return arcs
  })

  ipcMain.handle('outline:generateChapterOutlines', async (_, arcId, options?: { batchSize?: number }) => {
    const db = getDb()
    const arc = db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).all()[0]
    if (!arc) throwUserFacingError('storyArc.notFound')

    const novel = db.select().from(novelsTable).where(eq(novelsTable.id, arc.novelId)).all()[0]
    if (!novel) throwUserFacingError('novel.notFound')

    const chapterStart = arc.chapterStart || 1
    const chapterEnd = arc.chapterEnd || Math.max(chapterStart, chapterStart + 9)
    const batchSize = Math.max(1, Math.min(Number(options?.batchSize || 4), 6))
    const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, arc.novelId)).all()
    const outlinedNums = new Set(
      chapterRows
        .filter((chapter) => chapter.chapterNum >= chapterStart && chapter.chapterNum <= chapterEnd)
        .filter((chapter) => typeof chapter.outline === 'string' && chapter.outline.trim())
        .map((chapter) => chapter.chapterNum),
    )

    let batchStart: number | null = null
    for (let chapterNum = chapterStart; chapterNum <= chapterEnd; chapterNum += 1) {
      if (!outlinedNums.has(chapterNum)) {
        batchStart = chapterNum
        break
      }
    }

    if (!batchStart) {
      return {
        generatedCount: 0,
        completed: true,
        batchStart: null,
        batchEnd: null,
        message: '当前故事弧的章节细纲已补齐。',
      }
    }

    let batchEnd = batchStart
    let slotCount = 1
    while (batchEnd < chapterEnd && slotCount < batchSize) {
      const nextChapterNum = batchEnd + 1
      if (outlinedNums.has(nextChapterNum)) break
      batchEnd = nextChapterNum
      slotCount += 1
    }

    const context = await buildOutlineGenerationContext(arcId)

    // 收集已有章节大纲用于差异化约束
    const existingOutlines = chapterRows
      .filter((chapter) => outlinedNums.has(chapter.chapterNum) && chapter.outline)
      .sort((a, b) => a.chapterNum - b.chapterNum)
      .slice(-6)
      .map((chapter) => `第${chapter.chapterNum}章《${chapter.title || '无标题'}》：${(chapter.outline || '').split('\n')[0].slice(0, 60)}`)
      .join('\n')

    const result = await taskService.runChatTask({
      type: 'chapter_outline',
      novelId: arc.novelId,
      messages: [{
        role: 'user',
        content: buildChapterOutlinePlanningPrompt({
          novelTitle: context.profile.novelTitle,
          genre: context.profile.genre,
          storyGoal: context.profile.storyGoal,
          coreConflict: context.profile.coreConflict,
          mainPlot: context.profile.mainPlot,
          arcName: arc.arcName,
          arcGoal: arc.arcGoal || '',
          arcSummary: arc.arcSummary || '',
          arcGrowthLedger: arc.growthLedger || '',
          arcCostLedger: arc.costLedger || '',
          chapterStart: batchStart,
          chapterEnd: batchEnd,
          previousSummary: context.previousSummary,
          characterStates: context.characterStates,
          continuitySummary: context.continuitySummary,
          openLoops: context.openLoops,
          worldRulesSummary: context.worldRulesSummary,
          previousChapterOutlines: existingOutlines || undefined,
          protagonistReference: context.profile.protagonistReference,
          protagonistRule: context.profile.protagonistRule,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    const outlines = safeParseJson<Record<string, unknown>[]>(result)
    let generatedCount = 0

    for (const outline of outlines) {
      const chapterNum = typeof outline.chapter_num === 'number'
        ? outline.chapter_num
        : typeof outline.num === 'number'
          ? outline.num
          : 0
      if (!chapterNum || chapterNum < batchStart || chapterNum > batchEnd) continue

      const existing = chapterRows.find((chapter) => chapter.chapterNum === chapterNum)
      const outlineText = formatGeneratedOutline(outline)
      const title = typeof outline.title === 'string' ? outline.title : `第${chapterNum}章`
      const emotionTone = typeof outline.emotion_tone === 'string' ? outline.emotion_tone : ''

      let chapterId = existing?.id
      if (existing) {
        db.update(chapters).set({
          title,
          outline: outlineText,
          emotionTone,
          arcId,
        }).where(eq(chapters.id, existing.id)).run()
      } else {
        const insertResult = db.insert(chapters).values({
          novelId: arc.novelId,
          chapterNum,
          title,
          outline: outlineText,
          emotionTone,
          arcId,
          status: 'outline',
          targetWords: 3000,
          contextVersion: novel.contextVersion || 1,
          staleReasonJson: JSON.stringify([]),
        }).run()
        chapterId = Number(insertResult.lastInsertRowid)
      }
      if (outlineText.trim()) {
        void discoverEntitiesFromContent({
          novelId: arc.novelId,
          sourcePage: 'outline',
          sourceLabel: `第${chapterNum}章 ${title}`.trim(),
          sourceEntityId: chapterId,
          content: outlineText,
        }).catch(console.error)
      }
      generatedCount += 1
    }

    const refreshedChapters = db.select().from(chapters).where(eq(chapters.novelId, arc.novelId)).all()
    const refreshedOutlinedNums = new Set(
      refreshedChapters
        .filter((chapter) => chapter.chapterNum >= chapterStart && chapter.chapterNum <= chapterEnd)
        .filter((chapter) => typeof chapter.outline === 'string' && chapter.outline.trim())
        .map((chapter) => chapter.chapterNum),
    )
    const completed = Array.from({ length: chapterEnd - chapterStart + 1 }, (_, index) => chapterStart + index)
      .every((chapterNum) => refreshedOutlinedNums.has(chapterNum))

    if (generatedCount > 0) {
      markNovelContextChanged(arc.novelId, 'Chapter outlines changed')
    }

    return {
      generatedCount,
      completed,
      batchStart,
      batchEnd,
      message: completed
        ? `第${batchStart}至第${batchEnd}章细纲已生成，当前故事弧已补齐。`
        : `第${batchStart}至第${batchEnd}章细纲已生成，可继续生成下一批。`,
    }
  })

  ipcMain.handle('thread:list', (_, novelId) => storyThreadService.listStoryThreads(novelId))
  ipcMain.handle('thread:query', (_, filters) => storyThreadService.queryStoryThreads(filters))
  ipcMain.handle('thread:getStats', (_, filters) => storyThreadService.getStoryThreadStats(filters))
  ipcMain.handle('thread:get', (_, id) => storyThreadService.getStoryThread(id))
  ipcMain.handle('thread:getForeshadowSnapshot', (_, novelId) => storyThreadService.getForeshadowSnapshot(requireId(novelId, 'novelId')))
  ipcMain.handle('thread:generate', (event, novelId, options) => batchWorkflowService.generateStoryThreadsViaWorkflow(novelId, options, event.sender))
  ipcMain.handle('thread:startAutoGenerate', (event, novelId, options) =>
    batchWorkflowService.startStoryThreadAutoGenerateWorkflow(novelId, options, event.sender))
  ipcMain.handle('thread:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getStoryThreadAutoGenerateStatus(taskId))
  ipcMain.handle('thread:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestStoryThreadAutoGenerateTask(novelId))
  ipcMain.handle('thread:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))
  ipcMain.handle('thread:create', (_, novelId, data) => storyThreadService.createStoryThread(requireId(novelId, 'novelId'), data))
  ipcMain.handle('thread:update', (_, id, data) => storyThreadService.updateStoryThread(requireId(id), data))
  ipcMain.handle('thread:delete', (_, id) => storyThreadService.deleteStoryThread(requireId(id)))
  ipcMain.handle('thread:batchUpdate', (_, ids, data) => storyThreadService.batchUpdateStoryThreads(requireIds(ids), data))
  ipcMain.handle('thread:batchDelete', (_, ids) => storyThreadService.batchDeleteStoryThreads(requireIds(ids)))
  ipcMain.handle('thread:regenerate', (_, id, options) => storyThreadService.regenerateStoryThread(id, options))
  ipcMain.handle('faction:list', (_, novelId) => factionService.listFactions(requireId(novelId, 'novelId')))
  ipcMain.handle('faction:query', (_, filters) => factionService.queryFactions(filters))
  ipcMain.handle('faction:getStats', (_, filters) => factionService.getFactionStats(filters))
  ipcMain.handle('faction:get', (_, id) => factionService.getFaction(requireId(id)))
  ipcMain.handle('faction:search', (_, novelId, keyword, limit) => factionService.searchFactions(requireId(novelId, 'novelId'), keyword, limit))
  ipcMain.handle('faction:create', (_, novelId, data) => factionService.createFaction(requireId(novelId, 'novelId'), data))
  ipcMain.handle('faction:update', (_, id, data) => factionService.updateFaction(requireId(id), data))
  ipcMain.handle('faction:delete', (_, id) => factionService.deleteFaction(requireId(id)))
  ipcMain.handle('faction:resolveNameOptions', (_, novelId) => factionService.resolveFactionNameOptions(requireId(novelId, 'novelId')))
  ipcMain.handle('glossary:list', (_, novelId) => glossaryService.listGlossary(requireId(novelId, 'novelId')))
  ipcMain.handle('glossary:query', (_, filters) => glossaryService.queryGlossary(filters))
  ipcMain.handle('glossary:getStats', (_, filters) => glossaryService.getGlossaryStats(filters))
  ipcMain.handle('glossary:get', (_, id) => glossaryService.getGlossaryEntry(requireId(id)))
  ipcMain.handle('glossary:search', (_, novelId, keyword, limit) => glossaryService.searchGlossary(requireId(novelId, 'novelId'), keyword, limit))
  ipcMain.handle('glossary:create', (_, novelId, data) => glossaryService.createGlossaryEntry(requireId(novelId, 'novelId'), data))
  ipcMain.handle('glossary:update', (_, id, data) => glossaryService.updateGlossaryEntry(requireId(id), data))
  ipcMain.handle('glossary:delete', (_, id) => glossaryService.deleteGlossaryEntry(requireId(id)))
  ipcMain.handle('sceneTemplate:list', (_, filters) => sceneTemplateService.listSceneTemplates(filters || {}))
  ipcMain.handle('sceneTemplate:query', (_, filters) => sceneTemplateService.querySceneTemplates(filters || {}))
  ipcMain.handle('sceneTemplate:getStats', (_, filters) => sceneTemplateService.getSceneTemplateStats(filters || {}))
  ipcMain.handle('sceneTemplate:get', (_, id) => sceneTemplateService.getSceneTemplate(requireId(id)))
  ipcMain.handle('sceneTemplate:search', (_, novelId, genreId, keyword, limit) => sceneTemplateService.searchSceneTemplates(requireId(novelId, 'novelId'), typeof genreId === 'number' ? genreId : undefined, keyword, limit))
  ipcMain.handle('sceneTemplate:create', (_, data) => sceneTemplateService.createSceneTemplate(data))
  ipcMain.handle('sceneTemplate:update', (_, id, data) => sceneTemplateService.updateSceneTemplate(requireId(id), data))
  ipcMain.handle('sceneTemplate:delete', (_, id) => sceneTemplateService.deleteSceneTemplate(requireId(id)))
  ipcMain.handle('subplot:generate', (event, request) => batchWorkflowService.generateSubplotsViaWorkflow(request, event.sender))
  ipcMain.handle('subplot:startAutoGenerate', (event, request) =>
    batchWorkflowService.startSubplotAutoGenerateWorkflow(request, event.sender))
  ipcMain.handle('subplot:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getSubplotAutoGenerateStatus(taskId))
  ipcMain.handle('subplot:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestSubplotAutoGenerateTask(novelId))
  ipcMain.handle('subplot:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))

  ipcMain.handle('history:listRecent', (_, novelId, limit) => historyService.listRecentOperationLogs(novelId, limit))
  ipcMain.handle('history:getLatestUndoable', (_, novelId) => historyService.getLatestUndoableOperation(novelId))
  ipcMain.handle('history:undo', (_, logId) => historyService.undoOperation(logId))

  ipcMain.handle('revision:list', (_, novelId) => revisionTaskService.listRevisionTasks(novelId))
  ipcMain.handle('revision:query', (_, filters) => revisionTaskService.queryRevisionTasks(filters))
  ipcMain.handle('revision:getStats', (_, filters) => revisionTaskService.getRevisionTaskStats(filters))
  ipcMain.handle('revision:getSnapshot', (_, novelId) => revisionTaskService.getRevisionCenterSnapshot(novelId))
  ipcMain.handle('revision:get', (_, id) => revisionTaskService.getRevisionTask(id))
  ipcMain.handle('revision:create', (_, novelId, data) => revisionTaskService.createRevisionTask(requireId(novelId, 'novelId'), data))
  ipcMain.handle('revision:update', (_, id, data) => revisionTaskService.updateRevisionTask(requireId(id), data))
  ipcMain.handle('revision:delete', (_, id) => revisionTaskService.deleteRevisionTask(requireId(id)))
  ipcMain.handle('revision:autoFix', (_, id) => revisionTaskService.autoFixRevisionTask(id))

  ipcMain.handle('model:list', () => {
    const db = getDb()
    return db.select().from(modelConfigs).all().map((config) => ({
      ...config,
      temperature: modelService.normalizeModelTemperature(config.temperature, config.provider),
      maxTokens: modelService.normalizeModelMaxTokens(config.maxTokens, config.provider),
      maxConcurrency: modelService.normalizeModelConcurrency(config.maxConcurrency),
      maxContextTokens: modelService.normalizeModelContextTokens(config.maxContextTokens),
      apiKey: config.apiKey ? '已设置' : '',
    }))
  })

  ipcMain.handle('model:create', (_, data) => {
    requireObject(data, 'data')
    const db = getDb()
    const encryptedKey = data.apiKey ? encryptApiKey(data.apiKey) : null
    const provider = typeof data.provider === 'string' ? data.provider : 'openai'
    const result = db.insert(modelConfigs).values({
      ...data,
      temperature: modelService.normalizeModelTemperature(data.temperature, provider),
      maxTokens: modelService.normalizeModelMaxTokens(data.maxTokens, provider),
      maxContextTokens: modelService.normalizeModelContextTokens(data.maxContextTokens),
      maxConcurrency: modelService.normalizeModelConcurrency(data.maxConcurrency),
      apiKey: encryptedKey,
    }).run()
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('model:update', (_, id, data) => {
    requireId(id)
    requireObject(data, 'data')
    const db = getDb()
    const existing = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).all()[0]
    const provider = typeof data.provider === 'string'
      ? data.provider
      : (existing?.provider || 'openai')
    if (data.apiKey && data.apiKey !== '已设置') {
      data.apiKey = encryptApiKey(data.apiKey)
    } else if (data.apiKey === '已设置') {
      delete data.apiKey
    }
    if ('temperature' in data) {
      data.temperature = modelService.normalizeModelTemperature(data.temperature, provider)
    }
    if ('maxTokens' in data) {
      data.maxTokens = modelService.normalizeModelMaxTokens(data.maxTokens, provider)
    }
    if ('maxContextTokens' in data) {
      data.maxContextTokens = modelService.normalizeModelContextTokens(data.maxContextTokens)
    }
    if ('maxConcurrency' in data) {
      data.maxConcurrency = modelService.normalizeModelConcurrency(data.maxConcurrency)
    }
    db.update(modelConfigs).set(data).where(eq(modelConfigs.id, id)).run()
  })

  ipcMain.handle('model:delete', (_, id) => {
    requireId(id)
    const db = getDb()
    db.delete(modelConfigs).where(eq(modelConfigs.id, id)).run()
  })

  ipcMain.handle('model:setDefault', (_, id) => {
    requireId(id)
    const db = getDb()
    db.update(modelConfigs).set({ isDefault: 0 }).run()
    db.update(modelConfigs).set({ isDefault: 1 }).where(eq(modelConfigs.id, id)).run()
  })

  ipcMain.handle('model:test', (_, id) => modelService.testAdapter(id))

  ipcMain.handle('template:list', (_, type) => {
    const db = getDb()
    if (type) {
      return db.select().from(templates).where(eq(templates.type, type)).all()
    }
    return db.select().from(templates).all()
  })

  ipcMain.handle('template:create', (_, data) => {
    requireObject(data, 'data')
    const db = getDb()
    const result = db.insert(templates).values(data).run()
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('template:update', (_, id, data) => {
    requireId(id)
    requireObject(data, 'data')
    const db = getDb()
    db.update(templates).set(data).where(eq(templates.id, id)).run()
  })

  ipcMain.handle('template:delete', (_, id) => {
    requireId(id)
    const db = getDb()
    const template = db.select().from(templates).where(eq(templates.id, id)).all()[0]
    if (template?.isBuiltin) throwUserFacingError('template.builtinDeleteBlocked')
    db.delete(templates).where(eq(templates.id, id)).run()
  })

  ipcMain.handle('prompt:list', () => promptOverrideService.listPromptOverrides())
  ipcMain.handle('prompt:save', (_, key, content) => {
    requireString(key, 'key')
    return promptOverrideService.savePromptOverride(key, content)
  })
  ipcMain.handle('prompt:delete', (_, key) => {
    requireString(key, 'key')
    return promptOverrideService.deletePromptOverride(key)
  })

  ipcMain.handle('task:list', (_, novelId) => taskService.listTasks(novelId))
  ipcMain.handle('task:query', (_, filters) => taskService.queryTasks(filters || {}))
  ipcMain.handle('task:getStats', (_, novelId) => taskService.getTaskStats(novelId))
  ipcMain.handle('task:clearHistory', (_, filters) => taskService.clearTaskHistory(filters || {}))

  ipcMain.handle('task:get', (_, id) => {
    const db = getDb()
    return db.select().from(tasks).where(eq(tasks.id, id)).all()[0] || null
  })

  ipcMain.handle('task:cancel', (event, id) => taskService.cancelTask(id, event.sender))
  ipcMain.handle('task:retry', async (event, id) => {
    const db = getDb()
    const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0]
    if (!task) throwUserFacingError('task.notFound', { id })

    if (task.type === 'chapter_write' && task.relatedEntityType === 'chapter' && task.relatedEntityId) {
      return chapterService.generateChapterContent(task.relatedEntityId, event.sender)
    }

    if (task.type === 'subplot_framework') {
      return subplotService.retrySubplotBatch(id)
    }

    return taskService.retryTask(id, event.sender)
  })

  ipcMain.handle('workflow:list', (_, novelId) => workflowTaskService.listWorkflowTasks(novelId))
  ipcMain.handle('workflow:get', (_, id) => workflowTaskService.getWorkflowTask(id))
  ipcMain.handle('workflow:cancel', (event, id) => taskService.cancelTask(id, event.sender))
  ipcMain.handle('workflow:resume', (event, id) => workflowTaskService.resumeWorkflowTask(id, event.sender))

  ipcMain.handle('premiseDraft:getLatest', (_, novelId: number) => premiseService.getLatestPremiseDraft(novelId))
  ipcMain.handle('premiseDraft:markApplied', (_, taskId: number, appliedMode: 'replace' | 'fill_blanks') =>
    premiseService.markPremiseDraftApplied(taskId, appliedMode))
  ipcMain.handle('premiseDraft:clearAll', (_, novelId: number) => premiseService.clearPremiseDrafts(novelId))
  ipcMain.handle('planningDraft:getLatest', (_, novelId: number, pageKey: PlanningDraftPageKey) =>
    planningDraftService.getLatestPlanningDraft(novelId, pageKey))
  ipcMain.handle('planningDraft:save', (_, data: {
    novelId: number
    pageKey: PlanningDraftPageKey
    data: Record<string, unknown>
    warnings?: string[]
    sourcePage?: string
    inputSummary?: string
    lintWarnings?: string[]
    rawOutputs?: string[]
    rejectionReason?: string
  }) => planningDraftService.savePlanningDraft(data))
  ipcMain.handle('planningDraft:markApplied', (_, taskId: number) =>
    planningDraftService.markPlanningDraftApplied(taskId))
  ipcMain.handle('planningDraft:finalize', (_, taskId: number, finalData: Record<string, unknown>) =>
    planningDraftService.finalizePlanningDraft(taskId, finalData))
  ipcMain.handle('planningDraft:clear', (_, novelId: number, pageKey: PlanningDraftPageKey) =>
    planningDraftService.clearPlanningDrafts(novelId, pageKey))

  ipcMain.handle('ai:expandBackground', async (_, input: {
    userBackground: string
    genreId: number
    worldTemplateId?: number
    modelConfigId?: number
  }) => {
    const db = getDb()
    const genreRows = input.genreId
      ? db.select().from(genresTable).where(eq(genresTable.id, input.genreId)).all()
      : []
    const genre = genreRows[0]?.name || '未知题材'

    let worldTemplateSummary = ''
    if (input.worldTemplateId) {
      const template = db.select().from(templates).where(eq(templates.id, input.worldTemplateId)).all()[0]
      worldTemplateSummary = template?.name || ''
    }

    const runBackgroundPrompt = async (content: string) => taskService.runChatTask({
      type: 'expand_background',
      retryable: true,
      messages: [{
        role: 'user',
        content,
      }],
      modelConfigId: input.modelConfigId,
    })

    const initialRaw = await runBackgroundPrompt(expandBackgroundPrompt({
      userBackground: input.userBackground,
      genre,
      worldTemplateSummary,
    }))

    let parsed = normalizeBackgroundExpansionPayload(
      safeParseJson(initialRaw),
      genre,
      input.userBackground,
    )
    let violations = collectForbiddenBackgroundNaming(parsed, input.userBackground)

    if (violations.length > 0) {
      const repairedRaw = await runBackgroundPrompt(buildBackgroundExpansionRepairPrompt({
        userBackground: input.userBackground,
        genre,
        worldTemplateSummary,
        invalidResult: parsed,
        violations,
      }))

      parsed = normalizeBackgroundExpansionPayload(
        safeParseJson(repairedRaw),
        genre,
        input.userBackground,
      )
      violations = collectForbiddenBackgroundNaming(parsed, input.userBackground)
    }

    if (violations.length > 0) {
      parsed = sanitizeBackgroundExpansionResult(parsed, violations, genre)
      violations = collectForbiddenBackgroundNaming(parsed, input.userBackground)
    }

    if (violations.length > 0) {
      const names = violations.map((item) => item.token).join('、')
      throwUserFacingError('novel.expandUnauthorizedNames', { names })
    }

    return parsed
  })

  ipcMain.handle('ai:generateCoreSettings', (event, data: CoreSettingsGenerationRequest) =>
    coreSettingsService.generateCoreSettings(data, event.sender))
  ipcMain.handle('ai:generatePremise', (event, data: PremiseGenerationRequest) =>
    premiseService.generatePremise(data, event.sender))
  ipcMain.handle('ai:generateProjectBrief', (_, data: ProjectBriefGenerationRequest) =>
    projectBriefService.generateProjectBrief(data))
  ipcMain.handle('ai:generateThemeVoice', (_, data: ThemeVoiceGenerationRequest) =>
    themeVoiceService.generateThemeVoice(data))
  ipcMain.handle('ai:generateWorldRules', (event, data: WorldRulesGenerationRequest) =>
    worldRulesService.generateWorldRules(data, event.sender))

  ipcMain.handle('ai:generateCharacter', (_, novelId, opts) =>
    characterService.generateProtagonist(novelId, opts))
  ipcMain.handle('ai:generateRelations', (_, novelId) =>
    characterService.generateCharacterRelations(novelId))

  ipcMain.handle('ai:rewriteParagraph', async (_, data: {
    originalParagraph: string
    contextBefore: string
    specificRequirements: string
    modelConfigId?: number
  }) => {
    const result = await taskService.runChatTask({
      type: 'review',
      retryable: true,
      messages: [{
        role: 'user',
        content: rewriteParagraphPrompt({
          originalParagraph: data.originalParagraph,
          contextBefore: data.contextBefore,
          specificRequirements: data.specificRequirements,
        }),
      }],
      modelConfigId: data.modelConfigId,
    })

    return result
  })

  ipcMain.handle('ai:generateSubplotBatch', async (_, data: SubplotGenerationRequest) => {
    return subplotService.generateSubplotBatch(data)
  })

  ipcMain.handle('ai:runPrompt', async (_, data: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    count?: number
    modelConfigId?: number
  }) => {
    const count = Math.min(Math.max(data.count || 1, 1), 3)
    const accepted: string[] = []
    const rejectedDigests: string[] = []
    const maxAttempts = Math.max(count, count * 3)
    let lastOutput = ''

    for (let attemptNumber = 1; attemptNumber <= maxAttempts && accepted.length < count; attemptNumber += 1) {
      const messages = appendVariationMessage(data.messages, {
        attemptNumber,
        candidateIndex: accepted.length + 1,
        totalCandidates: count,
        rejectedDigests,
      })

      const output = await taskService.runChatTask({
        type: 'review',
        retryable: true,
        messages,
        modelConfigId: data.modelConfigId,
      })

      lastOutput = output

      if (isCandidateTooSimilar(output, accepted)) {
        rejectedDigests.push(buildVariationDigest(output))
        continue
      }

      accepted.push(output)
    }

    if (accepted.length === 0 && lastOutput) {
      accepted.push(lastOutput)
    }

    return accepted
  })

  ipcMain.handle('ai:scoreContent', async (_, data: {
    contentType: string
    content: string
    genreContext: string
    novelBackground: string
    modelConfigId?: number
  }) => {
    const result = await taskService.runChatTask({
      type: 'review',
      retryable: true,
      messages: [{
        role: 'user',
        content: contentScoringPrompt(data),
      }],
      modelConfigId: data.modelConfigId,
    })

    return safeParseJson(result)
  })
}








