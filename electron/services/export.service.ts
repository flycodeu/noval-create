import { once } from 'events'
import fs from 'fs'
import path from 'path'
import { dialog, app } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx'
import { getDb } from '../database/db'
import { chapters, novels, storyVolumes } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { collectQualityGuardrailFindings } from '../../src/shared/content-guardrails'

type ExportFormat = 'txt' | 'md' | 'json' | 'docx' | 'epub'
type PlatformFormat = 'fanqie' | 'feilu' | 'qidian' | 'jjwxc' | 'generic'
type PlatformFormatScope = 'currentChapter' | 'selectedChapters' | 'all'
type ChapterRecord = typeof chapters.$inferSelect
type NovelRecord = typeof novels.$inferSelect
type VolumeRecord = typeof storyVolumes.$inferSelect

export interface PlatformFormatOptions {
  platform?: PlatformFormat
  scope?: PlatformFormatScope
  chapterId?: number
  chapterIds?: number[]
  batchSize?: number
  sensitiveWords?: string[]
}

interface PlatformFormatBatch {
  index: number
  title: string
  content: string
  chapterCount: number
  wordCount: number
  chapterStart?: number
  chapterEnd?: number
}

export interface PlatformFormatResult {
  platform: PlatformFormat
  scope: PlatformFormatScope
  title: string
  content: string
  chapterCount: number
  wordCount: number
  warnings: string[]
  removedLineCount: number
  sensitiveWordHits: Array<{
    word: string
    count: number
    chapterNums: number[]
  }>
  batches: PlatformFormatBatch[]
}

interface ExportChunk {
  id: string
  title: string
  fileStem: string
  chapters: ChapterRecord[]
  chapterStart: number
  chapterEnd: number
  wordCount: number
  volumeId?: number | null
}

const LARGE_EXPORT_WORD_THRESHOLD = 350_000
const LARGE_EXPORT_CHAPTER_THRESHOLD = 100
const CHUNK_WORD_LIMIT = 300_000
const CHUNK_CHAPTER_LIMIT = 100

function sanitizeFileName(value: string, fallback: string): string {
  const normalized = (value || '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
  const collapsed = normalized.replace(/\s+/g, ' ').trim()
  return collapsed || fallback
}

function getVolumeLabel(volume: Pick<VolumeRecord, 'title' | 'volumeNumber'>): string {
  return volume.title?.trim() || `第${volume.volumeNumber}卷`
}

function resolveChapterWordCount(chapter: ChapterRecord): number {
  if (typeof chapter.wordCount === 'number' && chapter.wordCount > 0) return chapter.wordCount
  return (chapter.content || '').length
}

function countTextWords(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  const numbers = (text.match(/\d+/g) || []).length
  return chinese + english + numbers
}

function normalizePlatform(value: unknown): PlatformFormat {
  return value === 'fanqie' || value === 'feilu' || value === 'qidian' || value === 'jjwxc' || value === 'generic'
    ? value
    : 'generic'
}

function normalizePlatformScope(value: unknown): PlatformFormatScope {
  return value === 'currentChapter' || value === 'selectedChapters' || value === 'all'
    ? value
    : 'all'
}

function shouldDropPlatformLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  return /^(?:```|---+$)/.test(trimmed)
    || /^(?:以下是|下面是).{0,16}(?:正文|优化|改写|生成)/u.test(trimmed)
    || /(AI(?:生成|思考|润色|输出|续写)中|作为AI|思考过程|修订建议|改写说明|本段需要|场景计划|must_cover|exit_hook|bridge_in|bridge_out)/u.test(trimmed)
    || /^【(?:分析|计划|备注|提示|输出要求|修订|优化说明)】/u.test(trimmed)
}

function cleanPlatformContent(content: string): { text: string; removedLineCount: number } {
  let removedLineCount = 0
  const kept = content
    .replace(/\r\n/g, '\n')
    .replace(/\u200b/g, '')
    .split('\n')
    .filter((line) => {
      if (!shouldDropPlatformLine(line)) return true
      removedLineCount += 1
      return false
    })
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: kept, removedLineCount }
}

function formatChapterTitle(chapter: ChapterRecord, platform: PlatformFormat): string {
  const title = chapter.title?.trim()
  const normalizedTitle = title && !/^第\s*\d+\s*章/u.test(title)
    ? ` ${title}`
    : title ? ` ${title.replace(/^第\s*\d+\s*章\s*/u, '').trim()}` : ''
  if (platform === 'fanqie' || platform === 'qidian' || platform === 'generic') {
    return `第${chapter.chapterNum}章${normalizedTitle}`.trim()
  }
  return `第 ${chapter.chapterNum} 章${normalizedTitle}`.trim()
}

function selectPlatformChapters(
  chapterList: ChapterRecord[],
  options: Required<Pick<PlatformFormatOptions, 'scope'>> & Pick<PlatformFormatOptions, 'chapterId' | 'chapterIds'>,
): ChapterRecord[] {
  if (options.scope === 'currentChapter') {
    return chapterList.filter((chapter) => chapter.id === options.chapterId)
  }
  if (options.scope === 'selectedChapters') {
    const ids = new Set((options.chapterIds || []).filter((id): id is number => typeof id === 'number'))
    return chapterList.filter((chapter) => ids.has(chapter.id))
  }
  return chapterList
}

const DEFAULT_PLATFORM_RISK_WORDS = [
  'AI生成',
  '思考过程',
  '修订建议',
  '加群',
  'QQ群',
  '微信',
  '支付宝',
  '银行卡',
  '身份证',
  'http',
  'www.',
]

function normalizePlatformBatchSize(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return Math.max(1, fallback)
  return Math.max(1, Math.min(Math.floor(numeric), 200))
}

function countOccurrences(text: string, token: string): number {
  if (!token) return 0
  let count = 0
  let index = text.indexOf(token)
  while (index !== -1) {
    count += 1
    index = text.indexOf(token, index + token.length)
  }
  return count
}

function collectSensitiveWordHits(
  selected: ChapterRecord[],
  cleanedByChapterId: Map<number, string>,
  rawWords?: string[],
): PlatformFormatResult['sensitiveWordHits'] {
  const words = [...new Set([
    ...DEFAULT_PLATFORM_RISK_WORDS,
    ...(rawWords || []),
  ].map((item) => item.trim()).filter(Boolean))]

  return words
    .map((word) => {
      let count = 0
      const chapterNums: number[] = []
      selected.forEach((chapter) => {
        const hits = countOccurrences(cleanedByChapterId.get(chapter.id) || '', word)
        if (hits > 0) {
          count += hits
          chapterNums.push(chapter.chapterNum)
        }
      })
      return { word, count, chapterNums }
    })
    .filter((item) => item.count > 0)
    .slice(0, 20)
}

function buildPlatformBatches(
  selected: ChapterRecord[],
  platform: PlatformFormat,
  cleanedByChapterId: Map<number, string>,
  batchSize: number,
): PlatformFormatBatch[] {
  const batches: PlatformFormatBatch[] = []
  for (let offset = 0; offset < selected.length; offset += batchSize) {
    const batchChapters = selected.slice(offset, offset + batchSize)
    const content = batchChapters.map((chapter) => [
      formatChapterTitle(chapter, platform),
      '',
      cleanedByChapterId.get(chapter.id) || '',
    ].join('\n')).join('\n\n')
    const chapterStart = batchChapters[0]?.chapterNum
    const chapterEnd = batchChapters[batchChapters.length - 1]?.chapterNum
    batches.push({
      index: batches.length + 1,
      title: chapterStart === chapterEnd ? `第${chapterStart}章` : `第${chapterStart}-${chapterEnd}章`,
      content,
      chapterCount: batchChapters.length,
      wordCount: countTextWords(content),
      chapterStart,
      chapterEnd,
    })
  }
  return batches
}

function parseOptionalJson(raw?: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function shouldUseSplitExport(novel: NovelRecord, chapterList: ChapterRecord[], volumeRows: VolumeRecord[]): boolean {
  const totalWords = Number(novel.totalWords || 0) || chapterList.reduce((sum, chapter) => sum + resolveChapterWordCount(chapter), 0)
  return totalWords >= LARGE_EXPORT_WORD_THRESHOLD
    || chapterList.length >= LARGE_EXPORT_CHAPTER_THRESHOLD
    || volumeRows.length > 1
}

function buildChunkTitle(baseTitle: string, chaptersInChunk: ChapterRecord[]): string {
  const first = chaptersInChunk[0]
  const last = chaptersInChunk[chaptersInChunk.length - 1]
  if (!first || !last) return baseTitle
  if (first.chapterNum === last.chapterNum) return `${baseTitle}（第${first.chapterNum}章）`
  return `${baseTitle}（第${first.chapterNum}-${last.chapterNum}章）`
}

function splitChunkGroup(
  chunkBaseId: string,
  chunkBaseTitle: string,
  chaptersInGroup: ChapterRecord[],
  volumeId?: number | null,
): ExportChunk[] {
  if (chaptersInGroup.length === 0) return []

  const totalWords = chaptersInGroup.reduce((sum, chapter) => sum + resolveChapterWordCount(chapter), 0)
  if (chaptersInGroup.length <= CHUNK_CHAPTER_LIMIT && totalWords <= CHUNK_WORD_LIMIT) {
    return [{
      id: chunkBaseId,
      title: chunkBaseTitle,
      fileStem: chunkBaseId,
      chapters: chaptersInGroup,
      chapterStart: chaptersInGroup[0].chapterNum,
      chapterEnd: chaptersInGroup[chaptersInGroup.length - 1].chapterNum,
      wordCount: totalWords,
      volumeId,
    }]
  }

  const chunks: ExportChunk[] = []
  let buffer: ChapterRecord[] = []
  let bufferedWords = 0
  let index = 1

  const flush = () => {
    if (buffer.length === 0) return
    const title = buildChunkTitle(chunkBaseTitle, buffer)
    chunks.push({
      id: `${chunkBaseId}-part-${String(index).padStart(2, '0')}`,
      title,
      fileStem: `${chunkBaseId}-part-${String(index).padStart(2, '0')}`,
      chapters: buffer,
      chapterStart: buffer[0].chapterNum,
      chapterEnd: buffer[buffer.length - 1].chapterNum,
      wordCount: bufferedWords,
      volumeId,
    })
    index += 1
    buffer = []
    bufferedWords = 0
  }

  for (const chapter of chaptersInGroup) {
    const chapterWords = resolveChapterWordCount(chapter)
    const exceedsLimit = buffer.length > 0
      && (buffer.length >= CHUNK_CHAPTER_LIMIT || bufferedWords + chapterWords > CHUNK_WORD_LIMIT)
    if (exceedsLimit) {
      flush()
    }
    buffer.push(chapter)
    bufferedWords += chapterWords
  }
  flush()

  return chunks
}

function buildExportChunks(chapterList: ChapterRecord[], volumeRows: VolumeRecord[]): ExportChunk[] {
  if (volumeRows.length === 0) {
    return splitChunkGroup('chapters', '章节导出', chapterList)
  }

  const chunks: ExportChunk[] = []
  const assignedChapterIds = new Set<number>()

  for (const volume of volumeRows) {
    const volumeChapters = chapterList.filter((chapter) => chapter.volumeId === volume.id)
    if (volumeChapters.length === 0) continue
    volumeChapters.forEach((chapter) => assignedChapterIds.add(chapter.id))
    chunks.push(...splitChunkGroup(
      `volume-${String(volume.volumeNumber).padStart(2, '0')}`,
      getVolumeLabel(volume),
      volumeChapters,
      volume.id,
    ))
  }

  const unassigned = chapterList.filter((chapter) => !assignedChapterIds.has(chapter.id))
  if (unassigned.length > 0) {
    chunks.push(...splitChunkGroup('unassigned-chapters', '未分卷章节', unassigned, null))
  }

  return chunks
}

async function writeStreamChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
  if (stream.write(chunk)) return
  await once(stream, 'drain')
}

async function withWriteStream(
  filePath: string,
  writer: (stream: fs.WriteStream) => Promise<void>,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(filePath, { encoding: 'utf8' })
    stream.on('error', reject)
    stream.on('finish', resolve)

    Promise.resolve(writer(stream))
      .then(() => stream.end())
      .catch((error) => stream.destroy(error instanceof Error ? error : new Error(String(error))))
  })
}

async function writeTxtExport(
  filePath: string,
  novel: NovelRecord,
  chapterList: ChapterRecord[],
  chunkTitle?: string,
): Promise<void> {
  await withWriteStream(filePath, async (stream) => {
    await writeStreamChunk(stream, `${novel.title}\n\n`)
    if (chunkTitle) {
      await writeStreamChunk(stream, `${chunkTitle}\n\n`)
    }
    if (novel.synopsis) {
      await writeStreamChunk(stream, `简介：${novel.synopsis}\n\n${'='.repeat(40)}\n\n`)
    }
    for (const chapter of chapterList) {
      await writeStreamChunk(stream, `第${chapter.chapterNum}章 ${chapter.title || ''}\n\n`)
      await writeStreamChunk(stream, `${chapter.content || ''}\n\n`)
      await writeStreamChunk(stream, `${'─'.repeat(20)}\n\n`)
    }
  })
}

async function writeMarkdownExport(
  filePath: string,
  novel: NovelRecord,
  chapterList: ChapterRecord[],
  chunkTitle?: string,
): Promise<void> {
  await withWriteStream(filePath, async (stream) => {
    await writeStreamChunk(stream, `# ${novel.title}\n\n`)
    if (chunkTitle) {
      await writeStreamChunk(stream, `## ${chunkTitle}\n\n`)
    }
    if (novel.synopsis) {
      await writeStreamChunk(stream, `> ${novel.synopsis}\n\n---\n\n`)
    }
    for (const chapter of chapterList) {
      await writeStreamChunk(stream, `## 第${chapter.chapterNum}章 ${chapter.title || ''}\n\n`)
      await writeStreamChunk(stream, `${chapter.content || ''}\n\n`)
    }
  })
}

async function writeJsonExport(
  filePath: string,
  novel: NovelRecord,
  chapterList: ChapterRecord[],
  chunkTitle?: string,
): Promise<void> {
  const novelMeta = {
    title: novel.title,
    synopsis: novel.synopsis,
    totalWords: novel.totalWords,
    status: novel.status,
    expandedBackground: novel.expandedBackground,
    settingsJson: parseOptionalJson(novel.settingsJson),
    worldRulesJson: parseOptionalJson(novel.worldRulesJson),
  }

  await withWriteStream(filePath, async (stream) => {
    await writeStreamChunk(stream, '{\n')
    await writeStreamChunk(stream, `  "novel": ${JSON.stringify(novelMeta)},\n`)
    if (chunkTitle) {
      await writeStreamChunk(stream, `  "chunkTitle": ${JSON.stringify(chunkTitle)},\n`)
    }
    await writeStreamChunk(stream, '  "chapters": [\n')
    for (let index = 0; index < chapterList.length; index += 1) {
      const chapter = chapterList[index]
      const payload = {
        chapterNum: chapter.chapterNum,
        title: chapter.title,
        content: chapter.content,
        wordCount: chapter.wordCount,
        outline: chapter.outline,
        summary: chapter.summary,
        status: chapter.status,
      }
      const suffix = index === chapterList.length - 1 ? '\n' : ',\n'
      await writeStreamChunk(stream, `    ${JSON.stringify(payload)}${suffix}`)
    }
    await writeStreamChunk(stream, '  ]\n')
    await writeStreamChunk(stream, '}\n')
  })
}

function buildDocxParagraphs(
  novel: NovelRecord,
  chapterList: ChapterRecord[],
  chunkTitle?: string,
): Paragraph[] {
  const docParagraphs: Paragraph[] = []

  docParagraphs.push(new Paragraph({
    text: novel.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }))

  if (chunkTitle) {
    docParagraphs.push(new Paragraph({
      text: chunkTitle,
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
      spacing: { after: 280 },
    }))
  }

  if (novel.synopsis) {
    docParagraphs.push(new Paragraph({
      children: [
        new TextRun({ text: '简介：', bold: true }),
        new TextRun(novel.synopsis),
      ],
      spacing: { after: 240 },
    }))
    docParagraphs.push(new Paragraph({ text: '', spacing: { after: 200 } }))
  }

  for (const chapter of chapterList) {
    docParagraphs.push(new Paragraph({
      text: `第${chapter.chapterNum}章 ${chapter.title || ''}`,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }))

    const paragraphs = (chapter.content || '').split(/\n+/).filter((paragraph) => paragraph.trim())
    for (const paragraph of paragraphs) {
      docParagraphs.push(new Paragraph({
        children: [new TextRun({ text: paragraph })],
        spacing: { after: 160 },
        indent: { firstLine: 480 },
      }))
    }
  }

  return docParagraphs
}

async function writeDocxExport(
  filePath: string,
  novel: NovelRecord,
  chapterList: ChapterRecord[],
  chunkTitle?: string,
): Promise<void> {
  const doc = new Document({
    sections: [{
      properties: {},
      children: buildDocxParagraphs(novel, chapterList, chunkTitle),
    }],
  })
  const buffer = await Packer.toBuffer(doc)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, buffer)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function writeEpubExport(
  filePath: string,
  novel: NovelRecord,
  chapterList: ChapterRecord[],
  chunkTitle?: string,
): Promise<void> {
  const { EPub } = await import('epub-gen-memory')

  const content = chapterList.map((chapter) => {
    const paragraphs = (chapter.content || '').split(/\n+/).filter((p) => p.trim())
    const htmlBody = paragraphs
      .map((p) => `<p style="text-indent: 2em;">${escapeHtml(p.trim())}</p>`)
      .join('\n')

    return {
      title: `第${chapter.chapterNum}章 ${chapter.title || ''}`,
      content: htmlBody,
    }
  })

  const options = {
    title: chunkTitle ? `${novel.title} - ${chunkTitle}` : novel.title,
    author: 'NovelForge',
    lang: 'zh-CN' as const,
    description: novel.synopsis || '',
  }

  const epubBuffer = await new EPub(options, content).genEpub()
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, epubBuffer)
}

async function writeChunkExport(
  filePath: string,
  format: ExportFormat,
  novel: NovelRecord,
  chunk: ExportChunk,
): Promise<void> {
  if (format === 'txt') {
    await writeTxtExport(filePath, novel, chunk.chapters, chunk.title)
    return
  }
  if (format === 'md') {
    await writeMarkdownExport(filePath, novel, chunk.chapters, chunk.title)
    return
  }
  if (format === 'json') {
    await writeJsonExport(filePath, novel, chunk.chapters, chunk.title)
    return
  }
  if (format === 'epub') {
    await writeEpubExport(filePath, novel, chunk.chapters, chunk.title)
    return
  }
  await writeDocxExport(filePath, novel, chunk.chapters, chunk.title)
}

async function writeSingleExport(
  filePath: string,
  format: ExportFormat,
  novel: NovelRecord,
  chapterList: ChapterRecord[],
): Promise<void> {
  if (format === 'txt') {
    await writeTxtExport(filePath, novel, chapterList)
    return
  }
  if (format === 'md') {
    await writeMarkdownExport(filePath, novel, chapterList)
    return
  }
  if (format === 'json') {
    await writeJsonExport(filePath, novel, chapterList)
    return
  }
  if (format === 'epub') {
    await writeEpubExport(filePath, novel, chapterList)
    return
  }
  await writeDocxExport(filePath, novel, chapterList)
}

async function createExportDirectory(baseDir: string, novelTitle: string, format: ExportFormat): Promise<string> {
  const exportName = sanitizeFileName(`${novelTitle}-${format}-export`, `novel-${format}-export`)
  let targetDir = path.join(baseDir, exportName)

  if (fs.existsSync(targetDir)) {
    targetDir = path.join(baseDir, `${exportName}-${Date.now()}`)
  }

  await fs.promises.mkdir(targetDir, { recursive: true })
  return targetDir
}

export async function exportNovel(novelId: number, format: ExportFormat): Promise<string> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const chapterList = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => chapter.content)

  const volumeRows = db.select().from(storyVolumes)
    .where(eq(storyVolumes.novelId, novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()

  const splitExport = shouldUseSplitExport(novel, chapterList, volumeRows)
  const defaultName = sanitizeFileName(novel.title, 'novel')

  if (!splitExport) {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), `${defaultName}.${format}`),
      filters: [{ name: format === 'epub' ? 'EPUB电子书' : format.toUpperCase(), extensions: [format] }],
    })

    if (!filePath) throwUserFacingError('common.userCancelled')
    await writeSingleExport(filePath, format, novel, chapterList)
    return filePath
  }

  const { filePaths } = await dialog.showOpenDialog({
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  })

  const selectedDir = filePaths[0]
  if (!selectedDir) throwUserFacingError('common.userCancelled')

  const outputDir = await createExportDirectory(selectedDir, defaultName, format)
  const chunks = buildExportChunks(chapterList, volumeRows)

  for (const chunk of chunks) {
    const outputPath = path.join(outputDir, `${chunk.fileStem}.${format}`)
    await writeChunkExport(outputPath, format, novel, chunk)
  }

  const manifest = {
    novel: {
      id: novel.id,
      title: novel.title,
      synopsis: novel.synopsis,
      totalWords: novel.totalWords,
      status: novel.status,
    },
    format,
    strategy: volumeRows.length > 0 ? 'volume-or-range' : 'chapter-range',
    generatedAt: new Date().toISOString(),
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      file: `${chunk.fileStem}.${format}`,
      chapterStart: chunk.chapterStart,
      chapterEnd: chunk.chapterEnd,
      wordCount: chunk.wordCount,
      volumeId: chunk.volumeId ?? null,
    })),
  }

  await fs.promises.writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  )

  return outputDir
}

export function formatNovelForPlatform(novelId: number, rawOptions: PlatformFormatOptions = {}): PlatformFormatResult {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const platform = normalizePlatform(rawOptions.platform)
  const scope = normalizePlatformScope(rawOptions.scope)
  const chapterList = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => chapter.content?.trim())
  const selected = selectPlatformChapters(chapterList, {
    scope,
    chapterId: rawOptions.chapterId,
    chapterIds: rawOptions.chapterIds,
  })

  if (selected.length === 0) {
    throwUserFacingError('chapter.contentEmpty')
  }

  let removedLineCount = 0
  const cleanedByChapterId = new Map<number, string>()
  const blocks = selected.map((chapter) => {
    const cleaned = cleanPlatformContent(chapter.content || '')
    removedLineCount += cleaned.removedLineCount
    cleanedByChapterId.set(chapter.id, cleaned.text)
    return [
      formatChapterTitle(chapter, platform),
      '',
      cleaned.text,
    ].join('\n')
  })
  const content = blocks.join('\n\n')
  const wordCount = countTextWords(content)
  const findings = collectQualityGuardrailFindings(content)
  const sensitiveWordHits = collectSensitiveWordHits(selected, cleanedByChapterId, rawOptions.sensitiveWords)
  const batchSize = normalizePlatformBatchSize(rawOptions.batchSize, selected.length)
  const batches = buildPlatformBatches(selected, platform, cleanedByChapterId, batchSize)
  const warnings = [
    removedLineCount > 0 ? `已清理 ${removedLineCount} 行 AI 过程/提示词残留。` : '',
    sensitiveWordHits.length > 0 ? `检测到 ${sensitiveWordHits.length} 类平台风险词，复制前建议人工复核。` : '',
    batches.length > 1 ? `已按每批 ${batchSize} 章生成 ${batches.length} 个平台分批包。` : '',
    ...findings
      .filter((finding) => finding.severity === 'high' || finding.code === 'prompt_leak' || finding.code === 'ai_process_leak')
      .slice(0, 5)
      .map((finding) => `${finding.message}${finding.excerpt ? `：${finding.excerpt}` : ''}`),
    platform === 'fanqie' ? '番茄格式已统一为“第N章 标题 + 正文空行”。敏感词库仍需发布前人工复核。' : '',
    platform === 'feilu' ? '飞卢格式已统一为“第 N 章 标题 + 正文空行”。新书阶段仍需人工确认更新节奏与平台规则。' : '',
  ].filter(Boolean)

  return {
    platform,
    scope,
    title: novel.title,
    content,
    chapterCount: selected.length,
    wordCount,
    warnings,
    removedLineCount,
    sensitiveWordHits,
    batches,
  }
}
