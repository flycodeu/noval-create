import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { desc, eq } from 'drizzle-orm'
import type { CoreSettingsGenerationRequest } from '../src/shared/core-settings-generation'
import type { PremiseGenerationRequest } from '../src/shared/premise-generation'
import type { ProjectBriefGenerationRequest } from '../src/shared/project-brief-generation'
import type { ThemeVoiceGenerationRequest } from '../src/shared/theme-voice-generation'
import type { WorldRulesGenerationRequest } from '../src/shared/world-rules-generation'
import type { SubplotGenerationRequest } from '../src/shared/subplot-framework'
import type { AiExecutionMode } from '../src/shared/ai-execution'
import type {
  AgentToolCallRequest,
  AgentToolApprovalRequest,
  AgentToolListQuery,
} from '../src/shared/tool-contracts'
import { DESKTOP_AGENT_TOOL_SCOPES } from '../src/shared/tool-contracts'
import type {
  CharacterArcBeatInput,
  CharacterArcInput,
  CharacterRelationInput,
  MapRelationInput,
  NovelCreateInput,
  PlanningDraftPageKey,
  ResistanceBeatInput,
  ResistanceTrackInput,
  RelationshipArcInput,
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
import * as aiPatchService from './services/ai-patch.service'
import * as characterService from './services/character.service'
import * as characterArcService from './services/character-arc.service'
import * as consistencyService from './services/consistency.service'
import * as coreSettingsService from './services/core-settings.service'
import * as premiseService from './services/premise.service'
import * as planningDraftService from './services/planning-draft.service'
import * as projectBriefService from './services/project-brief.service'
import * as worldRulesService from './services/world-rules.service'
import * as exportService from './services/export.service'
import * as factionService from './services/faction.service'
import * as glossaryService from './services/glossary.service'
import * as qualityDashboardService from './services/quality-dashboard.service'
import * as qualityRepairService from './services/quality-repair.service'
import * as chapterRecallRuntimeService from './services/chapter-recall-runtime.service'
import * as storyArcProgressService from './services/story-arc-progress.service'
import * as rhythmTemplateService from './services/rhythm-template.service'
import * as embeddingService from './services/embedding.service'
import * as styleAnalysisService from './services/style-analysis.service'
import * as parallelGenerationService from './services/parallel-generation.service'
import * as batchWorkflowService from './services/batch-workflow.service'
import * as itemService from './services/item.service'
import * as mapService from './services/map.service'
import * as modelService from './services/model.service'
import { encryptApiKey } from './services/model.service'
import * as sourceSearchSettingsService from './services/source-search-settings.service'
import { throwUserFacingError } from './utils/user-facing-error'
import * as novelService from './services/novel.service'
import * as subplotService from './services/subplot.service'
import * as themeVoiceService from './services/theme-voice.service'
import * as timelineService from './services/timeline.service'
import * as historyService from './services/history.service'
import * as storyMemoryService from './services/story-memory.service'
import * as worldStateService from './services/world-state.service'
import * as promptOverrideService from './services/prompt-override.service'
import * as revisionTaskService from './services/revision-task.service'
import * as resistanceService from './services/resistance.service'
import * as sceneTemplateService from './services/scene-template.service'
import * as endgameAssetService from './services/endgame-asset.service'
import * as storyStructureService from './services/story-structure.service'
import * as outlineGenerationService from './services/outline-generation.service'
import * as storyThreadService from './services/story-thread.service'
import * as storyFactService from './services/story-fact.service'
import * as growthSystemService from './services/growth-system.service'
import * as chapterWritebackService from './services/chapter-writeback.service'
import * as assetImpactService from './services/asset-impact.service'
import * as batchWorkbenchService from './services/batch-workbench.service'
import {
  buildAiModelRouteReport,
  buildChatOptionsFromRoute,
  resolveAiExecutionMode,
} from './services/ai-engine.service'
import * as workspaceQualityService from './services/workspace-quality.service'
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
import * as taskService from './services/task.service'
import { safeParseJson } from './utils/json'
import { getNovelContextStatus, markNovelContextChanged } from './services/context-impact.service'
import { enhanceAiScoreResult } from './services/ai-score.service'
import { wrapIpcHandler } from './utils/ipc-wrapper'
import { novelForgeToolRegistry } from './application/novelforge-tool-registry'
import { consumeApprovalGrant, createApprovalGrant } from './services/approval.service'
import {
  appendVariationMessage,
  buildVariationDigest,
  isCandidateTooSimilar,
} from './services/variation-control.service'

let mainWindow: BrowserWindow | null = null

app.setName('NovelForge')

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

function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'novelforge.db')
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

function sendWindowState(win: BrowserWindow) {
  win.webContents.send('window:maximized-state', win.isMaximized())
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
    frame: false,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    autoHideMenuBar: true,
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

  mainWindow.on('maximize', () => {
    if (mainWindow) sendWindowState(mainWindow)
  })

  mainWindow.on('unmaximize', () => {
    if (mainWindow) sendWindowState(mainWindow)
  })

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) sendWindowState(mainWindow)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  Menu.setApplicationMenu(null)
  mainWindow.setMenuBarVisibility(false)
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
  const registerHandle = ipcMain.handle.bind(ipcMain)
  const handle = (
    channel: string,
    listener: Parameters<typeof ipcMain.handle>[1],
  ) => registerHandle(channel, wrapIpcHandler(channel, listener))

  handle('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.minimize()
    return null
  })

  handle('window:toggleMaximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })

  handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.close()
    return null
  })

  handle('window:isMaximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return window?.isMaximized() ?? false
  })

  handle('app:getDatabasePath', () => getDatabasePath())

  // Stable agent-tool surface. Caller identity and scopes are supplied here,
  // never accepted from renderer input.
  handle('agentTool:list', (_, query) =>
    novelForgeToolRegistry.list(
      query == null
        ? {}
        : parseObjectPayload<AgentToolListQuery>(query, 'query'),
    ))
  handle('agentTool:approve', async (event, payload) => {
    const approvalRequest = parseObjectPayload<AgentToolApprovalRequest>(payload, 'approvalRequest')
    const request = parseObjectPayload<AgentToolCallRequest>(approvalRequest.request, 'approvalRequest.request')
    const descriptor = novelForgeToolRegistry.get(request.toolId)
    if (!descriptor) return { approved: false, reason: `未知工具：${request.toolId}` }
    if (descriptor.approval !== 'always') return { approved: false, reason: '该工具不需要逐次批准。' }
    const actor = {
      type: 'human' as const,
      actorId: 'desktop-user',
      clientId: 'novelforge-desktop',
      sessionId: `web-contents-${event.sender.id}`,
    }
    const input = request.input || {}
    const summary = [
      typeof input.novelId === 'number' ? `项目 ID：${input.novelId}` : '',
      typeof input.draftArtifactId === 'string' ? `草稿：${input.draftArtifactId}` : '',
      typeof input.preflightRunId === 'number' ? `预检记录 ID：${input.preflightRunId}` : '',
      typeof input.candidateId === 'number' ? `候选稿 ID：${input.candidateId}` : '',
      typeof input.source === 'string'
        ? `评估来源：${input.source === 'author_requested' ? '作者主动' : input.source === 'platform_auto' ? '平台自动' : input.source}`
        : '',
      typeof input.outcome === 'string'
        ? `评估结果：${input.outcome === 'passed' ? '通过' : input.outcome === 'failed' ? '未通过' : input.outcome}`
        : '',
      typeof input.confirmedBy === 'string' ? `结果确认者：${input.confirmedBy}` : '',
      typeof input.failureReason === 'string' ? `失败原因：${input.failureReason.slice(0, 600)}` : '',
      typeof input.expectedContextVersion === 'number' ? `上下文版本：v${input.expectedContextVersion}` : '',
      typeof input.expectedContentHash === 'string' ? `内容哈希：${input.expectedContentHash}` : '',
      `影响级别：${descriptor.effect}`,
      '批准仅绑定本次工具与当前参数，2 分钟内有效且只能使用一次。',
    ].filter(Boolean).join('\n')
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow
    const options = {
      type: 'warning' as const,
      title: '批准 NovelForge 正式操作',
      message: descriptor.title,
      detail: summary,
      buttons: ['批准一次', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
    const choice = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    if (choice.response !== 0) return { approved: false, reason: '用户取消。' }
    return createApprovalGrant({ request, actor })
  })
  handle('agentTool:call', (event, rawRequest) => {
    const request = parseObjectPayload<AgentToolCallRequest>(rawRequest, 'request')
    const actor = {
      type: 'human' as const,
      actorId: 'desktop-user',
      clientId: 'novelforge-desktop',
      sessionId: `web-contents-${event.sender.id}`,
    }
    const trustedApprovalId = request.approvalId && consumeApprovalGrant({
      approvalId: request.approvalId,
      request,
      actor,
    })
      ? request.approvalId
      : undefined
    return novelForgeToolRegistry.invoke(request, {
        actor,
        scopes: [...DESKTOP_AGENT_TOOL_SCOPES],
        requestId: `ipc-${event.sender.id}-${Date.now()}`,
        approvalId: trustedApprovalId,
        locale: app.getLocale() || 'zh-CN',
      })
  })

  handle('novel:list', (_, filters) => novelService.listNovels(filters))
  handle('novel:get', (_, id) => novelService.getNovel(requireId(id)))
  handle('novel:create', (_, data) => novelService.createNovel(parseObjectPayload<NovelCreateInput>(data, 'data')))
  handle('novel:update', (_, id, data) => novelService.updateNovel(requireId(id), data))
  handle('novel:delete', (_, id) => novelService.deleteNovel(requireId(id)))
  handle('novel:export', (_, id, format) => exportService.exportNovel(requireId(id), format))
  handle('novel:formatForPlatform', (_, id, options) =>
    exportService.formatNovelForPlatform(requireId(id), parseObjectPayload<exportService.PlatformFormatOptions>(options || {}, 'options')))
  handle('novel:stats', (_, id) => novelService.getNovelStats(requireId(id)))

  // Quality Dashboard
  handle('quality:getDashboard', (_, novelId) => qualityDashboardService.getQualityDashboardData(novelId))
  handle('quality:backfillRecallSnapshots', (_, novelId) => chapterRecallRuntimeService.backfillMissingChapterRecallRuntimeSnapshots(novelId))
  handle('quality:createRepairTask', (_, novelId, action) =>
    qualityRepairService.createQualityRepairTask(
      requireId(novelId, 'novelId'),
      parseObjectPayload(action, 'action') as Parameters<typeof qualityRepairService.createQualityRepairTask>[1],
    ))
  handle('quality:executeRepairAction', (_, novelId, action) =>
    qualityRepairService.executeQualityRepairAction(
      requireId(novelId, 'novelId'),
      parseObjectPayload(action, 'action') as Parameters<typeof qualityRepairService.executeQualityRepairAction>[1],
    ))

  // Embedding
  handle('embedding:reindex', async (_, novelId: number) => {
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
  handle('style:analyze', (_, text: string, modelConfigId?: number) =>
    styleAnalysisService.analyzeReferenceText(text, modelConfigId))
  handle('style:create', (_, novelId: number | null, name: string, text: string, modelConfigId?: number) =>
    styleAnalysisService.createStyleFingerprint(novelId, name, text, modelConfigId))
  handle('style:createFromChapters', (_, novelId: number, name: string, chapterIds: number[], modelConfigId?: number) =>
    styleAnalysisService.createStyleFingerprintFromChapters(
      requireId(novelId, 'novelId'),
      requireString(name, 'name'),
      Array.isArray(chapterIds) ? chapterIds.map((id) => requireId(id, 'chapterId')) : [],
      modelConfigId,
    ))
  handle('style:get', (_, id: number) =>
    styleAnalysisService.getStyleFingerprint(id))
  handle('style:list', (_, novelId?: number) =>
    styleAnalysisService.listStyleFingerprints(novelId))
  handle('style:delete', (_, id: number) =>
    styleAnalysisService.deleteStyleFingerprint(requireId(id)))
  handle('style:setActive', (_, novelId: number, fingerprintId: number | null) =>
    styleAnalysisService.setActiveStyleFingerprint(
      requireId(novelId, 'novelId'),
      fingerprintId === null || fingerprintId === undefined ? null : requireId(fingerprintId, 'fingerprintId'),
    ))
  handle('style:resolveActive', (_, novelId: number) =>
    styleAnalysisService.resolveActiveStyleFingerprint(requireId(novelId, 'novelId')))
  handle('style:abTest', (_, novelId: number, fingerprintId: number, sceneBrief: string, modelConfigId?: number) =>
    styleAnalysisService.runStyleAbTest(
      requireId(novelId, 'novelId'),
      requireId(fingerprintId, 'fingerprintId'),
      requireString(sceneBrief, 'sceneBrief'),
      modelConfigId,
    ))

  // Parallel Generation
  handle('parallel:analyzePlan', (_, novelId: number, chapterStart: number, chapterEnd: number) =>
    parallelGenerationService.identifyParallelizableSegments(novelId, chapterStart, chapterEnd))
  handle('parallel:getWorldState', (_, novelId: number, atChapterNum: number) =>
    parallelGenerationService.buildSharedWorldState(novelId, atChapterNum))
  handle('parallel:mergeOutputs', (_, segments: unknown[]) =>
    parallelGenerationService.mergeParallelOutputs(segments as any))
  handle('novel:runConsistencyCheck', (_, id) => consistencyService.buildNovelConsistencyReport(id))
  handle('novel:getStoryMemory', (_, id) => storyMemoryService.buildStoryMemorySnapshot(id))
  handle('novel:getWorldStateSnapshot', (_, novelId: number, upToChapterNum?: number) =>
    worldStateService.getWorldStateContextSnapshot(requireId(novelId, 'novelId'), { upToChapterNum }))
  handle('novel:getWorldStateLedgerSnapshot', (_, novelId: number, upToChapterNum?: number) =>
    worldStateService.getWorldStateLedgerSnapshot(requireId(novelId, 'novelId'), { upToChapterNum }))
  handle('novel:getWorldStateHistory', (_, novelId: number, entityType: string, entityId: number, stateKey?: string, limit?: number) =>
    worldStateService.listWorldStateHistory(
      requireId(novelId, 'novelId'),
      requireString(entityType, 'entityType') as Parameters<typeof worldStateService.listWorldStateHistory>[1],
      requireId(entityId, 'entityId'),
      stateKey,
      typeof limit === 'number' ? limit : 12,
    ))
  handle('novel:getContextStatus', (_, id) => getNovelContextStatus(id))
  handle('novel:getImpactSummary', (_, id) => assetImpactService.getNovelAssetImpactSummary(requireId(id)))
  handle('novel:listImpactEvents', (_, id) => assetImpactService.listAssetChangeEvents(requireId(id)))

  handle('structure:getTree', (_, novelId) => storyStructureService.listStoryStructure(novelId))
  handle('structure:listVolumes', (_, novelId) => storyStructureService.listStructureVolumes(novelId))
  handle('structure:listPartsPage', (_, volumeId, page, pageSize) => storyStructureService.listStructurePartsPage(volumeId, page, pageSize))
  handle('structure:listChaptersPage', (_, partId, page, pageSize) => storyStructureService.listStructureChaptersPage(partId, page, pageSize))
  handle('structure:listSegments', (_, chapterId) => storyStructureService.listChapterSegments(chapterId))
  handle('structure:getSegment', (_, id) => storyStructureService.getChapterSegment(id))
  handle('structure:listSegmentsPage', (_, chapterId, page, pageSize) => storyStructureService.listChapterSegmentsPage(chapterId, page, pageSize))
  handle('structure:listCheckpoints', (_, novelId) => storyStructureService.listStoryCheckpoints(novelId))
  handle('structure:listCheckpointsPage', (_, filters, page, pageSize) => storyStructureService.listStoryCheckpointsPage(filters, page, pageSize))
  handle('structure:listLinkedTimelineEvents', (_, filters) => timelineService.listLinkedTimelineEvents(filters))
  handle('structure:listLinkedTimelineEventsPage', (_, filters, page, pageSize) => timelineService.listLinkedTimelineEventsPage(filters, page, pageSize))
  handle('structure:resolvePath', (_, filters) => storyStructureService.resolveStructurePath(filters))
  handle('structure:createVolume', (_, novelId, data) => storyStructureService.createStoryVolume(requireId(novelId, 'novelId'), data))
  handle('structure:updateVolume', (_, id, data) => storyStructureService.updateStoryVolume(requireId(id), data))
  handle('structure:deleteVolume', (_, id) => storyStructureService.deleteStoryVolume(requireId(id)))
  handle('structure:reorderVolumes', (_, novelId, orderedIds) => storyStructureService.reorderStoryVolumes(requireId(novelId, 'novelId'), requireIds(orderedIds, 'orderedIds')))
  handle('structure:createPart', (_, volumeId, data) => storyStructureService.createStoryPart(requireId(volumeId, 'volumeId'), data))
  handle('structure:updatePart', (_, id, data) => storyStructureService.updateStoryPart(requireId(id), data))
  handle('structure:deletePart', (_, id) => storyStructureService.deleteStoryPart(requireId(id)))
  handle('structure:reorderParts', (_, novelId, operations) => storyStructureService.reorderStoryParts(requireId(novelId, 'novelId'), operations))
  handle('structure:reorderPartsInVolume', (_, volumeId, orderedIds) => storyStructureService.reorderStoryPartsInVolume(requireId(volumeId, 'volumeId'), requireIds(orderedIds, 'orderedIds')))
  handle('structure:assignChapter', (_, chapterId, partId) => storyStructureService.assignChapterToPart(requireId(chapterId, 'chapterId'), requireId(partId, 'partId')))
  handle('structure:createSegment', (_, chapterId, data) => storyStructureService.createChapterSegment(requireId(chapterId, 'chapterId'), data))
  handle('structure:updateSegment', (_, id, data) => storyStructureService.updateChapterSegment(requireId(id), data))
  handle('structure:deleteSegment', (_, id) => storyStructureService.deleteChapterSegment(requireId(id)))
  handle('structure:reorderSegments', (_, chapterId, orderedIds) => storyStructureService.reorderChapterSegments(requireId(chapterId, 'chapterId'), requireIds(orderedIds, 'orderedIds')))
  handle('structure:compileChapter', (_, chapterId) => storyStructureService.compileChapterFromSegments(requireId(chapterId, 'chapterId')))
  handle('structure:refreshCheckpoints', (_, novelId) => storyMemoryService.refreshStoryMemoryCheckpoints(requireId(novelId, 'novelId')))
  handle('structure:getLinkageSummary', (_, novelId) => storyStructureService.getStructureLinkageSummary(requireId(novelId, 'novelId')))
  handle('structure:syncLinkage', (_, novelId) => storyStructureService.syncStructureLinkage(requireId(novelId, 'novelId')))
  handle('structure:clear', (_, novelId) => storyStructureService.clearStoryStructure(requireId(novelId, 'novelId')))
  handle('structure:applyBatchPlan', (_, novelId, plan) => storyStructureService.applyStructureBatchPlan(requireId(novelId, 'novelId'), plan))
  handle('structure:previewBatchEdit', (_, novelId, operations) => storyStructureService.previewStructureBatchEdit(requireId(novelId, 'novelId'), operations))
  handle('structure:applyBatchEdit', (_, novelId, operations) => storyStructureService.applyStructureBatchEdit(requireId(novelId, 'novelId'), operations))
  handle('endgameAsset:listCommitments', (_, novelId) => endgameAssetService.listEndgameCommitments(requireId(novelId, 'novelId')))
  handle('endgameAsset:getSummary', (_, novelId) => endgameAssetService.getEndgameAssetSummary(requireId(novelId, 'novelId')))
  handle('endgameAsset:syncFromSettings', (_, novelId, settingsJson) => endgameAssetService.syncEndgameCommitmentsFromSettings(requireId(novelId, 'novelId'), settingsJson))
  handle('endgameAsset:updateCommitment', (_, id, data) => endgameAssetService.updateEndgameCommitment(requireId(id), data))
  handle('foreshadow:listLedger', (_, novelId) => endgameAssetService.listForeshadowLedger(requireId(novelId, 'novelId')))
  handle('foreshadow:upsertLedger', (_, novelId, data) => endgameAssetService.upsertForeshadowLedger(requireId(novelId, 'novelId'), data))
  handle('foreshadow:deleteLedger', (_, novelId, id) => endgameAssetService.deleteForeshadowLedger(requireId(novelId, 'novelId'), requireId(id, 'id')))
  handle('volumeDesign:list', (_, novelId) => endgameAssetService.listVolumeDesigns(requireId(novelId, 'novelId')))
  handle('volumeDesign:getByVolume', (_, volumeId) => endgameAssetService.getVolumeDesignByVolumeId(requireId(volumeId, 'volumeId')))
  handle('volumeDesign:upsert', (_, volumeId, data) => endgameAssetService.upsertVolumeDesign(requireId(volumeId, 'volumeId'), data))
  handle('volumeDesign:auditVolume', (_, volumeId, options) =>
    endgameAssetService.auditVolumeDesign(
      requireId(volumeId, 'volumeId'),
      options == null ? {} : parseObjectPayload<Record<string, unknown>>(options, 'options'),
    ))
  handle('volumeDesign:syncConstraints', (_, volumeId) =>
    endgameAssetService.syncVolumeDesignConstraintsToContracts(requireId(volumeId, 'volumeId')))
  handle('contract:getChapter', (_, chapterId) => endgameAssetService.getChapterContract(requireId(chapterId, 'chapterId')))
  handle('contract:upsertChapter', (_, chapterId, data) => endgameAssetService.upsertChapterContract(requireId(chapterId, 'chapterId'), data))
  handle('contract:listScenes', (_, chapterId) => endgameAssetService.listSceneContracts(requireId(chapterId, 'chapterId')))
  handle('contract:upsertScene', (_, chapterId, segmentId, data) => endgameAssetService.upsertSceneContract(requireId(chapterId, 'chapterId'), segmentId == null ? null : requireId(segmentId, 'segmentId'), data))
  handle('storyFact:list', (_, novelId) => storyFactService.listStoryFacts(requireId(novelId, 'novelId')))
  handle('storyFact:get', (_, id) => storyFactService.getStoryFact(requireId(id)))
  handle('storyFact:create', (_, novelId, data) =>
    storyFactService.createStoryFact(
      requireId(novelId, 'novelId'),
      parseObjectPayload<Record<string, unknown>>(data, 'data'),
    ))
  handle('storyFact:update', (_, id, data) =>
    storyFactService.updateStoryFact(
      requireId(id),
      parseObjectPayload<Record<string, unknown>>(data, 'data'),
    ))
  handle('storyFact:delete', (_, id) => storyFactService.deleteStoryFact(requireId(id)))
  handle('growthSystem:getDashboard', (_, novelId) => growthSystemService.getGrowthSystemDashboard(requireId(novelId, 'novelId')))
  handle('growthSystem:listTracks', (_, novelId) => growthSystemService.listGrowthTracks(requireId(novelId, 'novelId')))
  handle('growthSystem:upsertTrack', (_, novelId, data) => growthSystemService.upsertGrowthTrack(requireId(novelId, 'novelId'), parseObjectPayload<Record<string, unknown>>(data, 'data')))
  handle('growthSystem:deleteTrack', (_, novelId, id) => growthSystemService.deleteGrowthTrack(requireId(novelId, 'novelId'), requireId(id, 'id')))
  handle('growthSystem:listPools', (_, novelId) => growthSystemService.listResourcePools(requireId(novelId, 'novelId')))
  handle('growthSystem:upsertPool', (_, novelId, data) => growthSystemService.upsertResourcePool(requireId(novelId, 'novelId'), parseObjectPayload<Record<string, unknown>>(data, 'data')))
  handle('growthSystem:deletePool', (_, novelId, id) => growthSystemService.deleteResourcePool(requireId(novelId, 'novelId'), requireId(id, 'id')))
  handle('growthSystem:listEvents', (_, novelId) => growthSystemService.listRewardCostEvents(requireId(novelId, 'novelId')))
  handle('growthSystem:upsertEvent', (_, novelId, data) => growthSystemService.upsertRewardCostEvent(requireId(novelId, 'novelId'), parseObjectPayload<Record<string, unknown>>(data, 'data')))
  handle('growthSystem:deleteEvent', (_, novelId, id) => growthSystemService.deleteRewardCostEvent(requireId(novelId, 'novelId'), requireId(id, 'id')))
  handle('growthSystem:bindChapterContract', (_, novelId, data) => growthSystemService.bindGrowthAssetsToChapterContract(requireId(novelId, 'novelId'), parseObjectPayload<Record<string, unknown>>(data, 'data') as { chapterId: number; trackIds: number[]; poolIds: number[]; eventIds: number[] }))
  handle('growthSystem:bindVolumeDesign', (_, novelId, data) => growthSystemService.bindGrowthAssetsToVolumeDesign(requireId(novelId, 'novelId'), parseObjectPayload<Record<string, unknown>>(data, 'data') as { volumeId: number; trackIds: number[]; poolIds: number[]; rewardCadence?: string }))

  handle('chapter:list', (_, novelId) => chapterService.listChapters(requireId(novelId, 'novelId')))
  handle('chapter:get', (_, id) => chapterService.getChapter(requireId(id)))
  handle('chapter:create', (_, novelId, data) => chapterService.createChapter(requireId(novelId, 'novelId'), data))
  handle('chapter:update', (_, id, data, options) => chapterService.updateChapter(requireId(id), data, options))
  handle('chapter:delete', (_, id) => chapterService.deleteChapter(requireId(id)))
  handle('chapter:listVersions', (_, chapterId) => chapterService.listChapterVersions(requireId(chapterId, 'chapterId')))
  handle('chapter:restoreVersion', (_, versionId) => chapterService.restoreChapterVersion(requireId(versionId, 'versionId')))
  handle('chapter:batchUpdate', (_, ids, data) => chapterService.batchUpdateChapters(requireIds(ids), data))
  handle('chapter:batchDelete', (_, ids) => chapterService.batchDeleteChapters(requireIds(ids)))
  handle('chapter:batchRenumber', (_, ids, startChapterNum) => chapterService.batchRenumberChapters(requireIds(ids), startChapterNum))
  handle('chapter:getContextPreview', (_, chapterId, options) =>
    chapterService.getChapterContextPreview(requireId(chapterId, 'chapterId'), options))
  handle('chapter:generateContent', (event, chapterId, options) =>
    chapterService.generateChapterContent(chapterId, event.sender, options))
  handle('chapter:resumeContent', (event, taskId) =>
    chapterService.resumeChapterPipeline(taskId, event.sender))
  handle('chapter:generateSummary', (_, chapterId) =>
    chapterService.generateChapterSummary(chapterId))
  handle('chapter:aiCheck', (_, chapterId) =>
    chapterService.aiCheckChapter(chapterId))
  handle('chapter:runPublishCheck', (_, chapterId) =>
    chapterService.runChapterPublishCheck(chapterId))
  handle('chapter:optimizeContent', (_, chapterId, options) =>
    chapterService.optimizeChapterContent(
      requireId(chapterId, 'chapterId'),
      parseObjectPayload<{ executionMode?: AiExecutionMode; extraRequirements?: string }>(options || {}, 'options'),
    ))
  handle('chapterBatch:startAutoGenerate', (event, novelId, options) =>
    batchWorkflowService.startChapterBatchGenerateWorkflow(requireId(novelId, 'novelId'), options, event.sender))
  handle('chapterBatch:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getChapterBatchAutoGenerateStatus(requireId(taskId, 'taskId')))
  handle('chapterBatch:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestChapterBatchAutoGenerateTask(requireId(novelId, 'novelId')))
  handle('chapterBatch:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), event.sender))
  handle('chapterBatch:startQualityAnalysis', (event, novelId, options) =>
    batchWorkflowService.startChapterQualityAnalysisWorkflow(
      requireId(novelId, 'novelId'),
      parseObjectPayload(options || {}, 'options'),
      event.sender,
    ))
  handle('chapterBatch:getQualityAnalysisStatus', (_, taskId) =>
    batchWorkflowService.getChapterQualityAnalysisStatus(requireId(taskId, 'taskId')))
  handle('chapterBatch:getLatestQualityAnalysisTask', (_, novelId) =>
    batchWorkflowService.getLatestChapterQualityAnalysisTask(requireId(novelId, 'novelId')))
  handle('chapterBatch:resumeQualityAnalysis', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), event.sender))
  handle('batchWorkbench:getData', (_, novelId, snapshotId) =>
    batchWorkbenchService.getBatchWorkbenchData(
      requireId(novelId, 'novelId'),
      snapshotId == null ? undefined : requireId(snapshotId, 'snapshotId'),
    ))
  handle('batchWorkbench:createInspection', (_, snapshotId, data) =>
    batchWorkbenchService.createBatchInspection(requireId(snapshotId, 'snapshotId'), parseObjectPayload<{
      chapterId?: number
      chapterNum?: number
      category: 'flow' | 'ai' | 'voice' | 'thread' | 'hook' | 'continuity'
      status: 'pass' | 'warning' | 'blocked'
      note: string
    }>(data, 'data')))
  handle('batchWorkbench:previewRollback', (_, snapshotId, mode) =>
    batchWorkbenchService.previewBatchRollback(
      requireId(snapshotId, 'snapshotId'),
      requireString(mode, 'mode') as 'chapter_rollback' | 'batch_content_rollback' | 'batch_full_rollback',
    ))
  handle('batchWorkbench:applyRollback', (_, snapshotId, mode) =>
    batchWorkbenchService.applyBatchRollback(
      requireId(snapshotId, 'snapshotId'),
      requireString(mode, 'mode') as 'chapter_rollback' | 'batch_content_rollback' | 'batch_full_rollback',
    ))
  handle('batchWorkbench:getGlobalLockLibrary', (_, novelId) =>
    batchWorkbenchService.getGlobalLockLibrary(requireId(novelId, 'novelId')))
  handle('batchWorkbench:updateGlobalLockLibrary', (_, novelId, patch) =>
    batchWorkbenchService.updateGlobalLockLibrary(
      requireId(novelId, 'novelId'),
      parseObjectPayload<Record<string, unknown>>(patch, 'patch'),
    ))
  handle('writeback:prepareRun', (_, chapterId, triggerSource) =>
    chapterWritebackService.prepareChapterWritebackRun(requireId(chapterId, 'chapterId'), typeof triggerSource === 'string' ? triggerSource : 'manual'))
  handle('writeback:getCenterData', (_, chapterId, runId) =>
    chapterWritebackService.getChapterWritebackCenterData(requireId(chapterId, 'chapterId'), runId == null ? undefined : requireId(runId, 'runId')))
  handle('writeback:listRuns', (_, chapterId) =>
    chapterWritebackService.listChapterWritebackRuns(requireId(chapterId, 'chapterId')))
  handle('writeback:updateDecision', (_, diffId, patch) =>
    chapterWritebackService.updateChapterWritebackDecision(
      requireId(diffId, 'diffId'),
      parseObjectPayload<Record<string, unknown>>(patch, 'patch') as {
        canonDecision?: 'pending' | 'accepted' | 'rejected' | 'edited'
        afterStateJson?: string
        diffReason?: string
      },
    ))
  handle('writeback:bulkUpdateDecisions', (_, runId, patch) =>
    chapterWritebackService.bulkUpdateChapterWritebackDecisions(
      requireId(runId, 'runId'),
      parseObjectPayload<Record<string, unknown>>(patch, 'patch') as {
        canonDecision: 'accepted' | 'rejected' | 'edited'
        assetType?: 'character' | 'world' | 'item' | 'relation' | 'thread' | 'foreshadow' | 'puzzle' | 'timeline'
      },
    ))
  handle('writeback:applyRun', (_, runId, options) =>
    chapterWritebackService.applyChapterWritebackRun(
      requireId(runId, 'runId'),
      options == null ? {} : parseObjectPayload<{ idempotencyKey?: string }>(options, 'options'),
    ))
  handle('writeback:retryFailed', (_, runId, options) =>
    chapterWritebackService.retryFailedWritebackItems(
      requireId(runId, 'runId'),
      options == null ? {} : parseObjectPayload<{ idempotencyKey?: string }>(options, 'options'),
    ))

  handle('aiPatch:suggest', (_, request) => aiPatchService.suggestAiPatch(parseObjectPayload(request, 'request')))
  handle('aiPatch:apply', (_, target, patch) => aiPatchService.applyAiPatch(parseObjectPayload(target, 'target'), patch))

  handle('character:list', (_, novelId) => characterService.listCharacters(novelId))
  handle('character:query', (_, filters) => characterService.queryCharacters(filters))
  handle('character:getStats', (_, filters) => characterService.getCharacterStats(filters))
  handle('character:getFilterOptions', (_, novelId) => characterService.getCharacterFilterOptions(novelId))
  handle('character:get', (_, id) => characterService.getCharacter(id))
  handle('character:search', (_, novelId, keyword, limit) => characterService.searchCharacters(novelId, keyword, limit))
  handle('character:getGraph', (_, filters) => characterService.getCharacterGraph(filters))
  handle('character:getDetailContext', (_, characterId) => characterService.getCharacterDetailContext(characterId))
  handle('character:create', (_, novelId, data) => characterService.createCharacter(requireId(novelId, 'novelId'), data))
  handle('character:update', (_, id, data) => characterService.updateCharacter(requireId(id), data))
  handle('character:delete', (_, id) => characterService.deleteCharacter(requireId(id)))
  handle('character:regenerate', (_, id) => characterService.regenerateCharacter(id))
  handle('character:suggestPatch', (_, id, instruction) =>
    characterService.suggestCharacterPatch(requireId(id), typeof instruction === 'string' ? instruction : ''))
  handle('character:applyPatch', (_, id, patch) =>
    characterService.applyCharacterPatch(requireId(id), patch))
  handle('character:startAutoGenerate', (event, novelId, opts) =>
    batchWorkflowService.startCharacterAutoGenerateWorkflow(novelId, opts, event.sender))
  handle('character:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getCharacterAutoGenerateStatus(taskId))
  handle('character:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestCharacterAutoGenerateTask(novelId))
  handle('character:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))
  handle('character:getRelations', (_, novelId) => characterService.getCharacterRelations(novelId))
  handle('character:generateProtagonist', (_, novelId, opts) =>
    characterService.generateProtagonist(novelId, opts))
  handle('character:batchGenerate', (event, novelId, opts) =>
    batchWorkflowService.generateCharactersViaWorkflow(novelId, opts, event.sender))
  handle('character:generateRelations', (_, novelId) =>
    characterService.generateCharacterRelations(novelId))
  handle('character:upsertRelation', (_, data) =>
    characterService.upsertRelation(parseObjectPayload<CharacterRelationInput>(data, 'data')))
  handle('character:clear', (_, novelId) => characterService.clearCharactersByNovel(requireId(novelId, 'novelId')))
  handle('characterArc:listCharacterArcs', (_, novelId) => characterArcService.listCharacterArcs(requireId(novelId, 'novelId')))
  handle('characterArc:getCharacterArc', (_, arcId) => characterArcService.getCharacterArc(requireId(arcId, 'arcId')))
  handle('characterArc:upsertCharacterArc', (_, data) =>
    characterArcService.upsertCharacterArc(parseObjectPayload<CharacterArcInput>(data, 'data')))
  handle('characterArc:upsertCharacterArcBeat', (_, data) =>
    characterArcService.upsertCharacterArcBeat(parseObjectPayload<CharacterArcBeatInput>(data, 'data')))
  handle('characterArc:listRelationshipArcs', (_, novelId) => characterArcService.listRelationshipArcs(requireId(novelId, 'novelId')))
  handle('characterArc:upsertRelationshipArc', (_, data) =>
    characterArcService.upsertRelationshipArc(parseObjectPayload<RelationshipArcInput>(data, 'data')))
  handle('characterArc:getArcDashboard', (_, novelId) => characterArcService.getArcDashboard(requireId(novelId, 'novelId')))
  handle('resistance:listTracks', (_, novelId) => resistanceService.listTracks(requireId(novelId, 'novelId')))
  handle('resistance:getTrack', (_, trackId) => resistanceService.getTrack(requireId(trackId, 'trackId')))
  handle('resistance:upsertTrack', (_, data) =>
    resistanceService.upsertTrack(parseObjectPayload<ResistanceTrackInput>(data, 'data')))
  handle('resistance:upsertBeat', (_, data) =>
    resistanceService.upsertBeat(parseObjectPayload<ResistanceBeatInput>(data, 'data')))
  handle('resistance:getDashboard', (_, novelId) => resistanceService.getDashboard(requireId(novelId, 'novelId')))

  handle('map:getTree', (_, novelId) => mapService.getMapTree(novelId))
  handle('map:queryNodes', (_, filters) => mapService.queryMapNodes(filters))
  handle('map:getGraph', (_, filters) => mapService.getMapGraph(filters))
  handle('map:getRelations', (_, novelId, focusNodeId) => mapService.getMapRelations(novelId, focusNodeId))
  handle('map:getStats', (_, novelId) => mapService.getMapStats(novelId))
  handle('map:getNode', (_, id) => mapService.getMapNode(id))
  handle('map:searchNodes', (_, novelId, keyword, limit) => mapService.searchMapNodes(novelId, keyword, limit))
  handle('map:create', (_, novelId, data) => mapService.createMapItem(requireId(novelId, 'novelId'), data))
  handle('map:update', (_, id, data) => mapService.updateMapItem(requireId(id), data))
  handle('map:upsertRelation', (_, data) =>
    mapService.upsertMapRelation(parseObjectPayload<MapRelationInput>(data, 'data')))
  handle('map:deleteRelation', (_, id) => mapService.deleteMapRelation(requireId(id)))
  handle('map:delete', (_, id) => mapService.deleteMapItem(requireId(id)))
  handle('map:batchGenerate', (_, novelId, structure) =>
    mapService.batchGenerateMap(novelId, structure))
  handle('map:batchGenerateToTarget', (_, novelId, structure) =>
    mapService.batchGenerateMapToTarget(novelId, structure))
  handle('map:startAutoGenerate', (event, novelId, structure) =>
    workflowTaskService.startMapAutoGenerateWorkflow(novelId, structure, event.sender))
  handle('map:getAutoGenerateStatus', (_, taskId) =>
    workflowTaskService.getMapAutoGenerateStatus(taskId))
  handle('map:getLatestAutoGenerateTask', (_, novelId) =>
    workflowTaskService.getLatestMapAutoGenerateTask(novelId))
  handle('map:resumeAutoGenerate', (event, taskId) =>
    workflowTaskService.resumeWorkflowTask(taskId, event.sender))
  handle('map:clear', (_, novelId) => mapService.clearMapByNovel(requireId(novelId, 'novelId')))

  handle('worldRules:startAutoGenerate', (event, novelId, options) =>
    workflowTaskService.startWorldRulesAutoGenerateWorkflow(novelId, options, event.sender))
  handle('worldRules:getAutoGenerateStatus', (_, taskId) =>
    workflowTaskService.getWorldRulesAutoGenerateStatus(taskId))
  handle('worldRules:getLatestAutoGenerateTask', (_, novelId) =>
    workflowTaskService.getLatestWorldRulesAutoGenerateTask(novelId))
  handle('worldRules:resumeAutoGenerate', (event, taskId, currentRules) =>
    workflowTaskService.resumeWorldRulesAutoGenerateWorkflow(taskId, currentRules, event.sender))
  handle('worldRules:clearAutoGenerateDraft', (_, novelId) =>
    workflowTaskService.clearWorldRulesAutoGenerateDraft(novelId))

  handle('timeline:list', (_, novelId) => timelineService.listTimelineEvents(novelId))
  handle('timeline:query', (_, filters) => timelineService.queryTimelineEvents(filters))
  handle('timeline:search', (_, novelId, keyword, limit) => timelineService.searchTimelineEvents(novelId, keyword, limit))
  handle('timeline:getStats', (_, filters) => timelineService.getTimelineStats(filters))
  handle('timeline:getFilterOptions', (_, novelId) => timelineService.getTimelineFilterOptions(novelId))
  handle('timeline:get', (_, id) => timelineService.getTimelineEvent(id))
  handle('timeline:create', (_, novelId, data) => timelineService.createTimelineEvent(requireId(novelId, 'novelId'), data))
  handle('timeline:update', (_, id, data) => timelineService.updateTimelineEvent(requireId(id), data))
  handle('timeline:delete', (_, id) => timelineService.deleteTimelineEvent(requireId(id)))
  handle('timeline:batchUpdate', (_, ids, data) => timelineService.batchUpdateTimelineEvents(requireIds(ids), data))
  handle('timeline:batchDelete', (_, ids) => timelineService.batchDeleteTimelineEvents(requireIds(ids)))
  handle('timeline:generate', (event, novelId, options) =>
    batchWorkflowService.generateTimelineViaWorkflow(novelId, options, event.sender))
  handle('timeline:startAutoGenerate', (event, novelId, options) =>
    batchWorkflowService.startTimelineAutoGenerateWorkflow(novelId, options, event.sender))
  handle('timeline:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getTimelineAutoGenerateStatus(taskId))
  handle('timeline:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestTimelineAutoGenerateTask(novelId))
  handle('timeline:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))
  handle('timeline:regenerate', (_, id, options) => timelineService.regenerateTimelineEvent(id, options))
  handle('timeline:clear', (_, novelId) => timelineService.clearTimelineByNovel(requireId(novelId, 'novelId')))

  handle('item:list', (_, novelId) => itemService.listStoryItems(novelId))
  handle('item:query', (_, filters) => itemService.queryStoryItems(filters))
  handle('item:getStats', (_, filters) => itemService.getStoryItemStats(filters))
  handle('item:getFilterOptions', (_, novelId) => itemService.getStoryItemFilterOptions(novelId))
  handle('item:get', (_, id) => itemService.getStoryItem(id))
  handle('item:getDetailContext', (_, id) => itemService.getStoryItemDetailContext(id))
  handle('item:search', (_, novelId, keyword, itemKind, limit) => itemService.searchStoryItems(novelId, keyword, itemKind, limit))
  handle('item:create', (_, novelId, data) => itemService.createStoryItem(requireId(novelId, 'novelId'), data))
  handle('item:update', (_, id, data) => itemService.updateStoryItem(requireId(id), data))
  handle('item:delete', (_, id) => itemService.deleteStoryItem(requireId(id)))
  handle('item:generate', (event, novelId, options) => batchWorkflowService.generateItemsViaWorkflow(novelId, options, event.sender))
  handle('item:startAutoGenerate', (event, novelId, options) =>
    batchWorkflowService.startItemAutoGenerateWorkflow(novelId, options, event.sender))
  handle('item:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getItemAutoGenerateStatus(taskId))
  handle('item:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestItemAutoGenerateTask(novelId))
  handle('item:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))
  handle('item:regenerate', (_, id, options) => itemService.regenerateStoryItem(id, options))
  handle('item:getLinkRecommendations', (_, itemId) => itemService.getStoryItemLinkRecommendations(requireId(itemId, 'itemId')))
  handle('item:applyLinkRecommendations', (_, itemId, data) => itemService.applyStoryItemLinkRecommendations(
    requireId(itemId, 'itemId'),
    parseObjectPayload<Record<string, unknown>>(data, 'data') as {
      eventIds?: number[]
      segmentIds?: number[]
    },
  ))
  handle('item:repairCharacterLinks', (_, novelId) => itemService.repairItemCharacterLinks(requireId(novelId, 'novelId')))
  handle('item:clear', (_, novelId) => itemService.clearStoryItemsByNovel(requireId(novelId, 'novelId')))

  handle('outline:getArcs', (_, novelId) => {
    requireId(novelId, 'novelId')
    const db = getDb()
    return db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  })

  handle('outline:getArcProgressSnapshot', (_, novelId) =>
    storyArcProgressService.getStoryArcProgressSnapshot(requireId(novelId, 'novelId')))

  handle('outline:createArc', (_, novelId, data) => {
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

  handle('outline:updateArc', (_, id, data) => {
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

  handle('outline:deleteArc', (_, id) => {
    requireId(id)
    const db = getDb()
    const current = db.select().from(storyArcs).where(eq(storyArcs.id, id)).all()[0]
    db.delete(storyArcs).where(eq(storyArcs.id, id)).run()
    if (current) {
      markNovelContextChanged(current.novelId, 'Story outline changed')
    }
  })

  handle('outline:clear', (_, novelId) => {
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

  handle('outline:generateArcs', (_, novelId) => outlineGenerationService.generateStoryArcs(novelId))
  handle('outline:generateChapterOutlines', (_, arcId, options?: { batchSize?: number }) =>
    outlineGenerationService.generateChapterOutlines(arcId, options))

  // Rhythm Templates（内置节奏模板，纯 TS 常量）
  handle('rhythm:listTemplates', (_, novelId: number) =>
    rhythmTemplateService.listRhythmTemplatesForNovel(requireId(novelId, 'novelId')))
  handle('rhythm:attachToArc', (_, arcId: number, templateKey: string | null) =>
    rhythmTemplateService.attachRhythmTemplateToArc(
      requireId(arcId, 'arcId'),
      typeof templateKey === 'string' && templateKey ? templateKey : null,
    ))

  handle('thread:list', (_, novelId) => storyThreadService.listStoryThreads(novelId))
  handle('thread:query', (_, filters) => storyThreadService.queryStoryThreads(filters))
  handle('thread:getStats', (_, filters) => storyThreadService.getStoryThreadStats(filters))
  handle('thread:get', (_, id) => storyThreadService.getStoryThread(id))
  handle('thread:getForeshadowSnapshot', (_, novelId, chapterNum) =>
    storyThreadService.getForeshadowSnapshot(requireId(novelId, 'novelId'), typeof chapterNum === 'number' ? chapterNum : undefined))
  handle('thread:generate', (event, novelId, options) => batchWorkflowService.generateStoryThreadsViaWorkflow(novelId, options, event.sender))
  handle('thread:startAutoGenerate', (event, novelId, options) =>
    batchWorkflowService.startStoryThreadAutoGenerateWorkflow(novelId, options, event.sender))
  handle('thread:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getStoryThreadAutoGenerateStatus(taskId))
  handle('thread:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestStoryThreadAutoGenerateTask(novelId))
  handle('thread:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))
  handle('thread:create', (_, novelId, data) => storyThreadService.createStoryThread(requireId(novelId, 'novelId'), data))
  handle('thread:update', (_, id, data) => storyThreadService.updateStoryThread(requireId(id), data))
  handle('thread:delete', (_, id) => storyThreadService.deleteStoryThread(requireId(id)))
  handle('thread:batchUpdate', (_, ids, data) => storyThreadService.batchUpdateStoryThreads(requireIds(ids), data))
  handle('thread:batchDelete', (_, ids) => storyThreadService.batchDeleteStoryThreads(requireIds(ids)))
  handle('thread:clear', (_, novelId) => storyThreadService.clearStoryThreads(requireId(novelId, 'novelId')))
  handle('thread:regenerate', (_, id, options) => storyThreadService.regenerateStoryThread(id, options))
  handle('faction:list', (_, novelId) => factionService.listFactions(requireId(novelId, 'novelId')))
  handle('faction:query', (_, filters) => factionService.queryFactions(filters))
  handle('faction:getStats', (_, filters) => factionService.getFactionStats(filters))
  handle('faction:get', (_, id) => factionService.getFaction(requireId(id)))
  handle('faction:search', (_, novelId, keyword, limit) => factionService.searchFactions(requireId(novelId, 'novelId'), keyword, limit))
  handle('faction:getGraph', (_, filters) => factionService.getFactionGraph(filters))
  handle('faction:create', (_, novelId, data) => factionService.createFaction(requireId(novelId, 'novelId'), data))
  handle('faction:update', (_, id, data) => factionService.updateFaction(requireId(id), data))
  handle('faction:delete', (_, id) => factionService.deleteFaction(requireId(id)))
  handle('faction:clear', (_, novelId) => factionService.clearFactions(requireId(novelId, 'novelId')))
  handle('faction:batchGenerate', (event, novelId, options) =>
    batchWorkflowService.generateFactionsViaWorkflow(requireId(novelId, 'novelId'), options, event.sender))
  handle('faction:startAutoGenerate', (event, novelId, options) =>
    batchWorkflowService.startFactionAutoGenerateWorkflow(requireId(novelId, 'novelId'), options, event.sender))
  handle('faction:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getFactionAutoGenerateStatus(requireId(taskId)))
  handle('faction:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestFactionAutoGenerateTask(requireId(novelId, 'novelId')))
  handle('faction:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId), event.sender))
  handle('faction:resolveNameOptions', (_, novelId) => factionService.resolveFactionNameOptions(requireId(novelId, 'novelId')))
  handle('glossary:list', (_, novelId) => glossaryService.listGlossary(requireId(novelId, 'novelId')))
  handle('glossary:query', (_, filters) => glossaryService.queryGlossary(filters))
  handle('glossary:getStats', (_, filters) => glossaryService.getGlossaryStats(filters))
  handle('glossary:get', (_, id) => glossaryService.getGlossaryEntry(requireId(id)))
  handle('glossary:search', (_, novelId, keyword, limit) => glossaryService.searchGlossary(requireId(novelId, 'novelId'), keyword, limit))
  handle('glossary:create', (_, novelId, data) => glossaryService.createGlossaryEntry(requireId(novelId, 'novelId'), data))
  handle('glossary:update', (_, id, data) => glossaryService.updateGlossaryEntry(requireId(id), data))
  handle('glossary:delete', (_, id) => glossaryService.deleteGlossaryEntry(requireId(id)))
  handle('sceneTemplate:list', (_, filters) => sceneTemplateService.listSceneTemplates(filters || {}))
  handle('sceneTemplate:query', (_, filters) => sceneTemplateService.querySceneTemplates(filters || {}))
  handle('sceneTemplate:getStats', (_, filters) => sceneTemplateService.getSceneTemplateStats(filters || {}))
  handle('sceneTemplate:get', (_, id) => sceneTemplateService.getSceneTemplate(requireId(id)))
  handle('sceneTemplate:search', (_, novelId, genreId, keyword, limit) => sceneTemplateService.searchSceneTemplates(requireId(novelId, 'novelId'), typeof genreId === 'number' ? genreId : undefined, keyword, limit))
  handle('sceneTemplate:create', (_, data) => sceneTemplateService.createSceneTemplate(data))
  handle('sceneTemplate:update', (_, id, data) => sceneTemplateService.updateSceneTemplate(requireId(id), data))
  handle('sceneTemplate:delete', (_, id) => sceneTemplateService.deleteSceneTemplate(requireId(id)))
  handle('subplot:generate', (event, request) => batchWorkflowService.generateSubplotsViaWorkflow(request, event.sender))
  handle('subplot:startAutoGenerate', (event, request) =>
    batchWorkflowService.startSubplotAutoGenerateWorkflow(request, event.sender))
  handle('subplot:getAutoGenerateStatus', (_, taskId) =>
    batchWorkflowService.getSubplotAutoGenerateStatus(taskId))
  handle('subplot:getLatestAutoGenerateTask', (_, novelId) =>
    batchWorkflowService.getLatestSubplotAutoGenerateTask(novelId))
  handle('subplot:resumeAutoGenerate', (event, taskId) =>
    batchWorkflowService.resumeBatchAutoGenerateWorkflow(taskId, event.sender))

  handle('history:listRecent', (_, novelId, limit) => historyService.listRecentOperationLogs(novelId, limit))
  handle('history:getLatestUndoable', (_, novelId) => historyService.getLatestUndoableOperation(novelId))
  handle('history:undo', (_, logId) => historyService.undoOperation(logId))

  handle('revision:list', (_, novelId) => revisionTaskService.listRevisionTasks(novelId))
  handle('revision:query', (_, filters) => revisionTaskService.queryRevisionTasks(filters))
  handle('revision:getStats', (_, filters) => revisionTaskService.getRevisionTaskStats(filters))
  handle('revision:getSnapshot', (_, novelId) => revisionTaskService.getRevisionCenterSnapshot(novelId))
  handle('revision:get', (_, id) => revisionTaskService.getRevisionTask(id))
  handle('revision:create', (_, novelId, data) => revisionTaskService.createRevisionTask(requireId(novelId, 'novelId'), data))
  handle('revision:update', (_, id, data) => revisionTaskService.updateRevisionTask(requireId(id), data))
  handle('revision:delete', (_, id) => revisionTaskService.deleteRevisionTask(requireId(id)))
  handle('revision:autoFix', (_, id) => revisionTaskService.autoFixRevisionTask(id))

  handle('model:list', () => {
    const db = getDb()
    return db.select().from(modelConfigs).all().map((config) => {
      const provider = modelService.normalizeModelProvider(config.provider)
      return {
        ...config,
        provider,
        temperature: modelService.normalizeModelTemperature(config.temperature, provider),
        maxTokens: modelService.normalizeModelMaxTokens(config.maxTokens, provider),
        maxConcurrency: modelService.normalizeModelConcurrency(config.maxConcurrency),
        maxContextTokens: modelService.normalizeModelContextTokensForModel(config.maxContextTokens, provider, config.modelId),
        extraParamsJson: modelService.normalizeModelExtraParamsJson(config.extraParamsJson, provider),
        apiKey: config.apiKey ? '已设置' : '',
      }
    }).filter((config) => modelService.isSupportedModelProvider(config.provider))
  })

  handle('model:create', (_, data) => {
    requireObject(data, 'data')
    const db = getDb()
    const provider = modelService.normalizeModelProvider(data.provider)
    if (!modelService.isSupportedModelProvider(provider)) {
      throwUserFacingError('model.unknownProvider', { provider })
    }
    if (modelService.providerRequiresApiKey(provider) && (!data.apiKey || data.apiKey === '已设置')) {
      throwUserFacingError('model.apiKeyRequired')
    }
    if (modelService.isNativeAgentProvider(provider)) data.apiKey = null
    delete data.kimiThinking
    const encryptedKey = data.apiKey ? encryptApiKey(data.apiKey) : null
    const result = db.insert(modelConfigs).values({
      ...data,
      provider,
      baseUrl: modelService.normalizeModelBaseUrl(data.baseUrl, provider),
      temperature: modelService.normalizeModelTemperature(data.temperature, provider),
      maxTokens: modelService.normalizeModelMaxTokens(data.maxTokens, provider),
      maxContextTokens: modelService.normalizeModelContextTokensForModel(data.maxContextTokens, provider, data.modelId),
      maxConcurrency: modelService.normalizeModelConcurrency(data.maxConcurrency),
      extraParamsJson: modelService.normalizeModelExtraParamsJson(data.extraParamsJson, provider),
      apiKey: encryptedKey,
    }).run()
    return Number(result.lastInsertRowid)
  })

  handle('model:update', (_, id, data) => {
    requireId(id)
    requireObject(data, 'data')
    const db = getDb()
    const existing = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).all()[0]
    const provider = modelService.normalizeModelProvider(
      typeof data.provider === 'string' ? data.provider : (existing?.provider || 'openai'),
    )
    if (!modelService.isSupportedModelProvider(provider)) {
      throwUserFacingError('model.unknownProvider', { provider })
    }
    const existingProvider = modelService.normalizeModelProvider(existing?.provider || 'openai')
    const providerChanged = Boolean(existing) && provider !== existingProvider
    if (providerChanged && data.apiKey === '已设置' && modelService.providerRequiresApiKey(provider)) {
      throwUserFacingError('model.providerChangeNeedsApiKey')
    }
    if (providerChanged && modelService.providerRequiresApiKey(provider) && !data.apiKey) {
      throwUserFacingError('model.apiKeyRequired')
    }
    if (modelService.isNativeAgentProvider(provider)) data.apiKey = null
    if ('provider' in data || existing?.provider) {
      data.provider = provider
    }
    if (providerChanged && !('baseUrl' in data)) {
      data.baseUrl = modelService.normalizeModelBaseUrl(null, provider)
    } else if ('baseUrl' in data) {
      data.baseUrl = modelService.normalizeModelBaseUrl(data.baseUrl, provider)
    }
    if (data.apiKey && data.apiKey !== '已设置') {
      data.apiKey = encryptApiKey(data.apiKey)
    } else if (data.apiKey === '已设置') {
      delete data.apiKey
    } else if (data.apiKey === '') {
      data.apiKey = null
    }
    if ('temperature' in data) {
      data.temperature = modelService.normalizeModelTemperature(data.temperature, provider)
    }
    if ('maxTokens' in data) {
      data.maxTokens = modelService.normalizeModelMaxTokens(data.maxTokens, provider)
    }
    if ('maxContextTokens' in data || providerChanged || 'modelId' in data) {
      data.maxContextTokens = modelService.normalizeModelContextTokensForModel(
        'maxContextTokens' in data ? data.maxContextTokens : existing?.maxContextTokens,
        provider,
        typeof data.modelId === 'string' ? data.modelId : existing?.modelId,
      )
    }
    if ('maxConcurrency' in data) {
      data.maxConcurrency = modelService.normalizeModelConcurrency(data.maxConcurrency)
    }
    if (providerChanged || 'extraParamsJson' in data) {
      data.extraParamsJson = modelService.normalizeModelExtraParamsJson(
        'extraParamsJson' in data ? data.extraParamsJson : existing?.extraParamsJson,
        provider,
      )
    }
    delete data.kimiThinking
    db.update(modelConfigs).set(data).where(eq(modelConfigs.id, id)).run()
  })

  handle('model:delete', (_, id) => {
    requireId(id)
    const db = getDb()
    db.delete(modelConfigs).where(eq(modelConfigs.id, id)).run()
  })

  handle('model:setDefault', (_, id) => {
    requireId(id)
    const db = getDb()
    const config = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).all()[0]
    if (!config || !modelService.isSupportedModelProvider(config.provider)) {
      throwUserFacingError('model.unknownProvider', { provider: config?.provider || 'unknown' })
    }
    db.update(modelConfigs).set({ isDefault: 0 }).run()
    db.update(modelConfigs).set({ isDefault: 1 }).where(eq(modelConfigs.id, id)).run()
  })

  handle('model:test', (_, id) => modelService.testAdapter(id))

  handle('sourceSearch:getSettings', () => sourceSearchSettingsService.getSourceSearchSettings())
  handle('sourceSearch:updateSettings', (_, data) => {
    requireObject(data, 'data')
    return sourceSearchSettingsService.updateSourceSearchSettings(data)
  })
  handle('sourceSearch:test', () => sourceSearchSettingsService.testSourceSearchSettings())

  handle('template:list', (_, type) => {
    const db = getDb()
    if (type) {
      return db.select().from(templates).where(eq(templates.type, type)).all()
    }
    return db.select().from(templates).all()
  })

  handle('template:create', (_, data) => {
    requireObject(data, 'data')
    const db = getDb()
    const result = db.insert(templates).values(data).run()
    return Number(result.lastInsertRowid)
  })

  handle('template:update', (_, id, data) => {
    requireId(id)
    requireObject(data, 'data')
    const db = getDb()
    db.update(templates).set(data).where(eq(templates.id, id)).run()
  })

  handle('template:delete', (_, id) => {
    requireId(id)
    const db = getDb()
    const template = db.select().from(templates).where(eq(templates.id, id)).all()[0]
    if (template?.isBuiltin) throwUserFacingError('template.builtinDeleteBlocked')
    db.delete(templates).where(eq(templates.id, id)).run()
  })

  handle('prompt:list', () => promptOverrideService.listPromptOverrides())
  handle('prompt:save', (_, key, content) => {
    requireString(key, 'key')
    return promptOverrideService.savePromptOverride(key, content)
  })
  handle('prompt:delete', (_, key) => {
    requireString(key, 'key')
    return promptOverrideService.deletePromptOverride(key)
  })

  handle('task:list', (_, novelId) => taskService.listTasks(novelId))
  handle('task:query', (_, filters) => taskService.queryTasks(filters || {}))
  handle('task:getStats', (_, novelId) => taskService.getTaskStats(novelId))
  handle('task:getPipelineStats', (_, novelId) => taskService.getTaskPipelineStats(novelId))
  handle('task:getLatestChapterPipeline', (_, chapterId) => taskService.getLatestChapterPipelineTask(chapterId))
  handle('task:clearHistory', (_, filters) => taskService.clearTaskHistory(filters || {}))

  handle('task:get', (_, id) => {
    const db = getDb()
    return db.select().from(tasks).where(eq(tasks.id, id)).all()[0] || null
  })

  handle('task:cancel', (event, id) => taskService.cancelTask(id, event.sender))
  handle('task:retry', async (event, id) => {
    const db = getDb()
    const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0]
    if (!task) throwUserFacingError('task.notFound', { id })

    if (task.type === 'chapter_write' && task.relatedEntityType === 'chapter' && task.relatedEntityId) {
      return chapterService.resumeChapterPipeline(id, event.sender)
    }

    if (task.type === 'subplot_framework') {
      return subplotService.retrySubplotBatch(id)
    }

    return taskService.retryTask(id, event.sender)
  })

  handle('workflow:list', (_, novelId) => workflowTaskService.listWorkflowTasks(novelId))
  handle('workflow:get', (_, id) => workflowTaskService.getWorkflowTask(id))
  handle('workflow:cancel', (event, id) => taskService.cancelTask(id, event.sender))
  handle('workflow:resume', (event, id) => workflowTaskService.resumeWorkflowTask(id, event.sender))

  handle('premiseDraft:getLatest', (_, novelId: number) => premiseService.getLatestPremiseDraft(novelId))
  handle('premiseDraft:markApplied', (_, taskId: number, appliedMode: 'replace' | 'fill_blanks') =>
    premiseService.markPremiseDraftApplied(taskId, appliedMode))
  handle('premiseDraft:clearAll', (_, novelId: number) => premiseService.clearPremiseDrafts(novelId))
  handle('planningDraft:getLatest', (_, novelId: number, pageKey: PlanningDraftPageKey) =>
    planningDraftService.getLatestPlanningDraft(novelId, pageKey))
  handle('planningDraft:save', (_, data: {
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
  handle('planningDraft:markApplied', (_, taskId: number) =>
    planningDraftService.markPlanningDraftApplied(taskId))
  handle('planningDraft:finalize', (_, taskId: number, finalData: Record<string, unknown>) =>
    planningDraftService.finalizePlanningDraft(taskId, finalData))
  handle('planningDraft:clear', (_, novelId: number, pageKey: PlanningDraftPageKey) =>
    planningDraftService.clearPlanningDrafts(novelId, pageKey))

  handle('ai:expandBackground', async (_, input: {
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

  handle('ai:generateCoreSettings', (event, data: CoreSettingsGenerationRequest) =>
    coreSettingsService.generateCoreSettings(data, event.sender))
  handle('ai:generatePremise', (event, data: PremiseGenerationRequest) =>
    premiseService.generatePremise(data, event.sender))
  handle('ai:generateProjectBrief', (_, data: ProjectBriefGenerationRequest) =>
    projectBriefService.generateProjectBrief(data))
  handle('ai:generateThemeVoice', (_, data: ThemeVoiceGenerationRequest) =>
    themeVoiceService.generateThemeVoice(data))
  handle('ai:generateWorldRules', (event, data: WorldRulesGenerationRequest) =>
    worldRulesService.generateWorldRules(data, event.sender))

  handle('ai:generateCharacter', (_, novelId, opts) =>
    characterService.generateProtagonist(novelId, opts))
  handle('ai:generateRelations', (_, novelId) =>
    characterService.generateCharacterRelations(novelId))

  handle('ai:rewriteParagraph', async (_, data: {
    originalParagraph: string
    contextBefore: string
    specificRequirements: string
    modelConfigId?: number
    novelId?: number
    executionMode?: AiExecutionMode
  }) => {
    const novel = typeof data.novelId === 'number'
      ? getDb().select().from(novelsTable).where(eq(novelsTable.id, data.novelId)).all()[0]
      : null
    const executionMode = resolveAiExecutionMode({
      explicitMode: data.executionMode,
      settingsJson: novel?.settingsJson,
    })
    const route = buildAiModelRouteReport({
      taskKind: 'paragraph_rewrite',
      stageLabel: 'Paragraph Rewrite',
      executionMode: executionMode.mode,
      resolutionSource: executionMode.source,
      modelConfigId: data.modelConfigId ?? novel?.modelConfigId,
    })
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
      modelConfigId: route.modelConfigId,
      chatOpts: buildChatOptionsFromRoute(route),
    })

    return result
  })

  handle('ai:generateSubplotBatch', async (_, data: SubplotGenerationRequest) => {
    return subplotService.generateSubplotBatch(data)
  })

  handle('ai:runPrompt', async (_, data: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    count?: number
    modelConfigId?: number
    novelId?: number
    executionMode?: AiExecutionMode
  }) => {
    const count = Math.min(Math.max(data.count || 1, 1), 3)
    const novel = typeof data.novelId === 'number'
      ? getDb().select().from(novelsTable).where(eq(novelsTable.id, data.novelId)).all()[0]
      : null
    const executionMode = resolveAiExecutionMode({
      explicitMode: data.executionMode,
      settingsJson: novel?.settingsJson,
    })
    const route = buildAiModelRouteReport({
      taskKind: 'generic_prompt',
      stageLabel: 'Generic Prompt',
      executionMode: executionMode.mode,
      resolutionSource: executionMode.source,
      modelConfigId: data.modelConfigId ?? novel?.modelConfigId,
    })
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
        modelConfigId: route.modelConfigId,
        chatOpts: buildChatOptionsFromRoute(route),
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

  handle('ai:scoreContent', async (_, data: {
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

    return enhanceAiScoreResult(safeParseJson(result), data.content)
  })
  handle('ai:analyzeWorkspaceQuality', (_, data) => workspaceQualityService.analyzeWorkspaceQuality(requireObject(data)))
  handle('ai:repairWorkspaceQuality', (_, data) => workspaceQualityService.repairWorkspaceQuality(requireObject(data)))
}









