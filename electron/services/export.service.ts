import { once } from 'events'
import fs from 'fs'
import path from 'path'
import { dialog, app } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx'
import { getDb } from '../database/db'
import { chapters, novels, storyVolumes } from '../database/schema'

type ExportFormat = 'txt' | 'md' | 'json' | 'docx' | 'epub'
type ChapterRecord = typeof chapters.$inferSelect
type NovelRecord = typeof novels.$inferSelect
type VolumeRecord = typeof storyVolumes.$inferSelect

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
  const EPub = (await import('epub-gen-memory')).default

  const content = chapterList.map((chapter) => {
    const paragraphs = (chapter.content || '').split(/\n+/).filter((p) => p.trim())
    const htmlBody = paragraphs
      .map((p) => `<p style="text-indent: 2em;">${escapeHtml(p.trim())}</p>`)
      .join('\n')

    return {
      title: `第${chapter.chapterNum}章 ${chapter.title || ''}`,
      data: htmlBody,
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
  if (!novel) throw new Error('小说不存在')

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

    if (!filePath) throw new Error('用户取消')
    await writeSingleExport(filePath, format, novel, chapterList)
    return filePath
  }

  const { filePaths } = await dialog.showOpenDialog({
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  })

  const selectedDir = filePaths[0]
  if (!selectedDir) throw new Error('用户取消')

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
