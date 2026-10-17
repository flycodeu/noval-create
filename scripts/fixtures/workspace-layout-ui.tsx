import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import { useNovelStore } from '../../src/stores/novel.store'
import '../../src/styles/global.css'
import '../../src/styles/ui-simplification.css'

// Deliberately isolated, deterministic UI fixture. These services are not a
// provider integration test and never read the author's NovelForge profile.
const win = window as any
const clone = (value: unknown) => structuredClone(value)
const stamp = '2026-10-17T00:00:00.000Z'
const novel: any = {
  id: 292, title: '布局隔离验收', contextVersion: 181, totalWords: 14,
  description: '只用于布局验收的隔离作品。', background: '城中以灯火辨认夜路。',
  modelConfigId: 1, settingsJson: '{}', projectBriefJson: '{}', themeVoiceJson: '{}',
  worldRulesJson: JSON.stringify({ worldSummary: '灯火有度，人情有价。', genreProfile: '灯火有度，人情有价。', speciesSystem: '形态切换共用伤势与疲惫。', extensionSentinel: { preserve: '已有扩展字段必须保留' } }),
}
const otherNovel: any = { ...clone(novel), id: 293, title: '另一部隔离作品', contextVersion: 11, totalWords: 0 }
const novels = [novel, otherNovel]
const chapters: any[] = [
  { id: 682, novelId: 292, chapterNum: 1, title: '灯下有人', content: '她把灯芯拨正。夜风擦过窗纸。', summary: '她整理灯芯。', outline: '灯下的初见安排。', wordCount: 14, status: 'draft', targetWords: 3000 },
  { id: 683, novelId: 292, chapterNum: 2, title: '旧物未寒', content: '', summary: '', outline: '空白章节的完整安排。', wordCount: 0, status: 'outline', targetWords: 3000 },
]
const entities: any[] = [
  ...Array.from({ length: 25 }, (_, index) => ({ id: `character:${314 + index}`, nativeId: 314 + index, kind: 'character', name: index === 0 ? '阿烛' : `隔离人物${index}`, summary: index === 0 ? '未来人形的内部规划内容。' : '用于分页验收的人物。', status: index > 0 && index < 3 ? 'planned' : 'confirmed', parentId: null, attributes: index === 0 ? { publicSummary: '她仍是灯边的精灯蛾，有自己的判断。', appearance: '人形时乌发，眉眼清楚。', clothing: '青灰旧衫。', carriedItems: '自己的行路灯。', physicalHabits: '会先拨正灯芯。', abilities: '能辨灯火的明暗。', authorPlanning: { formRules: '成年女性人形与蛾形共用伤势。', livelihood: '修灯挣路费。' }, portraitImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL8AAAAASUVORK5CYII=', portraitPrompt: '成年女性，青灰旧衫。' } : index === 4 ? {} : { publicSummary: '用于布局验收的公开人物资料。' }, effectiveFromChapter: index > 0 && index < 3 ? 7 : 0, updatedAt: stamp })),
  { id: 'location:1', nativeId: 1, kind: 'location', name: '旧灯巷', summary: '初见的街巷。', status: 'confirmed', parentId: null, attributes: {}, effectiveFromChapter: 0 },
  { id: 'event:1', nativeId: 1, kind: 'event', name: '灯下初见', summary: '她整理了灯芯。', status: 'confirmed', parentId: null, attributes: { chapterNum: 1, eventTime: '初夜', eventResult: '灯火稳定。', authorOnly: true, eventType: '历史事件', status: 'written' }, effectiveFromChapter: 1 },
  // Like the real book's author plans, these share a registration chapter but
  // deliberately do not claim to happen in that chapter or enter reader canon.
  ...Array.from({ length: 25 }, (_, i) => ({ id: `event:${100 + i}`, nativeId: 100 + i, kind: 'event', name: `第 ${i + 1} 卷时间规划`, summary: `卷级规划摘要 ${i + 1}。`, status: 'planned', parentId: null, effectiveFromChapter: 7, attributes: { chapterNum: 7, authorOnly: true, doesNotRepresentReaderKnowledge: true, eventType: '作者卷级时间规划', plannedVolume: i + 1, eventCause: i === 24 ? '检索因果哨兵。' : '仅规划登记，不代表发生在第七章。', eventProcess: `卷级规划完整经过 ${i + 1}。`, eventResult: `卷级规划完整结果 ${i + 1}。`, ...(i === 24 ? { chapterStartId: 688, chapterEndId: 683, lastProgressChapterId: 682 } : i === 23 ? { chapterStartId: 688, chapterEndId: 999999 } : {}) } })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `event:${201 + i}`, nativeId: 201 + i, kind: 'event', name: `隔离单元规划 ${i + 1}`, summary: '单元级作者规划。', status: 'planned', parentId: null, effectiveFromChapter: 7, attributes: { chapterNum: 7, authorOnly: true, eventType: '叙事单元规划' } })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `event:${301 + i}`, nativeId: 301 + i, kind: 'event', name: `隔离纪年规划 ${i + 1}`, summary: '背景纪年作者规划。', status: 'planned', parentId: null, effectiveFromChapter: 7, attributes: { chapterNum: 7, authorOnly: true, eventType: '作者年龄纪年规划', calendarEra: '明乐', calendarYear: 100 + i } })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `event:${401 + i}`, nativeId: 401 + i, kind: 'event', name: `第七章行动 ${i + 1}`, summary: `本章计划事件 ${i + 1}。`, status: i === 0 ? 'confirmed' : 'planned', parentId: null, effectiveFromChapter: 7, attributes: { chapterNum: 7, timeLabel: '开篇后第三日', relativeDay: 2, sequenceInDay: i, presentCharacterIds: [314], locationMapId: 1, eventCause: '依据现有线索。', eventProcess: '隔离事件完整经过。', eventResult: '结果待写。' } })),
  { id: 'event:501', nativeId: 501, kind: 'event', name: '尚未定位的旧事', summary: '没有章位的隔离记录。', status: 'confirmed', parentId: null, effectiveFromChapter: 0, attributes: {} },
]
const sources: any[] = Array.from({ length: 7 }, (_, i) => ({ sourceKey: `source-${i}`, title: `隔离资料来源 ${i}`, url: `https://example.org/reference/${i}`, excerpt: '服饰与灯具的来源摘要，仅用于界面验收，仍须核对本书设定。', topics: ['行旅生活'], query: '行旅灯具', recordedAt: stamp, verificationStatus: 'web_found', canonDecision: 'reference_only' }))
const issues: any[] = Array.from({ length: 25 }, (_, i) => ({ id: 900 + i, novelId: 292, chapterId: 682, title: `隔离问题${i + 1}`, description: '用于问题定位分页的隔离记录。', severity: 'medium', status: 'open', originMetaJson: '{}', createdAt: stamp, updatedAt: stamp }))
let run: any = null
const runs: any[] = []
const artifacts: any[] = []
// Controllable service timing lets the real form demonstrate its pending and
// active task states without invoking any model or writing author data.
const controls: any = {
  models: [{ id: 1, name: '隔离模型', modelId: 'fixture', isDefault: 1 }],
  readiness: { ready: false, chapterId: 683, blockers: ['隔离合同尚未补齐'] },
  holdStart: false, releaseStart: null, nextRunState: null,
  holdNovelUpdate: false, releaseNovelUpdate: null,
}
win.calls = []
win.unexpected = []
win.fixture = { novel, otherNovel, chapters, entities, sources, artifacts, runs, issues, controls, currentNovelId: () => useNovelStore.getState().currentNovel?.id }
const record = (kind: string, input: unknown) => win.calls.push({ kind, input: clone(input) })
const empty = async () => []
win.electron = {
  on: () => () => {}, off: () => {},
  app: { getRuntimeInfo: async () => ({ environment: 'test', source: 'source', version: 'layout-fixture', executable: 'isolated-electron', dataDirectory: 'isolated-ui-fixture' }) },
  windowControls: { minimize: async () => {}, toggleMaximize: async () => false, isMaximized: async () => false, onMaximizedStateChange: () => () => {}, onCloseRequested: () => () => {}, close: async () => {}, confirmClose: async () => {} },
  novel: {
    list: async () => clone(novels), get: async (id: number) => { record('novel.get', { id }); return clone(novels.find(item => item.id === id) || null) },
    update: async (id: number, patch: object, options?: { expectedContextVersion?: number }) => {
      const target = novels.find(item => item.id === id)
      if (!target) throw Error('隔离作品不存在')
      if (options?.expectedContextVersion !== undefined && options.expectedContextVersion !== target.contextVersion) throw Error('作品已被其他任务修改')
      record('novel.update', patch); record('novel.update-options', { options, atVersion: target.contextVersion }); record('novel.update-target', { id, patch })
      if (controls.holdNovelUpdate) await new Promise<void>(resolve => { controls.releaseNovelUpdate = () => { controls.holdNovelUpdate = false; controls.releaseNovelUpdate = null; resolve() } })
      Object.assign(target, clone(patch)); target.contextVersion += 1; return clone(target)
    },
  },
  model: { list: async () => clone(controls.models) },
  chapter: {
    list: async (id: number) => clone(chapters.filter(chapter => chapter.novelId === id)), get: async (id: number) => clone(chapters.find(c => c.id === id)), listVersions: async () => [],
    update: async (id: number, patch: any, options: any) => { const chapter = chapters.find(c => c.id === id); if (options?.expectedContent !== undefined && options.expectedContent !== chapter.content) throw Error('隔离版本已变化'); record('chapter.update', { id, patch, options }); Object.assign(chapter, clone(patch)); return clone(chapter) },
    create: async (_id: number, input: any) => { const created = { id: 684, novelId: 292, content: '', outline: '', summary: '', wordCount: 0, ...input }; chapters.push(created); record('chapter.create', input); return created.id },
  },
  storyAtlas: {
    query: async (input: any) => { record('atlas.query', input); return { novelId: input.novelId, contextVersion: novels.find(item => item.id === input.novelId)?.contextVersion, entities: input.novelId === 292 ? clone(entities.filter(e => input.includePlanned || e.status !== 'planned')) : [], relations: [], diagnostics: [], atChapter: input.atChapter ?? null } },
    apply: async (input: any) => { record('atlas.apply', input); if (input.expectedContextVersion !== novel.contextVersion) throw Error('隔离资料版本已变化'); for (const change of input.changes) { const current = entities.find(e => e.id === change.id); if (current) Object.assign(current, clone(change), { attributes: change.attributeMode === 'replace' ? clone(change.attributes) : { ...current.attributes, ...clone(change.attributes) } }) } novel.contextVersion += 1; return { contextVersion: novel.contextVersion, idMap: {}, appliedIds: input.changes.map((c: any) => c.id) } },
  },
  character: { list: async () => entities.filter(e => e.kind === 'character').map(e => ({ id: e.nativeId, fullName: e.name })) },
  storyFact: { list: empty }, foreshadow: { listLedger: empty }, thread: { list: empty },
  characterArc: { listCharacterArcs: empty, listRelationshipArcs: empty }, resistance: { listTracks: empty }, endgameAsset: { listCommitments: empty },
  revision: { list: async (id: number) => clone(issues.filter(issue => issue.novelId === id)) }, structure: { getTree: async (id: number) => ({ volumes: [], unassignedChapters: clone(chapters.filter(chapter => chapter.novelId === id)) }) },
  contract: { getChapter: async () => null, listScenes: empty, upsertChapter: async (_id: number, input: any) => { record('contract.upsertChapter', input); return input }, upsertScene: async (_id: number, _segment: unknown, input: any) => { record('contract.upsertScene', input); return input } },
  writeback: { getCenterData: async () => ({ diffs: [], activeRun: null }) },
  zhuque: { getChapterResult: async () => ({ enabled: false, autoDetect: false, apiKeySet: false, status: 'not_checked' }) },
  sourceSearch: {
    listResearch: async () => clone(sources), research: async (_id: number, request: string) => { record('research.search', request); sources.unshift({ ...sources[0], sourceKey: 'new-source', title: '新保存的隔离参考来源' }); return { diagnostics: ['隔离检索服务返回，来源已保存；未调用真实搜索服务。'] } },
  },
  agentTools: { call: async ({ toolId, input }: any) => {
    record(toolId, input)
    let data: any
    switch (toolId) {
      case 'novelforge.workflows.get': data = { run: clone(input.novelId === 293 ? null : input.runId ? runs.find(item => item.runId === input.runId) || null : run) }; break
      case 'novelforge.workflows.list': data = { runs: clone(runs) }; break
      case 'novelforge.artifacts.list': data = { artifacts: clone(artifacts.filter(a => !input.kind || a.kind === input.kind)) }; break
      case 'novelforge.artifacts.get': data = { artifact: clone(artifacts.find(a => a.id === input.artifactId)) }; break
      case 'novelforge.assets.query': data = { facts: [], assets: [] }; break
      case 'novelforge.chapters.index_status': data = { novelId: input.novelId, savedChapterCount: input.novelId === 293 ? 0 : 1, keywordIndexedChapterCount: input.novelId === 293 ? 0 : 1, vectorIndexedChapterCount: 0, queue: { pending: 0, processing: 0, failed: 0, dead_letter: 0 }, errors: [] }; break
      case 'novelforge.chapters.readiness': data = clone(controls.readiness); break
      case 'novelforge.workflows.start':
        if (controls.holdStart) await new Promise<void>(resolve => { controls.releaseStart = () => { controls.holdStart = false; controls.releaseStart = null; resolve() } })
        run = { ...clone(input), runId: (run?.runId || 0) + 1, novelId: 292, stage: input.stage, atChapter: input.atChapter ?? 0, status: 'paused', step: 'needs_attention', ...clone(controls.nextRunState || {}), reviewStatus: 'passed', artifactId: 'candidate-' + (artifacts.length + 1), reviewArtifactId: 'review-' + (artifacts.length + 1), operation: 'generate', input: clone(input), events: [], result: {}, createdAt: stamp, updatedAt: stamp }
        controls.nextRunState = null
        runs.push(run)
        artifacts.push({ id: run.artifactId, novelId: 292, kind: 'generic_draft', status: 'reviewed', reviewArtifactId: run.reviewArtifactId, content: { output: input.stage === 'chapter' ? { title: '灯下有人', content: '候选正文仍由用户确认。' } : { changes: [{ op: 'upsert_entity', id: 'character:314', kind: 'character', name: '阿烛', summary: '隔离候选的独立修订。' }] } }, createdAt: stamp })
        artifacts.push({ id: run.reviewArtifactId, novelId: 292, kind: 'quality_report', status: 'reviewed', content: { passed: true, summary: '隔离评审通过。', issues: [] }, createdAt: stamp })
        data = { run: clone(run) }; break
      case 'novelforge.workflows.apply':
        record('candidate.apply', input); Object.assign(run, { status: 'completed', step: 'completed', result: { appliedIds: ['character:314'] }, updatedAt: stamp + '1' }); artifacts.find(a => a.id === run.artifactId).status = 'committed'; entities[0].summary = '隔离候选的独立修订。'; data = { run: clone(run) }; break
      default: win.unexpected.push(toolId); throw Error('Unimplemented isolated service: ' + toolId)
    }
    return { ok: true, data }
  } },
}
location.hash = '/novels/292/guide'
document.documentElement.dataset.theme = 'light'
createRoot(document.getElementById('root')!).render(<App />)
