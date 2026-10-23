import React, { act, useLayoutEffect } from 'react'
import type { Root } from 'react-dom/client'
import { Form, Input } from 'antd'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import WorkspaceChatAssistant from '../../src/pages/Novel/components/WorkspaceChatAssistant'
import WorkspaceAIQualityBoard from '../../src/pages/Novel/components/WorkspaceAIQualityBoard'
import Versions from '../../src/pages/Novel/AuthorWorkspace/Versions'
import Contracts from '../../src/pages/Novel/Contracts'
import { useTimelineWorkspace } from '../../src/pages/Novel/Timeline/useTimelineWorkspace'
import { useNovelStore } from '../../src/stores/novel.store'

function check(value: unknown, description: string): asserts value { if (!value) throw new Error(description) }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const text = () => document.body.textContent || ''
const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.replace(/\s/g, '') === label)
async function click(element: Element | undefined | null) { check(element, 'lifecycle click target exists'); await act(async () => { (element as HTMLElement).click() }) }
async function type(field: HTMLInputElement | HTMLTextAreaElement | undefined | null, value: string) {
  check(field, 'lifecycle input target exists')
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const novel = (id = 1) => ({ id, title: 'lifecycle novel ' + id, genreName: '都市', settingsJson: '{}', worldRulesJson: '{}' }) as any
const emptyStats = { total: 0, activeCount: 0, resolvedCount: 0, majorCount: 0, openThreadCount: 0 }
// These are the actual IPC methods shared by loadWorkflowStats and document
// reference reads. Unexpected reads still fail instead of a permissive proxy.
function readFixtures(): any {
  const stats = async () => emptyStats
  const rows = async () => []
  return {
    novel: { stats, getContextStatus: async () => ({ staleAssetCount: 0, staleAssetLabels: [], staleChapterCount: 0, staleCheckpointCount: 0 }), get: async () => novel() },
    character: { getStats: stats, list: rows, search: rows }, item: { getStats: stats, search: rows },
    map: { getStats: stats, searchNodes: rows }, faction: { getStats: stats }, glossary: { getStats: stats },
    thread: { getStats: stats, list: rows }, sceneTemplate: { getStats: stats }, revision: { getStats: stats, list: rows },
    outline: { getArcs: rows }, timeline: { getStats: stats, getFilterOptions: async () => ({ eventTypes: [] }) },
    storyAtlas: { query: async () => ({ entities: [], relations: [] }) },
    zhuque: { getChapterResult: async () => ({ enabled: false, status: 'not_checked' }) },
    structure: { listVolumes: rows, getTree: async () => ({ volumes: [], unassignedChapters: [] }) }, creativeStage: { list: rows }, chapter: { list: rows }, storyFact: { list: rows }, foreshadow: { listLedger: rows },
    characterArc: { getArcDashboard: async () => ({ characterArcs: [], relationshipArcs: [] }), listCharacterArcs: rows, listRelationshipArcs: rows },
    resistance: { getDashboard: async () => ({ tracks: [] }), listTracks: rows }, endgameAsset: { listCommitments: rows },
    task: { getPipelineStats: async () => ({}) }, on: () => () => {},
  }
}

async function chatLifecycle(root: Root) {
  const contexts: Array<ReturnType<typeof deferred<any>>> = []
  const replies: Array<ReturnType<typeof deferred<string[]>>> = []
  const controller = { workspaceKey: 'overview', readonly: true, getSnapshot: () => { const pending = deferred<any>(); contexts.push(pending); return pending.promise } } as any
  Object.assign(window, { electron: { quality: { getDashboard: async () => null }, ai: { runPrompt: () => { const pending = deferred<string[]>(); replies.push(pending); return pending.promise } } } })
  const currentNovel = novel()
  const render = (open: boolean, id = 1) => root.render(<WorkspaceChatAssistant open={open} compact={false} novelId={id} currentNovel={currentNovel} currentChapter={null} controller={controller} workspaceKey="overview" workspaceLabel="fixture overview" workspaceSummary="" onClose={() => {}} />)
  const input = () => document.querySelector<HTMLTextAreaElement>('.workspace-chat-assistant textarea')
  await act(async () => render(true))
  await act(async () => contexts[0].resolve({ title: 'initial context' }))
  await type(input(), 'first request')
  await click(button('发送'))
  await act(async () => contexts[1].resolve({ title: 'prompt context' }))
  check(replies.length === 1, 'chat uses fresh context before asking')
  await type(input(), 'keep next draft')
  await act(async () => render(false))
  await act(async () => replies[0].resolve(['stale answer after close']))
  await act(async () => render(true))
  check(input()?.value === 'keep next draft' && text().includes('first request') && !text().includes('stale answer after close'), 'closing cancels pending reply and preserves input/history')
  await act(async () => contexts[2].resolve({ title: 'reopened context' }))
  await click(button('发送'))
  await act(async () => contexts[3].resolve({ title: 'second prompt' }))
  await act(async () => replies[1].resolve(['current reply']))
  check(text().includes('current reply'), 'reopening releases the old ask lock')
  await type(input(), 'old novel draft')
  await act(async () => render(true, 2))
  check(input()?.value === '' && !text().includes('current reply'), 'context switch clears both draft and conversation before commit')
  await act(async () => contexts[4].resolve({ title: 'novel two' }))
  await act(async () => root.render(null))
}

async function qualityLifecycle(root: Root) {
  const contexts: Array<ReturnType<typeof deferred<any>>> = []
  const analyses: Array<ReturnType<typeof deferred<any>>> = []
  const controller = { workspaceKey: 'overview', readonly: true, getSnapshot: () => { const pending = deferred<any>(); contexts.push(pending); return pending.promise } } as any
  Object.assign(window, { electron: { ai: { analyzeWorkspaceQuality: () => { const pending = deferred<any>(); analyses.push(pending); return pending.promise } } } })
  const project = novel()
  const render = (open: boolean) => root.render(<MemoryRouter><WorkspaceAIQualityBoard open={open} novelId={1} currentNovel={project} currentChapter={null} controller={controller} workspaceKey="overview" workspaceLabel="fixture quality" workspaceSummary="" onClose={() => {}} /></MemoryRouter>)
  const report = (summary: string) => ({ summary, severity: 'info', fieldResults: [], entityResults: [], repairPriority: [], globalIssues: [], aiFlavor: { score: 0, summary: '', severity: 'low', breakdown: [], sampleFindings: [], humanizationDirections: [] } })
  await act(async () => render(true))
  await act(async () => contexts[0].resolve({ title: 'quality snapshot' }))
  await click(button('AI分析'))
  await act(async () => render(false))
  await act(async () => analyses[0].resolve(report('stale closed analysis')))
  await act(async () => render(true))
  await act(async () => contexts[1].resolve({ title: 'reopened quality' }))
  check(!text().includes('stale closed analysis'), 'closed quality analysis cannot return into a reopened board')
  await click(button('AI分析'))
  await click(button('刷新'))
  await act(async () => contexts[2].resolve({ title: 'newer quality snapshot' }))
  await act(async () => analyses[1].resolve(report('analysis for older snapshot')))
  check(!text().includes('analysis for older snapshot') && !button('AI分析')?.disabled, 'new snapshot invalidates pending analysis and its loading state')
  await click(button('AI分析'))
  await act(async () => analyses[2].resolve(report('current quality report')))
  check(text().includes('current quality report'), 'quality analysis still renders for the active snapshot')
  await act(async () => root.render(null))
}

async function versionsLifecycle(root: Root) {
  let navigate!: ReturnType<typeof useNavigate>
  const details = new Map<string, ReturnType<typeof deferred<any>>>()
  const fixtures = readFixtures()
  fixtures.agentTools = { call: async ({ toolId, input }: any) => {
    if (toolId.endsWith('workflows.list')) return { ok: true, data: { runs: [{ runId: 1, novelId: 1, artifactId: 'b', status: 'completed', step: 'completed', operation: 'review', stage: 'chapters', atChapter: 1, request: 'review target' }] } }
    if (toolId.endsWith('artifacts.list')) return { ok: true, data: { artifacts: [] } }
    if (toolId.endsWith('artifacts.get')) {
      const pending = deferred<any>(); details.set(input.artifactId, pending)
      return { ok: true, data: await pending.promise }
    }
    throw new Error('Unexpected author tool ' + toolId)
  } }
  Object.assign(window, { electron: fixtures })
  function Routes() { const value = useNavigate(); useLayoutEffect(() => { navigate = value }); return null }
  await act(async () => root.render(<MemoryRouter initialEntries={['/?artifact=a']}><Routes /><Versions novelId={1} /></MemoryRouter>))
  await act(async () => navigate('/?artifact=b'))
  const artifact = (id: string) => ({ artifact: { id, novelId: 1, kind: 'quality_report', version: 1, status: 'reviewed', content: { summary: id === 'b' ? 'active report content' : 'stale report content' } } })
  await act(async () => details.get('b')!.resolve(artifact('b')))
  check(document.querySelector('#object-version-feedback'), 'version feedback rendered: ' + text().slice(0, 1300))
  await type(document.querySelector<HTMLTextAreaElement>('#object-version-feedback'), 'keep revision request')
  await act(async () => details.get('a')!.resolve(artifact('a')))
  check(text().includes('active report content') && !text().includes('stale report content'), 'late artifact cannot replace the routed version')
  await act(async () => navigate('/?artifact=b&panel=details'))
  check(document.querySelector<HTMLTextAreaElement>('#object-version-feedback')?.value === 'keep revision request' && details.size === 2, 'unrelated version route keeps feedback without rereading')
  await click(button('刷新'))
  check(document.querySelector<HTMLTextAreaElement>('#object-version-feedback')?.value === 'keep revision request', 'version list refresh preserves feedback')
  await act(async () => root.render(null))
}

async function timelineLifecycle(root: Root) {
  let api!: ReturnType<typeof useTimelineWorkspace>
  let navigate!: ReturnType<typeof useNavigate>
  const partReads: Array<{ id: number; pending: ReturnType<typeof deferred<any>> }> = []
  const segmentReads: Array<{ id: number; pending: ReturnType<typeof deferred<any>> }> = []
  const queries: any[] = []
  const fixtures = readFixtures()
  fixtures.structure.listPartsPage = (id: number) => { const pending = deferred<any>(); partReads.push({ id, pending }); return pending.promise }
  fixtures.structure.listChaptersPage = async () => ({ items: [] })
  fixtures.structure.getSegment = async (id: number) => ({ id, chapterId: id === 77 ? 700 : 800 })
  fixtures.structure.listSegmentsPage = (id: number) => { const pending = deferred<any>(); segmentReads.push({ id, pending }); return pending.promise }
  fixtures.timeline.query = async (query: any) => { queries.push(query); return { items: [], total: 0, page: query.page, pageSize: 100 } }
  Object.assign(window, { electron: fixtures })
  useNovelStore.getState().setCurrentNovel(novel())
  function Harness() {
    const value = useTimelineWorkspace(1)
    const nav = useNavigate()
    useLayoutEffect(() => { api = value; navigate = nav })
    return <Form form={value.form}>{['volumeId', 'partId', 'chapterStartId', 'chapterEndId', 'segmentId', 'eventTitle'].map(name => <Form.Item key={name} name={name}><Input /></Form.Item>)}</Form>
  }
  await act(async () => root.render(<MemoryRouter initialEntries={['/?volumeId=1&partId=10&chapterId=100&action=new']}><Harness /></MemoryRouter>))
  check(queries.length === 1 && queries[0].volumeId === 1 && queries[0].partId === 10 && queries[0].chapterId === 100, 'timeline route and filters submit one consistent initial query')
  check(api.creating && api.form.getFieldValue('volumeId') === 1, 'timeline deep link creates at the routed anchor')
  await act(async () => { api.form.setFieldValue('eventTitle', 'keep timeline draft'); api.handleFormValuesChange({ eventTitle: 'keep timeline draft' }, api.form.getFieldsValue(true)) })
  await act(async () => navigate('/?volumeId=1&partId=10&chapterId=100&action=new&panel=overview'))
  check(queries.length === 1 && api.form.getFieldValue('eventTitle') === 'keep timeline draft', 'unrelated timeline route cannot recreate the event or discard draft')
  await act(async () => { api.setVolumeFilter(2) })
  check(api.partFilter === 'all' && api.chapterFilter === 'all' && api.segmentFilter === 'all', 'volume selection clears lower filter identities before query')
  const current = partReads.find(item => item.id === 2)!
  check(current, 'new volume starts its own options request')
  await act(async () => current.pending.resolve({ items: [{ id: 20, volumeId: 2, title: 'current part' }] }))
  await act(async () => { for (const read of partReads.filter(item => item.id === 1)) read.pending.resolve({ items: [{ id: 10, volumeId: 1, title: 'stale part' }] }) })
  check(api.filterPartOptions.some(item => item.value === 20) && !api.filterPartOptions.some(item => item.value === 10), 'stale volume options cannot return to active filter')
  await act(async () => api.form.setFieldsValue({ volumeId: 1, partId: 10, segmentId: 77 }))
  check(segmentReads.some(item => item.id === 700), 'segment deep link resolves its chapter independently of the existing list')
  await act(async () => api.form.setFieldValue('segmentId', 88))
  const second = segmentReads.find(item => item.id === 800)!
  await act(async () => second.pending.resolve({ items: [{ id: 88, chapterId: 800, title: 'current segment' }] }))
  await act(async () => { for (const read of segmentReads.filter(item => item.id !== 800)) read.pending.resolve({ items: [{ id: 77, chapterId: 700, title: 'stale segment' }] }) })
  check(api.formSegments.length === 1 && api.formSegments[0].id === 88, 'late chapter segments cannot replace the new segment scope')
  await act(async () => { api.form.setFieldsValue({ volumeId: undefined, partId: undefined, chapterStartId: undefined, chapterEndId: undefined, segmentId: undefined }) })
  check(api.formParts.length === 0 && api.formChapters.length === 0 && api.formSegments.length === 0, 'cleared form owners immediately present empty dependent options')
  await act(async () => root.render(null))
  // Development remounts must not consume a route action in a canceled read.
  await act(async () => root.render(<React.StrictMode><MemoryRouter initialEntries={['/?action=new']}><Harness /></MemoryRouter></React.StrictMode>))
  check(api.creating, 'StrictMode replay still applies the new-event route')
  await act(async () => root.render(null))

  fixtures.timeline.query = async (query: any) => ({ items: query.status ? [] : [{ id: 91, novelId: 1, eventTitle: 'persisted event' }], total: query.status ? 0 : 1 })
  fixtures.timeline.get = async (id: number) => ({ id, novelId: 1, eventTitle: id === 91 ? 'persisted event' : 'routed event' })
  await act(async () => root.render(<MemoryRouter><Harness /></MemoryRouter>))
  await type(document.querySelector<HTMLInputElement>('#eventTitle'), 'unsaved persisted event')
  await act(async () => api.handleFormValuesChange({ eventTitle: 'unsaved persisted event' }, api.form.getFieldsValue(true)))
  await act(async () => api.setStatusFilter('resolved'))
  check(api.pageData.items.length === 0 && api.selectedId === 91 && api.form.getFieldValue('eventTitle') === 'unsaved persisted event' && api.hasUnsavedChanges, 'empty filtered timeline preserves the current persisted draft and save identity')
  await act(async () => navigate('/?eventId=92'))
  check(api.selectedId === 92 && api.form.getFieldValue('eventTitle') === 'routed event', 'explicit timeline navigation keeps the form and selected event identity together')
  await act(async () => root.render(null))
}

async function contractLifecycle(root: Root) {
  let navigate!: ReturnType<typeof useNavigate>
  const reads: Array<{ id: number; pending: ReturnType<typeof deferred<any>> }> = []
  const fixtures = readFixtures()
  fixtures.chapter.list = async () => [1, 2].map(id => ({ id, novelId: 1, chapterNum: id, title: 'chapter ' + id }))
  fixtures.contract = { getChapter: (id: number) => { const pending = deferred<any>(); reads.push({ id, pending }); return pending.promise }, listScenes: async () => [] }
  Object.assign(window, { electron: fixtures })
  useNovelStore.getState().setCurrentNovel(novel())
  function Routes() { const value = useNavigate(); useLayoutEffect(() => { navigate = value }); return null }
  await act(async () => root.render(<MemoryRouter initialEntries={['/?chapterId=1']}><Routes /><Contracts novelId={1} /></MemoryRouter>))
  await act(async () => navigate('/?chapterId=2'))
  await act(async () => reads.find(item => item.id === 2)!.pending.resolve({ chapterId: 2, chapterGoal: 'active contract goal', requiredEndgameCommitmentIds: [], requiredCharacterArcIds: [], requiredRelationshipArcIds: [], requiredResistanceTrackIds: [] }))
  await act(async () => reads.find(item => item.id === 1)!.pending.resolve({ chapterId: 1, chapterGoal: 'stale contract goal', requiredEndgameCommitmentIds: [], requiredCharacterArcIds: [], requiredRelationshipArcIds: [], requiredResistanceTrackIds: [] }))
  const goal = () => document.querySelector<HTMLTextAreaElement>('#chapterGoal')
  check(goal()?.value === 'active contract goal', 'old chapter contract cannot overwrite the newly selected chapter')
  await type(goal(), 'unsaved chapter contract')
  await act(async () => navigate('/?chapterId=1'))
  check(document.querySelector('.ant-modal-confirm'), 'dirty routed chapter switch asks for confirmation')
  await click(button('留在当前章'))
  check(goal()?.value === 'unsaved chapter contract', 'canceling routed chapter switch preserves form input')
  await act(async () => root.render(null))
}

export async function runLifecycleTests(root: Root) {
  await chatLifecycle(root)
  await qualityLifecycle(root)
  await versionsLifecycle(root)
  await timelineLifecycle(root)
  await contractLifecycle(root)
  useNovelStore.getState().resetWorkspace()
}

export { readFixtures, check, deferred, button, click, type, novel }
