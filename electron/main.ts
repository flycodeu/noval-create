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
import type { PlanningDraftPageKey } from '../src/types'
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
import * as itemService from './services/item.service'
import * as mapService from './services/map.service'
import * as modelService from './services/model.service'
import { encryptApiKey } from './services/model.service'
import * as novelService from './services/novel.service'
import * as subplotService from './services/subplot.service'
import * as themeVoiceService from './services/theme-voice.service'
import * as timelineService from './services/timeline.service'
import * as historyService from './services/history.service'
import * as storyMemoryService from './services/story-memory.service'
import * as promptOverrideService from './services/prompt-override.service'
import * as revisionTaskService from './services/revision-task.service'
import * as storyStructureService from './services/story-structure.service'
import * as storyThreadService from './services/story-thread.service'
import * as workflowTaskService from './services/workflow-task.service'
import { discoverEntitiesFromContent } from './services/entity-discovery.service'
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
  ipcMain.handle('novel:get', (_, id) => novelService.getNovel(id))
  ipcMain.handle('novel:create', (_, data) => novelService.createNovel(data))
  ipcMain.handle('novel:update', (_, id, data) => novelService.updateNovel(id, data))
  ipcMain.handle('novel:delete', (_, id) => novelService.deleteNovel(id))
  ipcMain.handle('novel:export', (_, id, format) => exportService.exportNovel(id, format))
  ipcMain.handle('novel:stats', (_, id) => novelService.getNovelStats(id))
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
  ipcMain.handle('structure:createVolume', (_, novelId, data) => storyStructureService.createStoryVolume(novelId, data))
  ipcMain.handle('structure:updateVolume', (_, id, data) => storyStructureService.updateStoryVolume(id, data))
  ipcMain.handle('structure:deleteVolume', (_, id) => storyStructureService.deleteStoryVolume(id))
  ipcMain.handle('structure:reorderVolumes', (_, novelId, orderedIds) => storyStructureService.reorderStoryVolumes(novelId, orderedIds))
  ipcMain.handle('structure:createPart', (_, volumeId, data) => storyStructureService.createStoryPart(volumeId, data))
  ipcMain.handle('structure:updatePart', (_, id, data) => storyStructureService.updateStoryPart(id, data))
  ipcMain.handle('structure:deletePart', (_, id) => storyStructureService.deleteStoryPart(id))
  ipcMain.handle('structure:reorderParts', (_, novelId, operations) => storyStructureService.reorderStoryParts(novelId, operations))
  ipcMain.handle('structure:reorderPartsInVolume', (_, volumeId, orderedIds) => storyStructureService.reorderStoryPartsInVolume(volumeId, orderedIds))
  ipcMain.handle('structure:assignChapter', (_, chapterId, partId) => storyStructureService.assignChapterToPart(chapterId, partId))
  ipcMain.handle('structure:createSegment', (_, chapterId, data) => storyStructureService.createChapterSegment(chapterId, data))
  ipcMain.handle('structure:updateSegment', (_, id, data) => storyStructureService.updateChapterSegment(id, data))
  ipcMain.handle('structure:deleteSegment', (_, id) => storyStructureService.deleteChapterSegment(id))
  ipcMain.handle('structure:reorderSegments', (_, chapterId, orderedIds) => storyStructureService.reorderChapterSegments(chapterId, orderedIds))
  ipcMain.handle('structure:compileChapter', (_, chapterId) => storyStructureService.compileChapterFromSegments(chapterId))
  ipcMain.handle('structure:refreshCheckpoints', (_, novelId) => storyMemoryService.refreshStoryMemoryCheckpoints(novelId))
  ipcMain.handle('structure:applyBatchPlan', (_, novelId, plan) => storyStructureService.applyStructureBatchPlan(novelId, plan))
  ipcMain.handle('structure:previewBatchEdit', (_, novelId, operations) => storyStructureService.previewStructureBatchEdit(novelId, operations))
  ipcMain.handle('structure:applyBatchEdit', (_, novelId, operations) => storyStructureService.applyStructureBatchEdit(novelId, operations))

  ipcMain.handle('chapter:list', (_, novelId) => chapterService.listChapters(novelId))
  ipcMain.handle('chapter:get', (_, id) => chapterService.getChapter(id))
  ipcMain.handle('chapter:create', (_, novelId, data) => chapterService.createChapter(novelId, data))
  ipcMain.handle('chapter:update', (_, id, data, options) => chapterService.updateChapter(id, data, options))
  ipcMain.handle('chapter:delete', (_, id) => chapterService.deleteChapter(id))
  ipcMain.handle('chapter:listVersions', (_, chapterId) => chapterService.listChapterVersions(chapterId))
  ipcMain.handle('chapter:restoreVersion', (_, versionId) => chapterService.restoreChapterVersion(versionId))
  ipcMain.handle('chapter:batchUpdate', (_, ids, data) => chapterService.batchUpdateChapters(ids, data))
  ipcMain.handle('chapter:batchDelete', (_, ids) => chapterService.batchDeleteChapters(ids))
  ipcMain.handle('chapter:batchRenumber', (_, ids, startChapterNum) => chapterService.batchRenumberChapters(ids, startChapterNum))
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
  ipcMain.handle('character:create', (_, novelId, data) => characterService.createCharacter(novelId, data))
  ipcMain.handle('character:update', (_, id, data) => characterService.updateCharacter(id, data))
  ipcMain.handle('character:delete', (_, id) => characterService.deleteCharacter(id))
  ipcMain.handle('character:regenerate', (_, id) => characterService.regenerateCharacter(id))
  ipcMain.handle('character:getRelations', (_, novelId) => characterService.getCharacterRelations(novelId))
  ipcMain.handle('character:generateProtagonist', (_, novelId, opts) =>
    characterService.generateProtagonist(novelId, opts))
  ipcMain.handle('character:batchGenerate', (event, novelId, opts) =>
    characterService.batchGenerateCharacters(novelId, opts, event.sender))
  ipcMain.handle('character:generateRelations', (_, novelId) =>
    characterService.generateCharacterRelations(novelId))
  ipcMain.handle('character:upsertRelation', (_, data) => characterService.upsertRelation(data))
  ipcMain.handle('character:clear', (_, novelId) => characterService.clearCharactersByNovel(novelId))

  ipcMain.handle('map:getTree', (_, novelId) => mapService.getMapTree(novelId))
  ipcMain.handle('map:queryNodes', (_, filters) => mapService.queryMapNodes(filters))
  ipcMain.handle('map:getGraph', (_, filters) => mapService.getMapGraph(filters))
  ipcMain.handle('map:getRelations', (_, novelId, focusNodeId) => mapService.getMapRelations(novelId, focusNodeId))
  ipcMain.handle('map:getStats', (_, novelId) => mapService.getMapStats(novelId))
  ipcMain.handle('map:getNode', (_, id) => mapService.getMapNode(id))
  ipcMain.handle('map:searchNodes', (_, novelId, keyword, limit) => mapService.searchMapNodes(novelId, keyword, limit))
  ipcMain.handle('map:create', (_, novelId, data) => mapService.createMapItem(novelId, data))
  ipcMain.handle('map:update', (_, id, data) => mapService.updateMapItem(id, data))
  ipcMain.handle('map:upsertRelation', (_, data) => mapService.upsertMapRelation(data))
  ipcMain.handle('map:deleteRelation', (_, id) => mapService.deleteMapRelation(id))
  ipcMain.handle('map:delete', (_, id) => mapService.deleteMapItem(id))
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
  ipcMain.handle('map:clear', (_, novelId) => mapService.clearMapByNovel(novelId))

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
  ipcMain.handle('timeline:create', (_, novelId, data) => timelineService.createTimelineEvent(novelId, data))
  ipcMain.handle('timeline:update', (_, id, data) => timelineService.updateTimelineEvent(id, data))
  ipcMain.handle('timeline:delete', (_, id) => timelineService.deleteTimelineEvent(id))
  ipcMain.handle('timeline:batchUpdate', (_, ids, data) => timelineService.batchUpdateTimelineEvents(ids, data))
  ipcMain.handle('timeline:batchDelete', (_, ids) => timelineService.batchDeleteTimelineEvents(ids))
  ipcMain.handle('timeline:generate', (_, novelId, options) =>
    timelineService.generateTimelineEvents(novelId, options))
  ipcMain.handle('timeline:regenerate', (_, id, options) => timelineService.regenerateTimelineEvent(id, options))
  ipcMain.handle('timeline:clear', (_, novelId) => timelineService.clearTimelineByNovel(novelId))

  ipcMain.handle('item:list', (_, novelId) => itemService.listStoryItems(novelId))
  ipcMain.handle('item:query', (_, filters) => itemService.queryStoryItems(filters))
  ipcMain.handle('item:getStats', (_, filters) => itemService.getStoryItemStats(filters))
  ipcMain.handle('item:getFilterOptions', (_, novelId) => itemService.getStoryItemFilterOptions(novelId))
  ipcMain.handle('item:get', (_, id) => itemService.getStoryItem(id))
  ipcMain.handle('item:getDetailContext', (_, id) => itemService.getStoryItemDetailContext(id))
  ipcMain.handle('item:search', (_, novelId, keyword, itemKind, limit) => itemService.searchStoryItems(novelId, keyword, itemKind, limit))
  ipcMain.handle('item:create', (_, novelId, data) => itemService.createStoryItem(novelId, data))
  ipcMain.handle('item:update', (_, id, data) => itemService.updateStoryItem(id, data))
  ipcMain.handle('item:delete', (_, id) => itemService.deleteStoryItem(id))
  ipcMain.handle('item:generate', (_, novelId, options) => itemService.generateStoryItems(novelId, options))
  ipcMain.handle('item:regenerate', (_, id, options) => itemService.regenerateStoryItem(id, options))
  ipcMain.handle('item:clear', (_, novelId) => itemService.clearStoryItemsByNovel(novelId))

  ipcMain.handle('outline:getArcs', (_, novelId) => {
    const db = getDb()
    return db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  })

  ipcMain.handle('outline:createArc', (_, novelId, data) => {
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
    const db = getDb()
    const current = db.select().from(storyArcs).where(eq(storyArcs.id, id)).all()[0]
    db.delete(storyArcs).where(eq(storyArcs.id, id)).run()
    if (current) {
      markNovelContextChanged(current.novelId, 'Story outline changed')
    }
  })

  ipcMain.handle('outline:clear', (_, novelId) => {
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
    if (!novel) throw new Error('小说不存在')

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
    if (!arc) throw new Error('故事弧不存在')

    const novel = db.select().from(novelsTable).where(eq(novelsTable.id, arc.novelId)).all()[0]
    if (!novel) throw new Error('小说不存在')

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
  ipcMain.handle('thread:generate', (_, novelId, options) => storyThreadService.generateStoryThreads(novelId, options))
  ipcMain.handle('thread:create', (_, novelId, data) => storyThreadService.createStoryThread(novelId, data))
  ipcMain.handle('thread:update', (_, id, data) => storyThreadService.updateStoryThread(id, data))
  ipcMain.handle('thread:delete', (_, id) => storyThreadService.deleteStoryThread(id))
  ipcMain.handle('thread:batchUpdate', (_, ids, data) => storyThreadService.batchUpdateStoryThreads(ids, data))
  ipcMain.handle('thread:batchDelete', (_, ids) => storyThreadService.batchDeleteStoryThreads(ids))
  ipcMain.handle('thread:regenerate', (_, id, options) => storyThreadService.regenerateStoryThread(id, options))

  ipcMain.handle('history:listRecent', (_, novelId, limit) => historyService.listRecentOperationLogs(novelId, limit))
  ipcMain.handle('history:getLatestUndoable', (_, novelId) => historyService.getLatestUndoableOperation(novelId))
  ipcMain.handle('history:undo', (_, logId) => historyService.undoOperation(logId))

  ipcMain.handle('revision:list', (_, novelId) => revisionTaskService.listRevisionTasks(novelId))
  ipcMain.handle('revision:query', (_, filters) => revisionTaskService.queryRevisionTasks(filters))
  ipcMain.handle('revision:getStats', (_, filters) => revisionTaskService.getRevisionTaskStats(filters))
  ipcMain.handle('revision:getSnapshot', (_, novelId) => revisionTaskService.getRevisionCenterSnapshot(novelId))
  ipcMain.handle('revision:get', (_, id) => revisionTaskService.getRevisionTask(id))
  ipcMain.handle('revision:create', (_, novelId, data) => revisionTaskService.createRevisionTask(novelId, data))
  ipcMain.handle('revision:update', (_, id, data) => revisionTaskService.updateRevisionTask(id, data))
  ipcMain.handle('revision:delete', (_, id) => revisionTaskService.deleteRevisionTask(id))
  ipcMain.handle('revision:autoFix', (_, id) => revisionTaskService.autoFixRevisionTask(id))

  ipcMain.handle('model:list', () => {
    const db = getDb()
    return db.select().from(modelConfigs).all().map((config) => ({
      ...config,
      maxConcurrency: modelService.normalizeModelConcurrency(config.maxConcurrency),
      apiKey: config.apiKey ? '已设置' : '',
    }))
  })

  ipcMain.handle('model:create', (_, data) => {
    const db = getDb()
    const encryptedKey = data.apiKey ? encryptApiKey(data.apiKey) : null
    const result = db.insert(modelConfigs).values({
      ...data,
      maxConcurrency: modelService.normalizeModelConcurrency(data.maxConcurrency),
      apiKey: encryptedKey,
    }).run()
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('model:update', (_, id, data) => {
    const db = getDb()
    if (data.apiKey && data.apiKey !== '已设置') {
      data.apiKey = encryptApiKey(data.apiKey)
    } else if (data.apiKey === '已设置') {
      delete data.apiKey
    }
    if ('maxConcurrency' in data) {
      data.maxConcurrency = modelService.normalizeModelConcurrency(data.maxConcurrency)
    }
    db.update(modelConfigs).set(data).where(eq(modelConfigs.id, id)).run()
  })

  ipcMain.handle('model:delete', (_, id) => {
    const db = getDb()
    db.delete(modelConfigs).where(eq(modelConfigs.id, id)).run()
  })

  ipcMain.handle('model:setDefault', (_, id) => {
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
    const db = getDb()
    const result = db.insert(templates).values(data).run()
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('template:update', (_, id, data) => {
    const db = getDb()
    db.update(templates).set(data).where(eq(templates.id, id)).run()
  })

  ipcMain.handle('template:delete', (_, id) => {
    const db = getDb()
    const template = db.select().from(templates).where(eq(templates.id, id)).all()[0]
    if (template?.isBuiltin) throw new Error('内置模板不可删除')
    db.delete(templates).where(eq(templates.id, id)).run()
  })

  ipcMain.handle('prompt:list', () => promptOverrideService.listPromptOverrides())
  ipcMain.handle('prompt:save', (_, key, content) => promptOverrideService.savePromptOverride(key, content))
  ipcMain.handle('prompt:delete', (_, key) => promptOverrideService.deletePromptOverride(key))

  ipcMain.handle('task:list', (_, novelId) => {
    const db = getDb()
    if (novelId) {
      return db.select().from(tasks).where(eq(tasks.novelId, novelId)).orderBy(desc(tasks.createdAt)).all()
    }
    return db.select().from(tasks).orderBy(desc(tasks.createdAt)).all()
  })

  ipcMain.handle('task:get', (_, id) => {
    const db = getDb()
    return db.select().from(tasks).where(eq(tasks.id, id)).all()[0] || null
  })

  ipcMain.handle('task:cancel', (event, id) => taskService.cancelTask(id, event.sender))
  ipcMain.handle('task:retry', async (event, id) => {
    const db = getDb()
    const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0]
    if (!task) throw new Error(`任务 ${id} 不存在`)

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
      throw new Error(`AI 扩写结果仍包含未授权命名：${names}。请在原始背景里先明确这些名字，或改用不带专名的描述后重试。`)
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








