import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDb, closeDb } from './database/db'
import * as novelService from './services/novel.service'
import * as chapterService from './services/chapter.service'
import * as characterService from './services/character.service'
import * as mapService from './services/map.service'
import * as modelService from './services/model.service'
import * as exportService from './services/export.service'
import * as taskService from './services/task.service'
import { encryptApiKey } from './services/model.service'
import { getDb } from './database/db'
import { modelConfigs, templates, tasks, storyArcs, chapters, novels as novelsTable, genres as genresTable } from './database/schema'
import { eq, desc } from 'drizzle-orm'
import { storyArcsPrompt, chapterOutlinePrompt, rewriteParagraphPrompt, expandBackgroundPrompt, contentScoringPrompt } from './services/prompts'
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
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8')
    return JSON.parse(raw)
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
      : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, isMaximized: false }
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf-8')
  } catch {}
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
    // 使用 electron-vite 自动设置的 ELECTRON_RENDERER_URL（支持端口自动切换）
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

  // 保存窗口状态
  mainWindow.on('close', () => {
    if (mainWindow) saveWindowState(mainWindow)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
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
  // ==================== 小说管理 ====================
  ipcMain.handle('novel:list', (_, filters) => novelService.listNovels(filters))
  ipcMain.handle('novel:get', (_, id) => novelService.getNovel(id))
  ipcMain.handle('novel:create', (_, data) => novelService.createNovel(data))
  ipcMain.handle('novel:update', (_, id, data) => novelService.updateNovel(id, data))
  ipcMain.handle('novel:delete', (_, id) => novelService.deleteNovel(id))
  ipcMain.handle('novel:export', (_, id, format) => exportService.exportNovel(id, format))
  ipcMain.handle('novel:stats', (_, id) => novelService.getNovelStats(id))

  // ==================== 章节管理 ====================
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

  // ==================== 人物管理 ====================
  ipcMain.handle('character:list', (_, novelId) => characterService.listCharacters(novelId))
  ipcMain.handle('character:get', (_, id) => characterService.getCharacter(id))
  ipcMain.handle('character:create', (_, novelId, data) => characterService.createCharacter(novelId, data))
  ipcMain.handle('character:update', (_, id, data) => characterService.updateCharacter(id, data))
  ipcMain.handle('character:delete', (_, id) => characterService.deleteCharacter(id))
  ipcMain.handle('character:getRelations', (_, novelId) => characterService.getCharacterRelations(novelId))
  ipcMain.handle('character:generateProtagonist', (_, novelId, opts) =>
    characterService.generateProtagonist(novelId, opts))
  ipcMain.handle('character:batchGenerate', (event, novelId, opts) =>
    characterService.batchGenerateCharacters(novelId, opts, event.sender))
  ipcMain.handle('character:generateRelations', (_, novelId) =>
    characterService.generateCharacterRelations(novelId))
  ipcMain.handle('character:upsertRelation', (_, data) => characterService.upsertRelation(data))

  // ==================== 地图管理 ====================
  ipcMain.handle('map:getTree', (_, novelId) => mapService.getMapTree(novelId))
  ipcMain.handle('map:create', (_, novelId, data) => mapService.createMapItem(novelId, data))
  ipcMain.handle('map:update', (_, id, data) => mapService.updateMapItem(id, data))
  ipcMain.handle('map:delete', (_, id) => mapService.deleteMapItem(id))
  ipcMain.handle('map:batchGenerate', (_, novelId, structure) =>
    mapService.batchGenerateMap(novelId, structure))

  // ==================== 大纲管理 ====================
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
  ipcMain.handle('outline:generateArcs', async (_, novelId) => {
    const db = getDb()
    // already imported
    const novel = db.select().from(novelsTable).where(eq(novelsTable.id, novelId)).all()[0]
    if (!novel) throw new Error('小说不存在')

    const settings = novel.settingsJson ? JSON.parse(novel.settingsJson) : {}
    const prompt = storyArcsPrompt({
      novelTitle: novel.title,
      genre: '未知题材',
      storyGoal: settings.story_goal || '',
      coreConflict: settings.core_conflict || '',
      mainPlot: settings.main_plot || '',
      subPlots: settings.sub_plots || '',
      ending: settings.ending || '',
      totalChapters: Math.ceil((novel.targetWords || 200000) / 3000),
    })

    const result = await taskService.runChatTask({
      type: 'chapter_outline',
      novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    const arcs = safeParseJson<Record<string, unknown>[]>(result)
    for (const arc of arcs) {
      db.insert(storyArcs).values({
        novelId,
        arcName: arc.arc_name || arc.name,
        arcOrder: arc.order || 1,
        chapterStart: arc.chapter_start,
        chapterEnd: arc.chapter_end,
        arcGoal: arc.arc_goal || arc.goal,
        arcSummary: arc.summary || '',
      }).run()
    }
    return arcs
  })
  ipcMain.handle('outline:generateChapterOutlines', async (_, arcId) => {
    const db = getDb()
    const arc = db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).all()[0]
    if (!arc) throw new Error('故事弧不存在')

    // already imported
    const novel = db.select().from(novelsTable).where(eq(novelsTable.id, arc.novelId)).all()[0]
    if (!novel) throw new Error('小说不存在')

    const prompt = chapterOutlinePrompt({
      novelTitle: novel.title,
      arcName: arc.arcName,
      arcGoal: arc.arcGoal || '',
      chapterStart: arc.chapterStart || 1,
      chapterEnd: arc.chapterEnd || 10,
      previousSummary: '',
      characterStates: '',
      worldRulesSummary: '',
    })

    const result = await taskService.runChatTask({
      type: 'chapter_outline',
      novelId: arc.novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    const outlines = safeParseJson<Record<string, unknown>[]>(result)
    for (const outline of outlines) {
      const chapterNum = outline.chapter_num || outline.num
      const existing = db.select().from(chapters)
        .where(eq(chapters.novelId, arc.novelId))
        .all()
        .find(c => c.chapterNum === chapterNum)

      if (existing) {
        db.update(chapters).set({
          title: outline.title,
          outline: (outline.plot_points || []).join('\n'),
          emotionTone: outline.emotion_tone,
          arcId,
        }).where(eq(chapters.id, existing.id)).run()
      } else {
        db.insert(chapters).values({
          novelId: arc.novelId,
          chapterNum,
          title: outline.title,
          outline: (outline.plot_points || []).join('\n'),
          emotionTone: outline.emotion_tone,
          arcId,
          status: 'outline',
        }).run()
      }
    }
    return outlines
  })

  // ==================== 模型管理 ====================
  ipcMain.handle('model:list', () => {
    const db = getDb()
    return db.select().from(modelConfigs).all().map(c => ({
      ...c,
      apiKey: c.apiKey ? '已设置' : '',
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

  // ==================== 模板管理 ====================
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
    const tmpl = db.select().from(templates).where(eq(templates.id, id)).all()[0]
    if (tmpl?.isBuiltin) throw new Error('内置模板不可删除')
    db.delete(templates).where(eq(templates.id, id)).run()
  })

  // ==================== 任务管理 ====================
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
  ipcMain.handle('task:retry', (event, id) => taskService.retryTask(id, event.sender))

  // ==================== AI 功能 ====================
  ipcMain.handle('ai:expandBackground', async (_, input: {
    userBackground: string
    genreId: number
    worldTemplateId?: number
    modelConfigId?: number
  }) => {
    const db = getDb()
    // already imported
    const genreRows = input.genreId ? db.select().from(genresTable).where(eq(genresTable.id, input.genreId)).all() : []
    const genre = genreRows[0]?.name || '未知题材'

    let worldTemplateSummary = ''
    if (input.worldTemplateId) {
      const tmpl = db.select().from(templates).where(eq(templates.id, input.worldTemplateId)).all()[0]
      worldTemplateSummary = tmpl?.name || ''
    }

    const prompt = expandBackgroundPrompt({
      userBackground: input.userBackground,
      genre,
      worldTemplateSummary,
    })

    const result = await taskService.runChatTask({
      type: 'init',
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: input.modelConfigId,
    })

    return safeParseJson(result)
  })

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
    const prompt = rewriteParagraphPrompt({
      originalParagraph: data.originalParagraph,
      contextBefore: data.contextBefore,
      specificRequirements: data.specificRequirements,
    })

    return taskService.runChatTask({
      type: 'review',
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: data.modelConfigId,
    })
  })

  // ==================== 通用：批量运行提示词（抽卡用）====================
  ipcMain.handle('ai:runPrompt', async (_, data: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    count?: number
    modelConfigId?: number
  }) => {
    const count = Math.min(Math.max(data.count || 1, 1), 3)
    const tasks = Array.from({ length: count }, () =>
      taskService.runChatTask({
        type: 'review' as const,
        messages: data.messages,
        modelConfigId: data.modelConfigId,
      })
    )
    return Promise.all(tasks)
  })

  // ==================== AI 内容评分 ====================
  ipcMain.handle('ai:scoreContent', async (_, data: {
    contentType: string
    content: string
    genreContext: string
    novelBackground: string
    modelConfigId?: number
  }) => {
    const prompt = contentScoringPrompt(data)
    const result = await taskService.runChatTask({
      type: 'review' as const,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: data.modelConfigId,
    })
    return safeParseJson(result)
  })
}
