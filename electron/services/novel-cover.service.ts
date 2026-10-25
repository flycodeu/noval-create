import { nativeImage, type NativeImage } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { novels } from '../database/schema'
import { getNovel } from './novel.service'
import { decryptApiKey, getModelConfigRecord } from './model.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import { isNovelCoverImage, validateCoverRequest, type GenerateNovelCoverInput, type SaveNovelCoverInput } from '../../src/shared/novel-cover'

// Store a bounded bitmap in the existing cover field so library backups remain self-contained.
function normalizeBitmap(bitmap: NativeImage): string {
  const { width, height } = bitmap.getSize()
  if (bitmap.isEmpty() || width < 1 || height < 1 || width * height > 40_000_000) throwUserFacingError('cover.invalidImage')
  const resized = width > 960 || height > 1440
    ? bitmap.resize({ width: Math.max(1, Math.round(width * Math.min(960 / width, 1440 / height))), height: Math.max(1, Math.round(height * Math.min(960 / width, 1440 / height))) }) : bitmap
  const result = `data:image/jpeg;base64,${resized.toJPEG(88).toString('base64')}`
  if (!isNovelCoverImage(result)) throwUserFacingError('cover.invalidImage')
  return result
}

function normalizeCover(image: string): string {
  if (!isNovelCoverImage(image)) throwUserFacingError('cover.invalidImage')
  return normalizeBitmap(nativeImage.createFromBuffer(Buffer.from(image.slice(image.indexOf(',') + 1), 'base64')))
}

export function setNovelCover(novelId: number, input: SaveNovelCoverInput) {
  if (!input || !(input.expectedCoverImage === null || typeof input.expectedCoverImage === 'string')
    || !(input.image === null || typeof input.image === 'string')) throwUserFacingError('cover.invalidImage')
  const image = input.image === null ? null : normalizeCover(input.image)
  return getSqlite().transaction(() => {
    const current = getDb().select().from(novels).where(eq(novels.id, novelId)).get()
    if (!current) throwUserFacingError('novel.notFound')
    if ((current.coverImage || null) !== (input.expectedCoverImage || null)) throwUserFacingError('cover.conflict')
    getDb().update(novels).set({ coverImage: image, updatedAt: new Date().toISOString() }).where(eq(novels.id, novelId)).run()
    return getNovel(novelId)!
  }).immediate()
}

async function readImageResponse(response: Response) {
  if (!response.body) throwUserFacingError('cover.emptyResponse')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 20_000_000) throwUserFacingError('cover.responseTooLarge')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: { b64_json?: unknown }[] } }
  catch { throwUserFacingError('cover.emptyResponse') }
}

export async function generateNovelCover(novelId: number, rawInput: GenerateNovelCoverInput): Promise<string> {
  if (!getDb().select({ id: novels.id }).from(novels).where(eq(novels.id, novelId)).get()) throwUserFacingError('novel.notFound')
  const input = validateCoverRequest(rawInput)
  const config = getModelConfigRecord(input.configId)
  if (!['openai', 'custom'].includes(config.provider)) throwUserFacingError('cover.unsupportedProvider')
  let endpoint: URL
  try {
    const baseUrl = config.baseUrl || (config.provider === 'custom' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1')
    endpoint = new URL(`${baseUrl.replace(/\/+$/, '')}/images/generations`)
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('invalid endpoint')
  } catch { throwUserFacingError('cover.invalidEndpoint') }
  const key = config.apiKey ? decryptApiKey(config.apiKey) : ''
  if (config.apiKey && !key) throwUserFacingError('cover.invalidKey')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: input.modelId, prompt: input.prompt, n: 1, size: input.size,
        ...(/^gpt-image-/i.test(input.modelId) ? {} : { response_format: 'b64_json' }) }),
    })
    if (!response.ok) { await response.body?.cancel(); throwUserFacingError('cover.providerFailed', { status: response.status }) }
    const data = await readImageResponse(response)
    const encoded = data?.data?.[0]?.b64_json
    // URL-only replies are deliberately not fetched: saved model endpoints cannot redirect us to arbitrary hosts.
    if (typeof encoded !== 'string' || encoded.length > 19_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throwUserFacingError('cover.emptyResponse')
    return normalizeBitmap(nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')))
  } catch (cause) {
    // Never surface raw provider bodies, request URLs or credentials in renderer errors.
    if (cause && typeof cause === 'object' && 'messageKey' in cause) throw cause
    throwUserFacingError(controller.signal.aborted ? 'cover.timedOut' : 'cover.connectionFailed')
  } finally { clearTimeout(timer) }
}
