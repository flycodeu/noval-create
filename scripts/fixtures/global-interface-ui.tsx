import React from 'react'
import { createRoot } from 'react-dom/client'
import { message } from 'antd'
import App from '../../src/App'
import { markRuntimeEnvironment } from '../../src/runtime/environment'
import { useThemeStore } from '../../src/stores/theme.store'
import '../../src/styles/global.css'
import '../../src/styles/ui-simplification.css'

// Only services are simulated. Production App, routing, pages, stores, and
// portal components are bundled unchanged. No database, main process, provider,
// updater, real CLI, or formal NovelForge profile is loaded by this fixture.
const clone = <T,>(value: T): T => structuredClone(value)
const win = window as any
const stamp = '2026-10-18T01:00:00.000Z'
const calls: Array<{ kind: string; input?: unknown }> = []
const unexpected: string[] = []
const errors: string[] = []
const listeners = new Map<string, Set<(value: any) => void>>()
const cancellations: Array<{ taskId: number; resolve: () => void; reject: (cause: Error) => void }> = []
const controls = { novelListError: false }
const models = [{ id: 7, name: '隔离测试 · 创作模型', provider: 'custom', modelId: 'compatible-creative-model-with-a-long-version-name-2026-10', apiKey: '已设置', baseUrl: 'https://models.example.test/compatible/v1', temperature: 0.8, maxTokens: 65536, maxContextTokens: 32000, maxConcurrency: 2, isDefault: 1, createdAt: stamp }]
const novels = [
  { id: 292, title: '照夜行 · 隔离界面验收', synopsis: '夜行人带着一盏旧灯穿过长巷。这里是界面隔离测试的作品，不会读取正式小说。', status: 'writing', totalWords: 16214, targetWords: 1000000, createdAt: stamp, updatedAt: stamp },
  { id: 293, title: '很长的暂定书名也应该完整留在自己的卡片之内而不挤出当前作品书架', synopsis: '', status: 'draft', totalWords: 0, targetWords: 300000, createdAt: stamp, updatedAt: stamp },
]
const templates = [
  { id: 4, name: '隔离文风模板', type: 'style', description: '简短句式，先行动再判断。', contentJson: JSON.stringify({ perspective: '第三人称近距', sentence_style: '短句推进', forbidden: ['空泛总结', '擅自补充决定性事实'] }), isBuiltin: 1, createdAt: stamp },
  { id: 5, name: '隔离自定义文风', type: 'style', description: '只在本测试内展示。', contentJson: '{"叙事视角":"第三人称限知"}', isBuiltin: 0, createdAt: stamp },
  { id: 6, name: '隔离世界模板', type: 'world', description: '古城灯火与夜行人。', contentJson: '{"时代背景":"架空古代"}', isBuiltin: 1, createdAt: stamp },
]
const tasks = [
  { id: 81, type: 'review', status: 'running', runnerType: 'stream', modelConfigId: 7, inputJson: JSON.stringify({ request: '检查隔离测试里的任务展示与取消流程，不读取任何正式正文。' }), outputText: '正在检查隔离界面。', createdAt: stamp, updatedAt: stamp },
  { id: 80, type: 'summary', status: 'success', runnerType: 'chat', outputText: '已完成隔离记录。', createdAt: stamp, updatedAt: stamp },
]
const sourceSettings = { provider: 'auto', tavilyApiKeySet: true, braveApiKeySet: false, tavilyEnvSet: false, braveEnvSet: false, activeProvider: 'tavily', updatedAt: stamp }
const zhuqueSettings = { enabled: false, autoDetect: true, apiKeySet: true }
let retrievalSettings = { mode: 'local', modelConfigId: null, modelId: '' }
const updateStatus = { currentVersion: '2.4.33', mode: 'installed', phase: 'up_to_date', latestVersion: null, downloadPercent: null, checkedAt: stamp, error: null }
const mcpStatus = {
  supported: true, codexCliPath: 'D:/Isolated Interface Fixture/Developer Tools/Codex/codex.exe', novelForgePath: 'D:/Isolated Interface Fixture/NovelForge/NovelForge.exe', registration: 'configured',
  registeredCommand: 'D:/Isolated Interface Fixture/NovelForge/NovelForge.exe', registeredArgs: ['--mcp'],
  command: '& "D:/Isolated Interface Fixture/Developer Tools/Codex/codex.exe" mcp add novelforge -- "D:/Isolated Interface Fixture/NovelForge/NovelForge.exe" --mcp',
  message: '隔离测试中的连接配置已登记。', runtime: { reachable: true, projectReadable: true, modelConfigured: true, toolCount: 31, activeRequests: 0, message: '隔离创作服务可读。' },
}
const record = (kind: string, input?: unknown) => calls.push({ kind, input: clone(input) })
const emit = (channel: string, payload: unknown) => listeners.get(channel)?.forEach(listener => listener(clone(payload)))
const allowedEvents = new Set(['task:stream-chunk', 'task:status-change', 'task:complete', 'task:progress', 'chapter:generation-progress', 'character:batch-progress', 'ai:core-settings-progress', 'ai:premise-progress', 'ai:world-rules-progress', 'app:update-status'])

// Missing services must fail the run, even when production code catches the
// exception. This is deliberately not a fallback that makes every call succeed.
function strictServices(value: Record<string, any>, prefix = 'electron'): any {
  return new Proxy(value, {
    get(target, key, receiver) {
      if (typeof key === 'symbol' || key in target) {
        const item = Reflect.get(target, key, receiver)
        return item && typeof item === 'object' ? strictServices(item, `${prefix}.${String(key)}`) : item
      }
      const missing = `${prefix}.${String(key)}`
      unexpected.push(missing)
      throw new Error(`Unimplemented isolated service: ${missing}`)
    },
  })
}

window.addEventListener('error', event => errors.push(event.message))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason?.stack || event.reason)))
win.fetch = () => { unexpected.push('network.fetch'); throw new Error('Network is forbidden in isolated UI tests') }
win.electron = strictServices({
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (!allowedEvents.has(channel)) { unexpected.push(`event:${channel}`); throw new Error(`Unimplemented isolated event: ${channel}`) }
    const set = listeners.get(channel) || new Set()
    set.add(listener); listeners.set(channel, set)
    return () => set.delete(listener)
  },
  app: {
    getRuntimeInfo: async () => ({ environment: 'test', source: 'source', version: updateStatus.currentVersion, executable: 'D:/Isolated Interface Fixture/NovelForge.exe', dataDirectory: 'D:/Isolated Interface Fixture/Profile' }),
    getLocalBackendStatus: async () => ({ isWebPreview: false, status: 'connected', connected: true, lastError: '', message: '隔离测试' }),
    getUpdateStatus: async () => clone(updateStatus),
    getCodexMcpSetupStatus: async (cliPath?: string) => { record('app.getCodexMcpSetupStatus', cliPath); return clone({ ...mcpStatus, ...(cliPath ? { codexCliPath: cliPath } : {}) }) },
    configureCodexMcp: async (cliPath?: string) => { record('app.configureCodexMcp', cliPath); return clone({ ...mcpStatus, ...(cliPath ? { codexCliPath: cliPath } : {}) }) },
    checkForUpdates: async () => { record('app.checkForUpdates'); return clone(updateStatus) },
    installUpdate: async () => { record('app.installUpdate'); return false },
    openReleasePage: async () => { record('app.openReleasePage') },
  },
  windowControls: {
    minimize: async () => { record('window.minimize') }, toggleMaximize: async () => false, isMaximized: async () => false,
    onMaximizedStateChange: () => () => {},
    onCloseRequested: (listener: (dirty: boolean) => void) => { win.fixture.requestClose = listener; return () => { win.fixture.requestClose = null } },
    close: async () => { win.fixture.requestClose?.(false) },
    confirmClose: async (choice: string) => { record('window.confirmClose', choice) },
  },
  novel: {
    list: async () => { record('novel.list'); if (controls.novelListError) throw new Error('隔离测试：作品读取失败'); return clone(novels) },
    create: async (input: unknown) => { record('novel.create', input); return 294 },
    delete: async (id: number) => { record('novel.delete', id) },
    update: async (id: number, input: unknown) => { record('novel.update', { id, input }) },
    export: async (id: number, format: string) => { record('novel.export', { id, format }); return '' },
  },
  model: {
    list: async () => clone(models),
    discover: async (input: unknown) => { record('model.discover', input); return { models: ['fixture-model-a', 'fixture-model-b'] } },
    test: async (id: number) => { record('model.test', id); return { success: true, latency: 14, info: '隔离模型连接成功' } },
    create: async (input: unknown) => { record('model.create', input); return 8 },
    update: async (id: number, input: unknown) => { record('model.update', { id, input }) },
    delete: async (id: number) => { record('model.delete', id) },
    setDefault: async (id: number) => { record('model.setDefault', id) },
  },
  sourceSearch: {
    getSettings: async () => clone(sourceSettings),
    updateSettings: async (input: unknown) => { record('sourceSearch.updateSettings', input); return clone(sourceSettings) },
    test: async (input: unknown) => { record('sourceSearch.test', input); return { success: true, providerName: 'tavily', latency: 18, info: '隔离搜索连接成功' } },
  },
  zhuque: {
    getSettings: async () => clone(zhuqueSettings), updateSettings: async (input: unknown) => { record('zhuque.updateSettings', input); return clone(zhuqueSettings) },
    test: async () => { record('zhuque.test'); return { success: true, latency: 20, info: '隔离检测连接成功' } },
  },
  template: {
    list: async () => clone(templates), create: async (input: unknown) => { record('template.create', input); return 7 },
    update: async (id: number, input: unknown) => { record('template.update', { id, input }) }, delete: async (id: number) => { record('template.delete', id) },
  },
  prompt: {
    list: async () => [], save: async (key: string, content: string) => { record('prompt.save', { key, content }) }, delete: async (key: string) => { record('prompt.delete', key) },
  },
  task: {
    query: async (input: any) => {
      const rows = tasks.filter(task => (!input.status || input.status === task.status) && (!input.type || input.type === task.type))
      return { items: clone(rows), page: input.page || 1, pageSize: input.pageSize || 10, total: rows.length, hasMore: false }
    },
    getStats: async () => ({ total: tasks.length, pendingCount: 0, runningCount: tasks.filter(task => task.status === 'running').length, cancelRequestedCount: 0, pausedCount: 0, successCount: 1, failedCount: 0, cancelledCount: tasks.filter(task => task.status === 'cancelled').length }),
    modelAttempts: async () => [],
    cancel: (taskId: number) => {
      record('task.cancel', taskId)
      return new Promise<void>((resolve, reject) => cancellations.push({ taskId, reject, resolve: () => { const task = tasks.find(row => row.id === taskId); if (task) task.status = 'cancelled'; emit('task:complete', { taskId, status: 'cancelled' }); resolve() } }))
    },
    retry: async (id: number) => { record('task.retry', id) },
    clearHistory: async (input: unknown) => { record('task.clearHistory', input); return { deletedCount: 1 } },
  },
  agentTools: {
    call: async ({ toolId, input }: { toolId: string; input: any }) => {
      record(toolId, input)
      if (toolId === 'novelforge.retrieval.settings_get') return { ok: true, data: clone(retrievalSettings) }
      if (toolId === 'novelforge.retrieval.settings_set') { retrievalSettings = clone(input); return { ok: true, data: clone(retrievalSettings) } }
      unexpected.push(toolId); throw new Error(`Unimplemented isolated tool: ${toolId}`)
    },
  },
})
win.fixture = { calls, unexpected, errors, controls, cancellations, emit, requestClose: null, setTheme: useThemeStore.getState().setTheme }
win.ui = {
  visible: (element: HTMLElement | null) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'),
  modal: () => [...document.querySelectorAll<HTMLElement>('.ant-modal')].find(element => win.ui.visible(element)),
  button: (text: string, scope = document) => [...scope.querySelectorAll('button')].find((element: any) => win.ui.visible(element) && (element.textContent.replace(/\s+/g, '') === text.replace(/\s+/g, '') || element.getAttribute('aria-label') === text)),
}
win.clearMessages = () => message.destroy()
location.hash = '/novels'
useThemeStore.getState().setTheme('light')
markRuntimeEnvironment()
createRoot(document.getElementById('root')!).render(<App />)
