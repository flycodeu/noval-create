import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ files: new Map<string, string>(), chapters: new Map<number, string>(), encryptionAvailable: true, activeGeneration: false }))
vi.mock('electron', () => ({ app: { getPath: () => '/fixture-local' }, safeStorage: {
  isEncryptionAvailable: () => fixture.encryptionAvailable,
  encryptString: (key: string) => Buffer.from(`encrypted:${key}`),
  decryptString: (buffer: Buffer) => buffer.toString().replace(/^encrypted:/, ''),
} }))
vi.mock('node:fs', () => ({ default: {
  existsSync: (name: string) => fixture.files.has(name),
  readFileSync: (name: string) => fixture.files.get(name),
  mkdirSync: vi.fn(), writeFileSync: (name: string, text: string) => fixture.files.set(name, text),
  renameSync: (before: string, after: string) => { fixture.files.set(after, fixture.files.get(before)!); fixture.files.delete(before) },
} }))
vi.mock('../database/db', () => ({ getSqlite: () => ({ prepare: (sql: string) => ({ get: (id: number) => sql.includes('FROM tasks') ? fixture.activeGeneration ? { id: 1 } : undefined : fixture.chapters.has(id) ? { content: fixture.chapters.get(id) } : undefined }) }) }))
import { detectZhuqueChapter, getZhuqueChapterResult, getZhuqueSettings, parseZhuqueResponse, scheduleZhuqueChapterDetection, testZhuqueConnection, updateZhuqueSettings } from './zhuque-detection.service'
const payload = { status: 'success', labels_ratio: { '0': 0.2, '1': 0.3, '2': 0.5 }, softmax_confidence: 0.6, ratio_confidence: 0.8,
  segment_labels: [{ text: '这是测试正文。', label: 2, conf: 0.6 }], usage: { total_tokens: 100 }, makers_models_usage: { total_tokens: 50 } }
const mockFetch = vi.fn()
const reply = () => ({ ok: true, json: async () => payload })
describe('local Zhuque detector', () => {
  beforeEach(() => { fixture.files.clear(); fixture.chapters.clear(); fixture.chapters.set(1, '这是测试正文。'); fixture.encryptionAvailable = true; fixture.activeGeneration = false; mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  it('defaults off, never calls the provider when disabled and never invents a zero score', async () => {
    expect(getZhuqueSettings()).toEqual({ enabled: false, autoDetect: true, apiKeySet: false })
    await expect(detectZhuqueChapter(1)).rejects.toThrow('已关闭')
    expect((await testZhuqueConnection()).success).toBe(false)
    expect(getZhuqueChapterResult(1).report).toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('tests a saved key while disabled using only the fixed sample without enabling or scheduling prose detection', async () => {
    vi.useFakeTimers()
    updateZhuqueSettings({ apiKey: 'secret-fixture' })
    const saved = [...fixture.files.entries()]
    mockFetch.mockImplementation(async (_url, options) => ({ ok: true, json: async () => ({ ...payload, segment_labels: [{ text: JSON.parse(options.body).text, label: 0, conf: 0.6 }] }) }))
    expect((await testZhuqueConnection()).success).toBe(true)
    expect(getZhuqueSettings()).toEqual({ enabled: false, autoDetect: true, apiKeySet: true })
    expect([...fixture.files.entries()]).toEqual(saved)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).toContain('卖豆浆的摊主')
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).not.toBe(fixture.chapters.get(1))
    await expect(detectZhuqueChapter(1)).rejects.toThrow('已关闭')
    scheduleZhuqueChapterDetection(1, '这是测试正文。')
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(getZhuqueChapterResult(1).report).toBeUndefined()
  })
  it('keeps authentication failures visible when a saved key is tested while disabled', async () => {
    updateZhuqueSettings({ apiKey: 'secret-fixture' })
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ msg: 'secret-fixture' }) })
    const result = await testZhuqueConnection()
    expect(result.success).toBe(false)
    expect(result.info).toContain('密钥无效（401）')
    expect(JSON.stringify(result)).not.toContain('secret-fixture')
    expect(getZhuqueSettings().enabled).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
  it.each(['replacement-fixture', ''])('invalidates an in-flight connection test when its credential changes to %s', async apiKey => {
    updateZhuqueSettings({ apiKey: 'secret-fixture' })
    let resolve!: (value: ReturnType<typeof reply>) => void
    mockFetch.mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = testZhuqueConnection()
    updateZhuqueSettings({ apiKey })
    resolve({ ok: true, json: async () => ({ ...payload, segment_labels: [] }) })
    const result = await pending
    expect(result.success).toBe(false)
    expect(result.info).toContain('密钥已变化')
    expect(getZhuqueSettings().enabled).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
  it('refuses a stale editor version before sending saved prose to the provider', async () => {
    updateZhuqueSettings({ enabled: true, apiKey: 'fixture' })
    await expect(detectZhuqueChapter(1, '旧的正文。')).rejects.toThrow('版本已变化')
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('stores only encrypted local keys and never exposes them in settings or reports', async () => {
    const settings = updateZhuqueSettings({ enabled: true, apiKey: 'secret-fixture' })
    expect(settings).toEqual({ enabled: true, autoDetect: true, apiKeySet: true })
    expect(JSON.stringify(settings)).not.toContain('secret-fixture')
    expect([...fixture.files.values()].join('')).not.toContain('secret-fixture')
    mockFetch.mockResolvedValue(reply())
    const result = await detectZhuqueChapter(1)
    expect(result.status).toBe('success'); expect(result.report?.metrics?.aiRatio).toBe(0.3)
    expect(result.report?.metrics?.suspectedAiRatio).toBe(0.5)
    expect(JSON.stringify(result)).not.toContain('secret-fixture')
    expect(mockFetch).toHaveBeenCalledWith('https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify', expect.objectContaining({ redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-fixture' }, body: JSON.stringify({ text: '这是测试正文。', is_merge: false }) }))
    await detectZhuqueChapter(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    updateZhuqueSettings({ enabled: false }); expect(getZhuqueSettings().apiKeySet).toBe(true)
    updateZhuqueSettings({ apiKey: '' }); expect(getZhuqueSettings().apiKeySet).toBe(false)
  })
  it('rejects unsafe persistence and bad configuration before writing anything', () => {
    fixture.encryptionAvailable = false
    expect(() => updateZhuqueSettings({ apiKey: 'secret' })).toThrow('安全存储不可用')
    expect(fixture.files.size).toBe(0)
    expect(() => updateZhuqueSettings({ enabled: true })).toThrow('先保存')
    expect(() => updateZhuqueSettings({ apiKey: 'secret\nheader' })).toThrow('格式无效')
    expect(() => updateZhuqueSettings({ enabled: 'yes' } as never)).toThrow('布尔值')
  })
  it('rejects invalid, partial or non-successful response fields', () => {
    for (const invalid of [{}, { ...payload, status: 'failed', msg: 'secret-fixture' }, { ...payload, labels_ratio: { '0': 0, '1': 0 } }, { ...payload, softmax_confidence: 10 }, { ...payload, segment_labels: [{ label: 8, conf: 0.2, text: '不存在' }] }]) expect(() => parseZhuqueResponse(invalid)).toThrow('朱雀')
  })
  it('records safe failure details without leaking upstream secrets or retrying requests', async () => {
    updateZhuqueSettings({ enabled: true, apiKey: 'secret-fixture' })
    mockFetch.mockRejectedValue(new Error('朱雀 secret-fixture in upstream error'))
    const result = await detectZhuqueChapter(1)
    expect(result.status).toBe('failed'); expect(result.report?.metrics).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('secret-fixture'); expect(mockFetch).toHaveBeenCalledTimes(1)
  })
  it('shows old results as stale if the chapter changes while a request is in flight', async () => {
    updateZhuqueSettings({ enabled: true, apiKey: 'fixture' })
    let resolve!: (value: ReturnType<typeof reply>) => void
    mockFetch.mockImplementation(() => new Promise(done => { resolve = done }))
    const first = detectZhuqueChapter(1), duplicate = detectZhuqueChapter(1)
    expect(getZhuqueChapterResult(1).status).toBe('running')
    fixture.chapters.set(1, '改后的完整正文。')
    resolve(reply()); await first; await duplicate
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(getZhuqueChapterResult(1).status).toBe('stale')
  })
  it('aborts timed out requests, clears the running state and allows an explicit retry', async () => {
    vi.useFakeTimers(); updateZhuqueSettings({ enabled: true, apiKey: 'secret-fixture' })
    mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('secret-fixture aborted transport')), { once: true })
    }))
    const pending = detectZhuqueChapter(1)
    await vi.advanceTimersByTimeAsync(45_000)
    const result = await pending
    expect(result.status).toBe('failed'); expect(result.report?.error).toContain('超时')
    expect(result.report?.metrics).toBeUndefined(); expect(JSON.stringify(result)).not.toContain('secret-fixture')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    mockFetch.mockResolvedValue(reply())
    expect((await detectZhuqueChapter(1)).status).toBe('success')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
  it('debounces saved versions, ignores rolled back text and cancels queued calls when disabled', async () => {
    vi.useFakeTimers(); updateZhuqueSettings({ enabled: true, apiKey: 'fixture' }); mockFetch.mockResolvedValue(reply())
    scheduleZhuqueChapterDetection(1, '未提交的正文。')
    await vi.advanceTimersByTimeAsync(1500); expect(mockFetch).not.toHaveBeenCalled()
    scheduleZhuqueChapterDetection(1, '这是测试正文。'); scheduleZhuqueChapterDetection(1, '这是测试正文。')
    await vi.advanceTimersByTimeAsync(1500); expect(mockFetch).toHaveBeenCalledTimes(1)
    fixture.chapters.set(1, '新正文。'); scheduleZhuqueChapterDetection(1, '新正文。')
    updateZhuqueSettings({ enabled: false }); await vi.advanceTimersByTimeAsync(2000)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
  it('honors manual-only mode and never submits a deleted chapter', async () => {
    vi.useFakeTimers(); updateZhuqueSettings({ enabled: true, autoDetect: false, apiKey: 'fixture' })
    scheduleZhuqueChapterDetection(1, '这是测试正文。'); await vi.advanceTimersByTimeAsync(1500)
    expect(mockFetch).not.toHaveBeenCalled()
    fixture.chapters.delete(1); await expect(detectZhuqueChapter(1)).rejects.toThrow('不存在')
  })
  it('waits for generation to end and does not detect intermediate saved drafts', async () => {
    vi.useFakeTimers(); updateZhuqueSettings({ enabled: true, apiKey: 'fixture' }); mockFetch.mockResolvedValue(reply())
    fixture.activeGeneration = true; scheduleZhuqueChapterDetection(1, '这是测试正文。')
    await vi.advanceTimersByTimeAsync(3000); expect(mockFetch).not.toHaveBeenCalled()
    fixture.activeGeneration = false
    await vi.advanceTimersByTimeAsync(1500); expect(mockFetch).toHaveBeenCalledTimes(1)
  })
  it.each([401, 403, 429, 500])('keeps HTTP %s failure separate from successful zero-AI reports', async status => {
    updateZhuqueSettings({ enabled: true, apiKey: 'secret-fixture' })
    mockFetch.mockResolvedValue({ ok: false, status, json: async () => ({ msg: 'secret-fixture' }) })
    const result = await detectZhuqueChapter(1)
    expect(result.status).toBe('failed'); expect(result.report?.metrics).toBeUndefined()
    expect(result.report?.error).toContain(String(status)); expect(JSON.stringify(result)).not.toContain('secret-fixture')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
