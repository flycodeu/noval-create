import { getNovel } from './novel.service'
import { listChapters } from './chapter.service'
import { getChapterContract, listSceneContracts } from './endgame-asset.service'
import { queryStoryAtlas } from './story-atlas.service'
import { getSqlite } from '../database/db'
import { parseStorySettingsDocument } from '../../src/shared/story-settings'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import type { CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import type { StoryAtlasValidationResult } from '../../src/shared/story-atlas'

export interface CreativeHistoryChange { path: string; fieldKey: string; before: unknown; after: unknown }
export function projectPatch(current: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return current ?? null
  const source = current && typeof current === 'object' ? current as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, projectPatch(source[key], value)]))
}
const json = (raw: string | null | undefined) => { try { return JSON.parse(raw || '{}') } catch { return null } }
/** Freeze only fields touched by this candidate while the generation context is still current. */
export function captureCreativeHistory(input: CreativeWorkflowInput, data: Record<string, unknown>, resolution?: StoryAtlasValidationResult, savedIds?: Record<string, string>): CreativeHistoryChange[] {
  const novel = getNovel(input.novelId)!
  let atlasChanges: CreativeHistoryChange[] = []
  if (Array.isArray(data.changes) && data.changes.length) {
    const atlas = queryStoryAtlas({ novelId: input.novelId, atChapter: input.atChapter, includePlanned: true })
    atlasChanges = data.changes.map((value, index) => {
      const patch = { ...value } as Record<string, unknown>; delete patch.op; delete patch.clientId
      const resolved = resolution?.resolvedChanges.find(change => change.index === index)
      const records = [...atlas.entities, ...atlas.relations]
      const savedId = savedIds && (savedIds[String(value.clientId)] || value.id)
      const existing = records.find(record => record.id === (savedId || resolved?.id)) || (savedIds ? records.find(record => {
        if (value.op === 'upsert_entity' && 'name' in record) return record.kind === value.kind && record.name === value.name && (!['location', 'faction'].includes(record.kind) || record.parentId === (savedIds[String(value.parentId)] || value.parentId || null))
        if (value.op === 'upsert_relation' && 'fromId' in record) return record.kind === value.kind && record.fromId === (savedIds[String(value.fromId)] || value.fromId) && record.toId === (savedIds[String(value.toId)] || value.toId)
        return false
      }) : undefined)
      if (value.op === 'retire') return { path: existing && ('name' in existing ? existing.name : existing.label) || String(value.id), fieldKey: '', before: existing || null, after: { retired: true } }
      // Newly allocated IDs are not saved yet; clientId belongs to the request, not the old record.
      delete patch.id
      return { path: String(patch.name || patch.label || '关系'), fieldKey: '', before: existing ? projectPatch(existing, patch) : null, after: patch }
    })
    if (input.stage !== 'chapter') return atlasChanges
  }
  if (input.stage === 'outline') {
    const chapters = listChapters(input.novelId)
    const changes: CreativeHistoryChange[] = []
    for (const value of (data.volumes || []) as Array<Record<string, unknown>>) {
      const { parts, clientId: _clientId, ...patch } = value
      const before = value.id ? getSqlite().prepare('SELECT id,title,summary,target_words AS targetWords FROM story_volumes WHERE novel_id=? AND id=?').get(input.novelId, value.id)
        : savedIds ? getSqlite().prepare('SELECT id,title,summary,target_words AS targetWords FROM story_volumes WHERE novel_id=? AND title=?').get(input.novelId, value.title) : null
      changes.push({ path: String(value.title), fieldKey: '', before: before ? projectPatch(before, patch) : null, after: patch })
      for (const part of (parts || []) as Array<Record<string, unknown>>) {
        const { clientId: _partClient, ...partPatch } = part
        const original = part.id ? getSqlite().prepare('SELECT id,title,summary,target_words AS targetWords FROM story_parts WHERE novel_id=? AND id=?').get(input.novelId, part.id)
          : savedIds && before ? getSqlite().prepare('SELECT id,title,summary,target_words AS targetWords FROM story_parts WHERE novel_id=? AND volume_id=? AND title=?').get(input.novelId, (before as { id: number }).id, part.title) : null
        changes.push({ path: String(part.title), fieldKey: '', before: original ? projectPatch(original, partPatch) : null, after: partPatch })
      }
    }
    for (const patch of (data.chapters || []) as Array<Record<string, unknown>>) {
      const chapter = chapters.find(row => row.id === patch.id || Boolean(savedIds) && row.chapterNum === patch.chapterNum)
      const before = chapter ? { ...chapter, chapterContract: getChapterContract(chapter.id), scenes: listSceneContracts(chapter.id), allowedFactIds: json(chapter.allowedFactIdsJson), revealedFactIds: json(chapter.revealedFactIdsJson) } : null
      changes.push({ path: `第 ${patch.chapterNum} 章 · ${patch.title}`, fieldKey: '', before: before ? projectPatch(before, patch) : null, after: patch })
    }
    return changes
  }
  const chapter = listChapters(input.novelId).find(row => row.chapterNum === data.chapterNum)
  const story = parseStorySettingsDocument(novel.settingsJson)
  const current = { ...story, themeVoice: parseThemeVoiceDocument(novel.themeVoiceJson), worldRules: json(novel.worldRulesJson), projectBrief: json(novel.projectBriefJson), userBackground: novel.userBackground, expandedBackground: novel.expandedBackground, synopsis: novel.synopsis, title: chapter?.title, content: chapter?.content, summary: chapter?.summary, chapterNum: chapter?.chapterNum }
  return [...Object.entries(data).filter(([key]) => !['changes', 'factReveals'].includes(key)).map(([key, after]) => ({ path: key, fieldKey: key, before: projectPatch((current as Record<string, unknown>)[key], after), after })), ...atlasChanges]
}
