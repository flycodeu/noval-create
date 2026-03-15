import { getDb } from '../database/db'
import { novels, chapters } from '../database/schema'
import { eq, asc } from 'drizzle-orm'
import { dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType
} from 'docx'

export async function exportNovel(novelId: number, format: 'txt' | 'md' | 'json' | 'docx'): Promise<string> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const chapterList = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter(c => c.content)

  const { filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('documents'), `${novel.title}.${format}`),
    filters: [
      { name: format.toUpperCase(), extensions: [format] },
    ],
  })

  if (!filePath) throw new Error('用户取消')

  if (format === 'txt') {
    let content = `${novel.title}\n\n`
    if (novel.synopsis) content += `简介：${novel.synopsis}\n\n${'='.repeat(40)}\n\n`
    for (const ch of chapterList) {
      content += `第${ch.chapterNum}章 ${ch.title || ''}\n\n`
      content += `${ch.content}\n\n`
      content += `${'─'.repeat(20)}\n\n`
    }
    fs.writeFileSync(filePath, content, 'utf-8')
  } else if (format === 'md') {
    let content = `# ${novel.title}\n\n`
    if (novel.synopsis) content += `> ${novel.synopsis}\n\n---\n\n`
    for (const ch of chapterList) {
      content += `## 第${ch.chapterNum}章 ${ch.title || ''}\n\n`
      content += `${ch.content}\n\n`
    }
    fs.writeFileSync(filePath, content, 'utf-8')
  } else if (format === 'json') {
    const content = JSON.stringify({
      novel: {
        title: novel.title,
        synopsis: novel.synopsis,
        totalWords: novel.totalWords,
        status: novel.status,
        expandedBackground: novel.expandedBackground,
        settingsJson: novel.settingsJson ? JSON.parse(novel.settingsJson) : null,
        worldRulesJson: novel.worldRulesJson ? JSON.parse(novel.worldRulesJson) : null,
      },
      chapters: chapterList.map(ch => ({
        chapterNum: ch.chapterNum,
        title: ch.title,
        content: ch.content,
        wordCount: ch.wordCount,
        outline: ch.outline,
        summary: ch.summary,
        status: ch.status,
      })),
    }, null, 2)
    fs.writeFileSync(filePath, content, 'utf-8')
  } else if (format === 'docx') {
    const docParagraphs: Paragraph[] = []

    // 书名
    docParagraphs.push(new Paragraph({
      text: novel.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }))

    // 简介
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

    // 各章节
    for (const ch of chapterList) {
      docParagraphs.push(new Paragraph({
        text: `第${ch.chapterNum}章 ${ch.title || ''}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }))

      if (ch.content) {
        const paragraphs = ch.content.split(/\n+/).filter(p => p.trim())
        for (const para of paragraphs) {
          docParagraphs.push(new Paragraph({
            children: [new TextRun({ text: para })],
            spacing: { after: 160 },
            indent: { firstLine: 480 },
          }))
        }
      }
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: docParagraphs,
      }],
    })

    const buffer = await Packer.toBuffer(doc)
    fs.writeFileSync(filePath, buffer)
  }

  return filePath
}
