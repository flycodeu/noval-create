import { app, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getSqlite } from '../database/db'
import type { ZhuqueChapterView, ZhuqueMetrics, ZhuqueReport, ZhuqueSettingsUpdate, ZhuqueSettingsView, ZhuqueTestResult } from '../../src/shared/zhuque-detection'

// Official Makers endpoint. No configurable proxy or redirect may receive the local key.
const ENDPOINT = 'https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify'
class ZhuqueResponseError extends Error {}
interface StoredSettings { enabled: boolean; autoDetect: boolean; encryptedKey?: string }
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const running = new Map<number, Promise<ZhuqueChapterView>>()
function directory() { return path.join(app.getPath('userData'), 'local-zhuque') }
function settingsFile() { return path.join(directory(), 'credentials.json') }
function reportFile(id: number) { return path.join(directory(), `chapter-${id}.json`) }
function writeJson(file: string, data: unknown) {
  fs.mkdirSync(directory(), { recursive: true })
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 })
  fs.renameSync(temporary, file)
}
function readSettings(): StoredSettings {
  if (!fs.existsSync(settingsFile())) return { enabled: false, autoDetect: true }
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as StoredSettings
    return { enabled: data.enabled === true, autoDetect: data.autoDetect === true, encryptedKey: typeof data.encryptedKey === 'string' ? data.encryptedKey : undefined }
  } catch { throw new Error('朱雀本地配置无法读取，请重新保存配置。') }
}
export function getZhuqueSettings(): ZhuqueSettingsView {
  const settings = readSettings()
  return { enabled: settings.enabled, autoDetect: settings.autoDetect, apiKeySet: Boolean(settings.encryptedKey) }
}
export function updateZhuqueSettings(input: ZhuqueSettingsUpdate): ZhuqueSettingsView {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['enabled', 'autoDetect', 'apiKey'].includes(key))) throw new Error('朱雀配置字段无效。')
  for (const key of ['enabled', 'autoDetect'] as const) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('朱雀开关必须为布尔值。')
  const next = { ...readSettings(), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.autoDetect !== undefined ? { autoDetect: input.autoDetect } : {}) }
  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) throw new Error('朱雀 API Key 格式无效。')
    const key = input.apiKey.trim()
    if (key) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('本机安全存储不可用，未保存密钥。')
      next.encryptedKey = safeStorage.encryptString(key).toString('base64')
    } else delete next.encryptedKey
  }
  if (next.enabled && !next.encryptedKey) throw new Error('启用朱雀前请先保存 API Key。')
  writeJson(settingsFile(), next)
  if (!next.enabled || !next.autoDetect) { for (const timer of timers.values()) clearTimeout(timer); timers.clear() }
  return getZhuqueSettings()
}
function localKey(): string {
  const settings = readSettings()
  if (!settings.enabled) throw new Error('朱雀检测已关闭。')
  if (!settings.encryptedKey || !safeStorage.isEncryptionAvailable()) throw new Error('朱雀本地密钥不可用，请重新配置。')
  try { return safeStorage.decryptString(Buffer.from(settings.encryptedKey, 'base64')) }
  catch { throw new Error('朱雀本地密钥无法解密，请重新配置。') }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function ratio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new ZhuqueResponseError('朱雀返回的检测比例无效。')
  return value
}
export function parseZhuqueResponse(value: unknown): ZhuqueMetrics {
  const data = record(value), labels = record(data.labels_ratio)
  if (data.status !== 'success') throw new ZhuqueResponseError('朱雀未返回成功检测结果。')
  const humanRatio = ratio(labels['0']), aiRatio = ratio(labels['1']), suspectedAiRatio = ratio(labels['2'])
  if (Math.abs(humanRatio + aiRatio + suspectedAiRatio - 1) > 0.02) throw new ZhuqueResponseError('朱雀返回的内容占比不完整。')
  if (!Array.isArray(data.segment_labels)) throw new ZhuqueResponseError('朱雀返回的分段结果无效。')
  const segments = data.segment_labels.map(value => {
    const segment = record(value)
    if (![0, 1, 2].includes(Number(segment.label)) || typeof segment.label !== 'number' || typeof segment.text !== 'string') throw new ZhuqueResponseError('朱雀返回的分段标签无效。')
    return { label: segment.label as 0 | 1 | 2, confidence: ratio(segment.conf), text: segment.text }
  })
  const tokens = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
  return { humanRatio, aiRatio, suspectedAiRatio, confidence: ratio(data.softmax_confidence), riskRatio: ratio(data.ratio_confidence), segments,
    tokensUsed: tokens(record(data.usage).total_tokens), quotaTokensUsed: tokens(record(data.makers_models_usage).total_tokens) }
}
async function classify(content: string): Promise<ZhuqueMetrics> {
  const key = localKey()
  if (!key) throw new Error('朱雀本地密钥为空，请重新配置。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  try {
    // Do not use chat tasks, model attempt logs or provider messages containing credentials.
    const response = await fetch(ENDPOINT, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ text: content, is_merge: false }) })
    if (!response.ok) throw new ZhuqueResponseError(response.status === 401 ? '朱雀密钥无效（401），请重新配置。' : response.status === 429 ? '朱雀请求限流（429），请稍后手动重试。' : `朱雀接口请求失败（HTTP ${response.status}）。`)
    const metrics = parseZhuqueResponse(await response.json())
    if (metrics.segments.some(segment => !content.includes(segment.text))) throw new ZhuqueResponseError('朱雀分段结果与提交的正文不匹配。')
    return metrics
  } catch (error) {
    // Never echo upstream bodies, fetch exceptions, headers or the key into IPC/logs.
    if (error instanceof ZhuqueResponseError) throw error
    throw new Error(controller.signal.aborted ? '朱雀检测超时，未自动重试。' : '朱雀检测请求失败，未自动重试。')
  } finally { clearTimeout(timer) }
}
function chapterContent(id: number): string {
  if (!Number.isInteger(id) || id < 1) throw new Error('章节编号无效。')
  const chapter = getSqlite().prepare('SELECT content FROM chapters WHERE id = ?').get(id) as { content: string | null } | undefined
  if (!chapter) throw new Error('章节不存在。')
  return chapter.content || ''
}
export function zhuqueContentHash(text: string): string { return createHash('sha256').update(text).digest('hex') }
function readReport(id: number): ZhuqueReport | undefined {
  if (!fs.existsSync(reportFile(id))) return undefined
  try {
    const report = JSON.parse(fs.readFileSync(reportFile(id), 'utf8')) as ZhuqueReport
    if (report.chapterId !== id || !['success', 'failed'].includes(report.status) || typeof report.contentHash !== 'string') return undefined
    return report
  } catch { return undefined }
}
export function getZhuqueChapterResult(id: number): ZhuqueChapterView {
  const content = chapterContent(id), report = readReport(id)
  const status = running.has(id) || timers.has(id) ? 'running' : !report ? 'not_checked' : report.contentHash !== zhuqueContentHash(content) ? 'stale' : report.status
  return { ...getZhuqueSettings(), status, report }
}
export async function detectZhuqueChapter(id: number, expectedContent?: string): Promise<ZhuqueChapterView> {
  const content = chapterContent(id)
  if (expectedContent !== undefined && (typeof expectedContent !== 'string' || content !== expectedContent)) throw new Error('正文版本已变化，请刷新后检测。')
  if (!content.trim()) throw new Error('正文为空，无法进行朱雀检测。')
  if (!getZhuqueSettings().enabled) throw new Error('朱雀检测已关闭，请在模型设置中启用。')
  if (running.has(id)) return running.get(id)!
  const contentHash = zhuqueContentHash(content), existing = readReport(id)
  if (existing?.status === 'success' && existing.contentHash === contentHash) return getZhuqueChapterResult(id)
  const job = (async () => {
    const report: ZhuqueReport = { chapterId: id, contentHash, checkedAt: new Date().toISOString(), status: 'success' }
    try { report.metrics = await classify(content) }
    catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : '朱雀检测失败。' }
    // A deleted chapter cannot receive a report; edited text remains visibly stale.
    chapterContent(id)
    writeJson(reportFile(id), report)
    return report
  })()
  const result = job.then(() => { running.delete(id); return getZhuqueChapterResult(id) }).finally(() => running.delete(id))
  running.set(id, result)
  return result
}
export function scheduleZhuqueChapterDetection(id: number, expectedContent: string): void {
  // Only call once the synchronous transaction has returned. A rollback won't match this hash.
  const previous = timers.get(id)
  if (previous) clearTimeout(previous)
  timers.delete(id)
  try { const settings = getZhuqueSettings(); if (!settings.enabled || !settings.autoDetect) return } catch { return }
  const timer = setTimeout(async () => {
    timers.delete(id)
    try {
      const settings = getZhuqueSettings()
      if (!settings.enabled || !settings.autoDetect || chapterContent(id) !== expectedContent || !expectedContent.trim()) return
      const activeGeneration = getSqlite().prepare("SELECT id FROM tasks WHERE type = 'chapter_write' AND runner_type = 'workflow' AND related_entity_type = 'chapter' AND related_entity_id = ? AND status IN ('pending','running','cancel_requested') LIMIT 1").get(id) as { id?: number } | undefined
      if (activeGeneration?.id) { scheduleZhuqueChapterDetection(id, expectedContent); return }
      const active = running.get(id)
      if (active) await active
      if (chapterContent(id) === expectedContent && getZhuqueSettings().enabled && getZhuqueSettings().autoDetect) await detectZhuqueChapter(id)
    } catch { /* Background detection failures are surfaced through the report, never block saving. */ }
  }, 1500)
  timer.unref()
  timers.set(id, timer)
}
export async function testZhuqueConnection(): Promise<ZhuqueTestResult> {
  const started = Date.now()
  try {
    await classify('清晨的街道上，卖豆浆的摊主刚刚支起炉子。行人停下来买了一碗热豆浆，又匆匆走向巷口。')
    return { success: true, info: '朱雀接口检测成功。', latency: Date.now() - started }
  } catch (error) { return { success: false, info: error instanceof Error ? error.message : '朱雀连接失败。', latency: Date.now() - started } }
}
