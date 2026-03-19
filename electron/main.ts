import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { desc, eq } from 'drizzle-orm'
import type { CoreSettingsGenerationRequest } from '../src/shared/core-settings-generation'
import type { WorldRulesGenerationRequest } from '../src/shared/world-rules-generation'
import type { SubplotGenerationRequest } from '../src/shared/subplot-framework'
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
import { buildOutlineGenerationContext, buildStoryProfile } from './services/context.service'
import * as worldRulesService from './services/world-rules.service'
import * as exportService from './services/export.service'
import * as itemService from './services/item.service'
import * as mapService from './services/map.service'
import * as modelService from './services/model.service'
import { encryptApiKey } from './services/model.service'
import * as novelService from './services/novel.service'
import * as subplotService from './services/subplot.service'
import * as timelineService from './services/timeline.service'
import * as storyMemoryService from './services/story-memory.service'
import {
  contentScoringPrompt,
  expandBackgroundPrompt,
  rewriteParagraphPrompt,
} from './services/prompts'
import {
  buildChapterOutlinePlanningPrompt,
  buildStoryArcPlanningPrompt,
} from './services/story-prompts'
import * as taskService from './services/task.service'
import { safeParseJson } from './utils/json'

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
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
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

function formatGeneratedOutline(outline: Record<string, unknown>): string {
  const characters = toStringArray(outline.characters)

  return [
    typeof outline.goal === 'string' && outline.goal.trim() ? `目标：${outline.goal.trim()}` : '',
    characters.length > 0 ? `人物：${characters.join('、')}` : '',
    typeof outline.location === 'string' && outline.location.trim() ? `场景：${outline.location.trim()}` : '',
    ...toStringArray(outline.plot_points).map((item) => `- ${item}`),
    typeof outline.bridge_in === 'string' && outline.bridge_in.trim() ? `承接：${outline.bridge_in.trim()}` : '',
    typeof outline.bridge_out === 'string' && outline.bridge_out.trim() ? `转出：${outline.bridge_out.trim()}` : '',
  ].filter(Boolean).join('\n')
}

app.whenReady().then(() => {
  initDb()
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

  ipcMain.handle('chapter:list', (_, novelId) => chapterService.listChapters(novelId))
  ipcMain.handle('chapter:get', (_, id) => chapterService.getChapter(id))
  ipcMain.handle('chapter:create', (_, novelId, data) => chapterService.createChapter(novelId, data))
  ipcMain.handle('chapter:update', (_, id, data) => chapterService.updateChapter(id, data))
  ipcMain.handle('chapter:delete', (_, id) => chapterService.deleteChapter(id))
  ipcMain.handle('chapter:generateContent', (event, chapterId) =>
    chapterService.generateChapterContent(chapterId, event.sender))
  ipcMain.handle('chapter:generateSummary', (_, chapterId) =>
    chapterService.generateChapterSummary(chapterId))
  ipcMain.handle('chapter:aiCheck', (_, chapterId) =>
    chapterService.aiCheckChapter(chapterId))

  ipcMain.handle('character:list', (_, novelId) => characterService.listCharacters(novelId))
  ipcMain.handle('character:get', (_, id) => characterService.getCharacter(id))
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
  ipcMain.handle('map:create', (_, novelId, data) => mapService.createMapItem(novelId, data))
  ipcMain.handle('map:update', (_, id, data) => mapService.updateMapItem(id, data))
  ipcMain.handle('map:delete', (_, id) => mapService.deleteMapItem(id))
  ipcMain.handle('map:batchGenerate', (_, novelId, structure) =>
    mapService.batchGenerateMap(novelId, structure))
  ipcMain.handle('map:clear', (_, novelId) => mapService.clearMapByNovel(novelId))

  ipcMain.handle('timeline:list', (_, novelId) => timelineService.listTimelineEvents(novelId))
  ipcMain.handle('timeline:get', (_, id) => timelineService.getTimelineEvent(id))
  ipcMain.handle('timeline:create', (_, novelId, data) => timelineService.createTimelineEvent(novelId, data))
  ipcMain.handle('timeline:update', (_, id, data) => timelineService.updateTimelineEvent(id, data))
  ipcMain.handle('timeline:delete', (_, id) => timelineService.deleteTimelineEvent(id))
  ipcMain.handle('timeline:generate', (_, novelId, options) =>
    timelineService.generateTimelineEvents(novelId, options))
  ipcMain.handle('timeline:clear', (_, novelId) => timelineService.clearTimelineByNovel(novelId))

  ipcMain.handle('item:list', (_, novelId) => itemService.listStoryItems(novelId))
  ipcMain.handle('item:get', (_, id) => itemService.getStoryItem(id))
  ipcMain.handle('item:create', (_, novelId, data) => itemService.createStoryItem(novelId, data))
  ipcMain.handle('item:update', (_, id, data) => itemService.updateStoryItem(id, data))
  ipcMain.handle('item:delete', (_, id) => itemService.deleteStoryItem(id))
  ipcMain.handle('item:generate', (_, novelId, options) => itemService.generateStoryItems(novelId, options))
  ipcMain.handle('item:clear', (_, novelId) => itemService.clearStoryItemsByNovel(novelId))

  ipcMain.handle('outline:getArcs', (_, novelId) => {
    const db = getDb()
    return db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  })

  ipcMain.handle('outline:createArc', (_, novelId, data) => {
    const db = getDb()
    const result = db.insert(storyArcs).values({ novelId, ...data }).run()
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('outline:updateArc', (_, id, data) => {
    const db = getDb()
    db.update(storyArcs).set(data).where(eq(storyArcs.id, id)).run()
  })

  ipcMain.handle('outline:deleteArc', (_, id) => {
    const db = getDb()
    db.delete(storyArcs).where(eq(storyArcs.id, id)).run()
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
    for (const [index, arc] of arcs.entries()) {
      db.insert(storyArcs).values({
        novelId,
        arcName: typeof arc.arc_name === 'string' ? arc.arc_name : typeof arc.name === 'string' ? arc.name : `故事弧${index + 1}`,
        arcOrder: typeof arc.order === 'number' ? arc.order : index + 1,
        chapterStart: typeof arc.chapter_start === 'number' ? arc.chapter_start : null,
        chapterEnd: typeof arc.chapter_end === 'number' ? arc.chapter_end : null,
        arcGoal: typeof arc.arc_goal === 'string' ? arc.arc_goal : typeof arc.goal === 'string' ? arc.goal : '',
        arcSummary: typeof arc.summary === 'string' ? arc.summary : '',
      }).run()
    }

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
          chapterStart: batchStart,
          chapterEnd: batchEnd,
          previousSummary: context.previousSummary,
          characterStates: context.characterStates,
          continuitySummary: context.continuitySummary,
          openLoops: context.openLoops,
          worldRulesSummary: context.worldRulesSummary,
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
      const title = typeof outline.title === 'string' ? outline.title : '第' + chapterNum + '章'
      const emotionTone = typeof outline.emotion_tone === 'string' ? outline.emotion_tone : ''

      if (existing) {
        db.update(chapters).set({
          title,
          outline: outlineText,
          emotionTone,
          arcId,
        }).where(eq(chapters.id, existing.id)).run()
      } else {
        db.insert(chapters).values({
          novelId: arc.novelId,
          chapterNum,
          title,
          outline: outlineText,
          emotionTone,
          arcId,
          status: 'outline',
          targetWords: 3000,
        }).run()
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

    return {
      generatedCount,
      completed,
      batchStart,
      batchEnd,
      message: completed
        ? '第' + batchStart + '至第' + batchEnd + '章细纲已生成，当前故事弧已补齐。'
        : '第' + batchStart + '至第' + batchEnd + '章细纲已生成，可继续生成下一批。',
    }
  })

  ipcMain.handle('model:list', () => {
    const db = getDb()
    return db.select().from(modelConfigs).all().map((config) => ({
      ...config,
      apiKey: config.apiKey ? '已设置' : '',
    }))
  })

  ipcMain.handle('model:create', (_, data) => {
    const db = getDb()
    const encryptedKey = data.apiKey ? encryptApiKey(data.apiKey) : null
    const result = db.insert(modelConfigs).values({ ...data, apiKey: encryptedKey }).run()
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('model:update', (_, id, data) => {
    const db = getDb()
    if (data.apiKey && data.apiKey !== '已设置') {
      data.apiKey = encryptApiKey(data.apiKey)
    } else if (data.apiKey === '已设置') {
      delete data.apiKey
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

  ipcMain.handle('task:cancel', (_, id) => taskService.cancelTask(id))
  ipcMain.handle('task:retry', async (event, id) => {
    const db = getDb()
    const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0]
    if (!task) throw new Error(`Task ${id} not found`)

    if (task.type === 'chapter_write' && task.relatedEntityType === 'chapter' && task.relatedEntityId) {
      return chapterService.generateChapterContent(task.relatedEntityId, event.sender)
    }

    if (task.type === 'subplot_framework') {
      return subplotService.retrySubplotBatch(id)
    }

    return taskService.retryTask(id, event.sender)
  })

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

    const result = await taskService.runChatTask({
      type: 'init',
      messages: [{
        role: 'user',
        content: expandBackgroundPrompt({
          userBackground: input.userBackground,
          genre,
          worldTemplateSummary,
        }),
      }],
      modelConfigId: input.modelConfigId,
    })

    return safeParseJson(result)
  })

  ipcMain.handle('ai:generateCoreSettings', (event, data: CoreSettingsGenerationRequest) =>
    coreSettingsService.generateCoreSettings(data, event.sender))
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
    const results = Array.from({ length: count }, () =>
      taskService.runChatTask({
        type: 'review',
        messages: data.messages,
        modelConfigId: data.modelConfigId,
      }),
    )
    return Promise.all(results)
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
      messages: [{
        role: 'user',
        content: contentScoringPrompt(data),
      }],
      modelConfigId: data.modelConfigId,
    })

    return safeParseJson(result)
  })
}
