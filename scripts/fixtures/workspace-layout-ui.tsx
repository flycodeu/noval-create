import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
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
const chapters: any[] = [
  { id: 682, novelId: 292, chapterNum: 1, title: '灯下有人', content: '她把灯芯拨正。夜风擦过窗纸。', summary: '她整理灯芯。', outline: '灯下的初见安排。', wordCount: 14, status: 'draft', targetWords: 3000 },
  { id: 683, novelId: 292, chapterNum: 2, title: '旧物未寒', content: '', summary: '', outline: '空白章节的完整安排。', wordCount: 0, status: 'outline', targetWords: 3000 },
]
const entities: any[] = [
  ...Array.from({ length: 25 }, (_, index) => ({ id: `character:${314 + index}`, nativeId: 314 + index, kind: 'character', name: index === 0 ? '阿烛' : `隔离人物${index}`, summary: index === 0 ? '未来人形的内部规划内容。' : '用于分页验收的人物。', status: index > 0 && index < 3 ? 'planned' : 'confirmed', parentId: null, attributes: index === 0 ? { publicSummary: '她仍是灯边的精灯蛾，有自己的判断。', appearance: '人形时乌发，眉眼清楚。', clothing: '青灰旧衫。', carriedItems: '自己的行路灯。', physicalHabits: '会先拨正灯芯。', abilities: '能辨灯火的明暗。', authorPlanning: { formRules: '成年女性人形与蛾形共用伤势。', livelihood: '修灯挣路费。' }, portraitImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL8AAAAASUVORK5CYII=', portraitPrompt: '成年女性，青灰旧衫。' } : index === 4 ? {} : { publicSummary: '用于布局验收的公开人物资料。' }, effectiveFromChapter: index > 0 && index < 3 ? 7 : 0, updatedAt: stamp })),
  { id: 'location:1', nativeId: 1, kind: 'location', name: '旧灯巷', summary: '初见的街巷。', status: 'confirmed', parentId: null, attributes: {}, effectiveFromChapter: 0 },
  { id: 'event:1', nativeId: 1, kind: 'event', name: '灯下初见', summary: '她整理了灯芯。', status: 'confirmed', parentId: null, attributes: { chapterNum: 1, eventTime: '初夜', eventResult: '灯火稳定。' }, effectiveFromChapter: 1 },
]
const sources: any[] = Array.from({ length: 7 }, (_, i) => ({ sourceKey: `source-${i}`, title: `隔离资料来源 ${i}`, url: `https://example.org/reference/${i}`, excerpt: '服饰与灯具的来源摘要，仅用于界面验收，仍须核对本书设定。', topics: ['行旅生活'], query: '行旅灯具', recordedAt: stamp, verificationStatus: 'web_found', canonDecision: 'reference_only' }))
const issues: any[] = Array.from({ length: 25 }, (_, i) => ({ id: 900 + i, novelId: 292, chapterId: 682, title: `隔离问题${i + 1}`, description: '用于问题定位分页的隔离记录。', severity: 'medium', status: 'open', originMetaJson: '{}', createdAt: stamp, updatedAt: stamp }))
let run: any = null
const runs: any[] = []
const artifacts: any[] = []
win.calls = []
win.unexpected = []
win.fixture = { novel, chapters, entities, sources, artifacts, runs, issues }
const record = (kind: string, input: unknown) => win.calls.push({ kind, input: clone(input) })
const empty = async () => []
win.electron = {
  on: () => () => {}, off: () => {},
  app: { getRuntimeInfo: async () => ({ environment: 'test', source: 'source', version: 'layout-fixture', executable: 'isolated-electron', dataDirectory: 'isolated-ui-fixture' }) },
  windowControls: { minimize: async () => {}, toggleMaximize: async () => false, isMaximized: async () => false, onMaximizedStateChange: () => () => {}, onCloseRequested: () => () => {}, close: async () => {}, confirmClose: async () => {} },
  novel: { list: async () => [clone(novel)], get: async () => clone(novel), update: async (_id: number, patch: object, options?: { expectedContextVersion?: number }) => { if (options?.expectedContextVersion !== undefined && options.expectedContextVersion !== novel.contextVersion) throw Error('作品已被其他任务修改'); record('novel.update', patch); record('novel.update-options', { options, atVersion: novel.contextVersion }); Object.assign(novel, clone(patch)); novel.contextVersion += 1; return clone(novel) } },
  model: { list: async () => [{ id: 1, name: '隔离模型', modelId: 'fixture', isDefault: 1 }] },
  chapter: {
    list: async () => clone(chapters), get: async (id: number) => clone(chapters.find(c => c.id === id)), listVersions: async () => [],
    update: async (id: number, patch: any, options: any) => { const chapter = chapters.find(c => c.id === id); if (options?.expectedContent !== undefined && options.expectedContent !== chapter.content) throw Error('隔离版本已变化'); record('chapter.update', { id, patch, options }); Object.assign(chapter, clone(patch)); return clone(chapter) },
    create: async (_id: number, input: any) => { const created = { id: 684, novelId: 292, content: '', outline: '', summary: '', wordCount: 0, ...input }; chapters.push(created); record('chapter.create', input); return created.id },
  },
  storyAtlas: {
    query: async (input: any) => { record('atlas.query', input); return { novelId: 292, contextVersion: novel.contextVersion, entities: clone(entities.filter(e => input.includePlanned || e.status !== 'planned')), relations: [], diagnostics: [], atChapter: input.atChapter ?? null } },
    apply: async (input: any) => { record('atlas.apply', input); if (input.expectedContextVersion !== novel.contextVersion) throw Error('隔离资料版本已变化'); for (const change of input.changes) { const current = entities.find(e => e.id === change.id); if (current) Object.assign(current, clone(change), { attributes: change.attributeMode === 'replace' ? clone(change.attributes) : { ...current.attributes, ...clone(change.attributes) } }) } novel.contextVersion += 1; return { contextVersion: novel.contextVersion, idMap: {}, appliedIds: input.changes.map((c: any) => c.id) } },
  },
  character: { list: async () => entities.filter(e => e.kind === 'character').map(e => ({ id: e.nativeId, fullName: e.name })) },
  storyFact: { list: empty }, foreshadow: { listLedger: empty }, thread: { list: empty },
  characterArc: { listCharacterArcs: empty, listRelationshipArcs: empty }, resistance: { listTracks: empty }, endgameAsset: { listCommitments: empty },
  revision: { list: async () => clone(issues) }, structure: { getTree: async () => ({ volumes: [], unassignedChapters: clone(chapters) }) },
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
      case 'novelforge.workflows.get': data = { run: clone(input.runId ? runs.find(item => item.runId === input.runId) || null : run) }; break
      case 'novelforge.workflows.list': data = { runs: clone(runs) }; break
      case 'novelforge.artifacts.list': data = { artifacts: clone(artifacts.filter(a => !input.kind || a.kind === input.kind)) }; break
      case 'novelforge.artifacts.get': data = { artifact: clone(artifacts.find(a => a.id === input.artifactId)) }; break
      case 'novelforge.assets.query': data = { facts: [], assets: [] }; break
      case 'novelforge.chapters.index_status': data = { novelId: 292, savedChapterCount: 1, keywordIndexedChapterCount: 1, vectorIndexedChapterCount: 0, queue: { pending: 0, processing: 0, failed: 0, dead_letter: 0 }, errors: [] }; break
      case 'novelforge.chapters.readiness': data = { ready: false, chapterId: 683, blockers: ['隔离合同尚未补齐'] }; break
      case 'novelforge.workflows.start':
        run = { ...clone(input), runId: (run?.runId || 0) + 1, novelId: 292, stage: input.stage, atChapter: input.atChapter ?? 0, status: 'paused', step: 'needs_attention', reviewStatus: 'passed', artifactId: 'candidate-' + (artifacts.length + 1), reviewArtifactId: 'review-' + (artifacts.length + 1), operation: 'generate', input: clone(input), events: [], result: {}, createdAt: stamp, updatedAt: stamp }
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
