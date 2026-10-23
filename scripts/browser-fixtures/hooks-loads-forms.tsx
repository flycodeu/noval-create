import React, { act, useLayoutEffect } from 'react'
import type { Root } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import AuthorStudio from '../../src/pages/Novel/AuthorWorkspace/Studio'
import Endgame from '../../src/pages/Novel/Endgame'
import VolumeDesign from '../../src/pages/Novel/VolumeDesign'
import Studio from '../../src/pages/Novel/Studio'
import ModelManager from '../../src/pages/ModelManager'
import { buildStorySettingsPayload, parseStorySettingsDocument } from '../../src/shared/story-settings'
import { useNovelStore } from '../../src/stores/novel.store'
import { NovelWorkspaceActionsContext, type NovelWorkspaceActions } from '../../src/pages/Novel/workspace-shortcuts-context'

function check(value: unknown, description: string): asserts value {
  if (!value) throw new Error(description)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function waitFor(predicate: () => boolean, description: string) {
  const deadline = Date.now() + 3000
  while (!predicate() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  check(predicate(), description)
}
const bodyText = () => document.body.textContent || ''
function button(label: string, parent: ParentNode = document) {
  return [...parent.querySelectorAll('button')].find(item => item.textContent?.replace(/\s/g, '') === label)
}
async function click(element: Element | null | undefined) {
  check(element, 'click target exists')
  await act(async () => { (element as HTMLElement).click() })
}
async function type(field: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  check(field, 'input target exists')
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const novel = (id: number, settingsJson = '{}') => ({ id, title: 'fixture-' + id, genreName: '都市', userBackground: 'fixture background', settingsJson, contextVersion: 1 }) as any
const setNovel = (value: ReturnType<typeof novel>) => useNovelStore.getState().setCurrentNovel(value)

async function routeComposerTests(root: Root) {
  let navigate!: ReturnType<typeof useNavigate>
  const starts: any[] = []
  Object.assign(window, { electron: {
    model: { list: async () => [{ id: 1, name: 'fixture model', provider: 'fixture', modelId: 'fixture', isDefault: 1 }] },
    chapter: { list: async () => [] }, revision: { list: async () => [] },
    agentTools: { call: async ({ toolId, input }: any) => {
      if (toolId.endsWith('.start')) starts.push(input)
      return { ok: true, data: { run: null } }
    } },
  } })
  setNovel(novel(1))
  function Routes() { const value = useNavigate(); useLayoutEffect(() => { navigate = value }); return null }
  const render = (id: number) => root.render(<MemoryRouter initialEntries={['/?stage=characters&request=original&count=3&autoApply=false&atChapter=2']}><Routes /><AuthorStudio novelId={id} /></MemoryRouter>)
  await act(async () => render(1))
  const field = () => document.querySelector<HTMLTextAreaElement>('#author-request')
  await type(field(), 'unsaved instructions')
  await act(async () => navigate('/?stage=characters&request=original&count=3&autoApply=false&atChapter=2&panel=blockers'))
  check(field()?.value === 'unsaved instructions', 'unrelated route parameter preserves edited composer request')
  await act(async () => navigate('/?stage=outline&request=new-route-request&count=4&autoApply=true&atChapter=7&sourceArtifactId=source-7'))
  check(field()?.value === 'new-route-request', 'new explicit route request initializes the composer before commit')
  await click(button('开始这一轮'))
  check(starts.length === 1 && starts[0].stage === 'outline' && starts[0].count === 4 && starts[0].atChapter === 7 && starts[0].sourceArtifactId === 'source-7' && starts[0].autoApply, 'workflow receives one consistent set of routed form values')
  await type(field(), 'keep request without route override')
  await act(async () => navigate('/?count=2'))
  check(field()?.value === 'keep request without route override', 'absent request preserves user input when other form defaults change')
  await act(async () => { setNovel(novel(2)); render(2) })
  check(field()?.value === '', 'new novel cannot inherit another novel composer draft')
  await act(async () => root.render(null))
}

async function endgameDraftTests(root: Root) {
  let save: (() => void) | null = null
  let leave: (() => boolean) | null = null
  let savedPayload = ''
  const summary = { totalCount: 0, unboundCount: 0 }
  const settings = (finalConflict: string) => JSON.stringify(buildStorySettingsPayload({ endgameDesign: { endingMode: 'victory', finalConflict, themeAnswer: 'answer', lastScene: 'last scene', mustDeliverPromises: 'promise'  } }))
  let stored = novel(1, settings('stored conflict'))
  Object.assign(window, { electron: {
    endgameAsset: { getSummary: async () => summary, listCommitments: async () => [], syncFromSettings: async (_id: number, payload: string) => { savedPayload = payload; return { summary } } },
    novel: { update: async (_id: number, data: any) => { stored = { ...stored, ...data } }, get: async () => stored },
  } })
  const actions: NovelWorkspaceActions = {
    mutationToken: 0, notifyWorkspaceMutation() {}, registerClearHandler() {}, registerEscapeHandler() {},
    registerSaveHandler(handler) { save = handler }, registerLeaveGuard(handler) { leave = handler },
  }
  const render = (id: number) => root.render(<MemoryRouter><NovelWorkspaceActionsContext.Provider value={actions}><Endgame novelId={id} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>)
  setNovel(stored)
  await act(async () => render(1))
  const field = () => document.querySelector<HTMLTextAreaElement>('#finalConflict')
  check(field()?.value === 'stored conflict', 'endgame initializes from persisted design')
  await type(field(), 'unsaved conflict')
  check(leave?.() && document.querySelector('[data-endgame-save-state="unsaved"]'), 'editing registers a leave guard and dirty status')
  await act(async () => { stored = novel(1, settings('external conflict')); setNovel(stored) })
  check(field()?.value === 'unsaved conflict' && leave?.(), 'external persisted update cannot overwrite a dirty endgame form or clear its guard')
  check(save, 'endgame save shortcut registered')
  await act(async () => { await save!() })
  await waitFor(() => Boolean(savedPayload), 'endgame save must finish validation and persistence')
  check(parseStorySettingsDocument(savedPayload).endgameDesign.finalConflict === 'unsaved conflict', 'endgame saves the preserved draft through its existing persistence path')
  check(!leave?.() && document.querySelector('[data-endgame-save-state="saved"]'), 'successful save clears the guard and dirty status')
  await act(async () => { stored = novel(1, settings('clean external conflict')); setNovel(stored) })
  check(field()?.value === 'clean external conflict', 'clean endgame still follows external persisted updates')
  await type(field(), 'must not cross novels')
  await act(async () => { setNovel(novel(2, settings('second novel conflict'))); render(2) })
  check(field()?.value === 'second novel conflict' && !leave?.(), 'novel identity rebuilds the endgame form and guard')
  await act(async () => root.render(null))
}

async function volumeDraftTests(root: Root) {
  let save: (() => void) | null = null
  let leave: (() => boolean) | null = null
  const designReads: Array<ReturnType<typeof deferred<any[]>>> = []
  const writes: any[] = []
  const volumes = [1, 2].map(id => ({ id, volumeNumber: id, title: 'volume-' + id, status: 'draft', chapterCount: 0, wordCount: 0 }))
  const design = (volumeId: number, volumeTheme: string) => ({ volumeId, volumeTheme, linkedEndgameCommitmentIds: [], linkedResistanceTrackIds: [], mustResolveClues: [], mustAddClues: [], auditStatus: 'draft' })
  Object.assign(window, { electron: {
    structure: { listVolumes: async () => volumes },
    volumeDesign: { list: () => { const pending = deferred<any[]>(); designReads.push(pending); return pending.promise }, upsert: async (id: number, data: any) => { writes.push({ id, data }) } },
    endgameAsset: { listCommitments: async () => [] }, resistance: { getDashboard: async () => ({ tracks: [] }) },
  } })
  const actions: NovelWorkspaceActions = { mutationToken: 0, notifyWorkspaceMutation() {}, registerClearHandler() {}, registerEscapeHandler() {}, registerSaveHandler(handler) { save = handler }, registerLeaveGuard(handler) { leave = handler } }
  setNovel(novel(1))
  sessionStorage.setItem('novelforge-volume-design:1', '2')
  await act(async () => root.render(<MemoryRouter><NovelWorkspaceActionsContext.Provider value={actions}><VolumeDesign novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  await act(async () => designReads[0].resolve([design(1, 'theme-one'), design(2, 'theme-two')]))
  const field = () => document.querySelector<HTMLTextAreaElement>('#volumeTheme')
  check(field()?.value === 'theme-two', 'volume design restores session selection before presenting a form')
  await type(field(), 'unsaved volume theme')
  check(leave?.(), 'volume draft keeps the leave guard')
  await click(document.querySelector('[data-volume-design-volume-id="1"]'))
  check(field()?.value === 'unsaved volume theme', 'volume switching waits for discard confirmation')
  await click(button('留下继续编辑', document.querySelector('.ant-modal-confirm')!))
  check(field()?.value === 'unsaved volume theme' && leave?.(), 'cancelled volume switch preserves draft and guard')
  check(save, 'volume save handler registered')
  await act(async () => { void save!() })
  await waitFor(() => writes.length === 1, 'volume save must finish validation')
  check(writes[0]?.id === 2 && writes[0]?.data.volumeTheme === 'unsaved volume theme', 'save targets the restored volume and preserved draft')
  await act(async () => designReads[1].resolve([design(1, 'theme-one'), design(2, 'unsaved volume theme')]))
  check(field()?.value === 'unsaved volume theme' && !leave?.(), 'successful volume reload clears only the saved draft guard')
  await click(document.querySelector('[data-volume-design-volume-id="1"]'))
  check(field()?.value === 'theme-one', 'clean volume selection loads the requested design')
  await act(async () => root.render(null))
  sessionStorage.removeItem('novelforge-volume-design:1')
}

async function importedDraftTests(root: Root) {
  const reads: Array<{ id: string; pending: ReturnType<typeof deferred<any>> }> = []
  const listReads: Array<ReturnType<typeof deferred<any>>> = []
  const refs = ['newer', 'older'].map((id, index) => ({ id, kind: 'generic_draft', status: 'draft', createdAt: '2026-10-2' + (3 - index), producerType: 'api_client', contextVersion: 1 }))
  const result = (index: number) => ({ ok: true, data: { artifact: { ...refs[index], novelId: 1, content: { title: 'DETAIL_' + refs[index].id, assetType: 'character', outputFormat: 'markdown', body: 'fixture body' } } } })
  const stats = async () => ({ total: 0, openCount: 0, inProgressCount: 0, blockerCount: 0 })
  Object.assign(window, { electron: {
    novel: { get: async () => novel(1), stats: async () => ({ totalChapters: 0, completedChapters: 0, totalWords: 0 }), runConsistencyCheck: async () => null, getContextStatus: async () => ({ staleChapterCount: 0 }) },
    ...Object.fromEntries(['character', 'item', 'map', 'faction', 'glossary', 'thread', 'sceneTemplate', 'timeline'].map(name => [name, { getStats: stats }])),
    revision: { getStats: stats, getSnapshot: async () => null }, outline: { getArcs: async () => [] }, structure: { listVolumes: async () => [] },
    characterArc: { getArcDashboard: async () => ({ characterArcs: [], relationshipArcs: [] }) }, resistance: { getDashboard: async () => ({ tracks: [] }) },
    task: { getPipelineStats: async () => ({}), list: async () => [] }, quality: { getDashboard: async () => null }, history: { listRecent: async () => [] }, chapter: { list: async () => [] }, style: { resolveActive: async () => null },
    agentTools: { call: ({ toolId, input }: any) => {
      const pending = deferred<any>()
      if (toolId.endsWith('.list')) listReads.push(pending)
      else reads.push({ id: input.artifactId, pending })
      return pending.promise
    } },
  } })
  setNovel(novel(1))
  await act(async () => root.render(<MemoryRouter><Studio novelId={1} /></MemoryRouter>))
  await act(async () => listReads[0].resolve({ ok: true, data: { artifacts: refs } }))
  check(reads.length === 0, 'closed import drawer does not load any draft detail')
  await click([...document.querySelectorAll('button')].find(item => item.textContent?.startsWith('查看导入草稿')))
  check(reads[0]?.id === 'newer', 'opening drawer reads the first valid imported draft')
  await click(document.querySelectorAll('.studio-page__imported-item')[1])
  check(reads[1]?.id === 'older', 'selecting another draft starts an independent detail read')
  await act(async () => reads[1].pending.resolve(result(1)))
  await act(async () => reads[0].pending.resolve(result(0)))
  check(bodyText().includes('DETAIL_older') && !bodyText().includes('DETAIL_newer'), 'late first draft cannot replace the selected detail')
  await click(button('刷新', document.querySelector('.ant-drawer')!))
  await act(async () => listReads[1].reject(new Error('import list failure')))
  check(bodyText().includes('DETAIL_older') && bodyText().includes('import list failure'), 'failed list refresh preserves its list and selected detail')
  await click(document.querySelector('.ant-drawer-close'))
  await click([...document.querySelectorAll('button')].find(item => item.textContent?.startsWith('查看导入草稿')))
  check(reads.at(-1)?.id === 'older', 'reopening drawer retains requested selection while reloading detail')
  await click(document.querySelector('.ant-drawer-close'))
  await act(async () => reads.at(-1)!.pending.resolve(result(1)))
  await click([...document.querySelectorAll('button')].find(item => item.textContent?.startsWith('查看导入草稿')))
  check(!bodyText().includes('DETAIL_older'), 'closed drawer response cannot substitute for the reopened request')
  await act(async () => reads.at(-1)!.pending.resolve(result(1)))
  await act(async () => root.render(null))
}

async function modelDraftTests(root: Root) {
  const settings = deferred<any>()
  const savedSettings = { provider: 'auto', tavilyApiKeySet: false, braveApiKeySet: false }
  Object.assign(window, { electron: { model: { list: async () => [] }, sourceSearch: { getSettings: () => settings.promise } } })
  await act(async () => root.render(<ModelManager />))
  // Open the independent search-key editor before the initial settings IPC settles.
  const sourceButton = button('搜索API')
  check(sourceButton, 'source search configuration is visible')
  await click(sourceButton)
  const input = document.querySelector<HTMLInputElement>('input[id$="tavilyApiKey"]')
  await type(input, 'unsaved-fixture-key')
  await act(async () => settings.resolve(savedSettings))
  check(input?.value === 'unsaved-fixture-key', 'late initial settings cannot replace an edited search key')
  await act(async () => root.render(null))
}

export async function runLoadFormTests(root: Root) {
  await routeComposerTests(root)
  await endgameDraftTests(root)
  await volumeDraftTests(root)
  await importedDraftTests(root)
  await modelDraftTests(root)
  useNovelStore.getState().resetWorkspace()
}
