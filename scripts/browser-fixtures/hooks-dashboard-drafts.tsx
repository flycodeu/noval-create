import React, { act, useLayoutEffect } from 'react'
import type { Root } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import GrowthSystem from '../../src/pages/Novel/GrowthSystem'
import CharacterArcCenter from '../../src/pages/Novel/CharacterArcCenter'
import Resistance from '../../src/pages/Novel/Resistance'
import { useNovelStore } from '../../src/stores/novel.store'
import { NovelWorkspaceActionsContext, type NovelWorkspaceActions } from '../../src/pages/Novel/workspace-shortcuts-context'

function check(value: unknown, description: string): asserts value { if (!value) throw new Error(description) }
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
const button = (label: string, parent: ParentNode = document) => [...parent.querySelectorAll('button')].find(item => item.textContent?.replace(/\s/g, '') === label)
async function click(element: Element | null | undefined) {
  check(element, 'dashboard click target exists')
  await act(async () => { (element as HTMLElement).click() })
}
async function type(field: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string) {
  check(field, 'dashboard input exists')
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const novel = (id: number) => ({ id, title: 'dashboard-fixture-' + id, genreName: '都市', settingsJson: '{}', worldRulesJson: '{}' }) as any
function actions() {
  let leave: (() => boolean) | null = null
  let save: (() => void) | null = null
  const value: NovelWorkspaceActions = { mutationToken: 0, notifyWorkspaceMutation() {}, registerClearHandler() {}, registerEscapeHandler() {}, registerSaveHandler(handler) { save = handler }, registerLeaveGuard(handler) { leave = handler } }
  return { value, dirty: () => leave?.() ?? false, save: () => save?.() }
}
async function more(label: string) {
  await click(document.querySelector('button[aria-label="更多页面操作"]'))
  await click([...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent?.includes(label)))
}
function textArea(label: string) {
  return [...document.querySelectorAll('.guided-step__field-card')].find(item => item.querySelector('.novel-character-arc-center__field-label, .novel-resistance-page__field-label')?.textContent === label)?.querySelector<HTMLTextAreaElement>('textarea')
}

async function growthDraftTests(root: Root) {
  const reads: Array<ReturnType<typeof deferred<any>>> = []
  const writes: any[] = []
  const a = actions()
  const dashboard = { tracks: [], pools: [], events: [], chapters: [{ id: 11, chapterNum: 1, title: 'one' }], volumes: [], summary: { trackCount: 0, criticalPoolCount: 0, unresolvedCostCount: 0, chapterWritebackCoverage: 0 } }
  Object.assign(window, { electron: { growthSystem: {
    getDashboard: () => { const pending = deferred<any>(); reads.push(pending); return pending.promise },
    upsertTrack: async (id: number, data: any) => { writes.push({ id, data }) },
  } } })
  useNovelStore.getState().setCurrentNovel(novel(1))
  const render = (revision: number) => root.render(<MemoryRouter><NovelWorkspaceActionsContext.Provider value={{ ...a.value, mutationToken: revision }}><GrowthSystem novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>)
  await act(async () => render(0))
  await act(async () => reads[0].resolve(dashboard))
  await click(button('新建成长轨道'))
  const field = () => document.querySelector<HTMLInputElement>('.ant-modal input#title')
  await type(field(), 'unsaved growth track')
  check(a.dirty(), 'growth editor registers its leave guard')
  await act(async () => render(1))
  check(field()?.value === 'unsaved growth track' && a.dirty(), 'external growth refresh keeps the mounted editor and dirty state')
  await act(async () => reads[1].reject(new Error('growth refresh failed')))
  check(field()?.value === 'unsaved growth track' && a.dirty(), 'failed growth refresh preserves the draft')
  await act(async () => render(2))
  await act(async () => reads[2].resolve({ ...dashboard, tracks: [{ id: 3, title: 'external growth track', trackType: 'character', currentStatus: 'draft' }] }))
  check(field()?.value === 'unsaved growth track' && a.dirty(), 'successful refresh adjusts list selection without changing the open growth form')
  await act(async () => { a.save() })
  await waitFor(() => writes.length === 1 && reads.length === 4, 'growth shortcut saves and refreshes')
  check(writes[0].id === 1 && writes[0].data.title === 'unsaved growth track' && writes[0].data.id === undefined, 'growth save retains the create identity and unsaved input')
  await act(async () => reads[3].resolve(dashboard))
  check(!a.dirty(), 'successful growth save clears its own guard')
  await act(async () => root.render(null))
}

async function arcDraftTests(root: Root) {
  let navigate!: ReturnType<typeof useNavigate>
  const a = actions()
  const reads: Array<ReturnType<typeof deferred<any>>> = []
  const writes: any[] = []
  const characters = [1, 2].map(id => ({ id, novelId: 1, fullName: 'person-' + id, roleType: id === 1 ? 'protagonist' : 'major' }))
  const dashboard = { availableCharacters: characters, availableRelations: [], characterArcs: [], relationshipArcs: [], chapters: [], timelineEvents: [] }
  Object.assign(window, { electron: { characterArc: {
    getArcDashboard: () => { const pending = deferred<any>(); reads.push(pending); return pending.promise },
    upsertCharacterArc: async (data: any) => { writes.push(data) },
  } } })
  function Routes() { const value = useNavigate(); useLayoutEffect(() => { navigate = value }); return null }
  useNovelStore.getState().setCurrentNovel(novel(1))
  const render = (id: number) => root.render(<MemoryRouter initialEntries={['/?tab=characters&characterId=2']}><Routes /><NovelWorkspaceActionsContext.Provider value={a.value}><CharacterArcCenter novelId={id} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>)
  await act(async () => render(1))
  await act(async () => reads[0].resolve(dashboard))
  const field = () => textArea('初始状态')
  await type(field(), 'unsaved arc state')
  await act(async () => navigate('/?tab=characters&characterId=2&panel=overview'))
  check(field()?.value === 'unsaved arc state' && a.dirty(), 'unrelated route changes preserve the selected arc draft')
  await more('刷新弧线数据')
  await act(async () => reads[1].resolve({ ...dashboard, characterArcs: [{ id: 7, characterId: 2, startState: 'external arc state', beats: [] }] }))
  check(field()?.value === 'unsaved arc state' && a.dirty(), 'arc dashboard refresh cannot replace a dirty form')
  await click(document.querySelector('[data-character-arc-list-row]'))
  await click(button('留下继续编辑', document.querySelector('.ant-modal-confirm')!))
  check(field()?.value === 'unsaved arc state' && a.dirty(), 'cancelled character switch retains the draft and guard')
  await click(button('保存当前弧线'))
  check(writes[0]?.characterId === 2 && writes[0]?.startState === 'unsaved arc state', 'arc save targets the routed character with preserved draft')
  await act(async () => reads[2].resolve(dashboard))
  check(!a.dirty(), 'saved arc clears its guard')
  await act(async () => { useNovelStore.getState().setCurrentNovel(novel(2)); render(2) })
  await act(async () => reads[3].resolve({ ...dashboard, availableCharacters: characters.map(item => ({ ...item, novelId: 2 })) }))
  check(field()?.value === '' && !a.dirty(), 'another novel cannot inherit the previous arc form')
  await act(async () => root.render(null))
}

async function resistanceDraftTests(root: Root) {
  const a = actions()
  const reads: Array<ReturnType<typeof deferred<any>>> = []
  const writes: any[] = []
  const track = { id: 4, novelId: 1, sourceType: 'environment', resistanceKind: 'environment', title: 'stored pressure', goal: 'stored goal', currentStatus: 'draft', beats: [] }
  const dashboard = { availableCharacters: [], availableFactions: [], tracks: [track], characterTracks: [], factionTracks: [], environmentTracks: [track], institutionTracks: [], volumes: [], chapters: [], timelineEvents: [] }
  Object.assign(window, { electron: { resistance: {
    getDashboard: () => { const pending = deferred<any>(); reads.push(pending); return pending.promise },
    upsertTrack: async (data: any) => { writes.push(data); return { ...data, id: data.id || 8 } },
  } } })
  useNovelStore.getState().setCurrentNovel(novel(1))
  await act(async () => root.render(<MemoryRouter initialEntries={['/?tab=environment&trackId=4']}><NovelWorkspaceActionsContext.Provider value={a.value}><Resistance novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  await act(async () => reads[0].resolve(dashboard))
  const field = () => textArea('阻力目标')
  // The main goal is the first textarea in the compact editor; locate it by its stored value.
  const goal = () => field() || [...document.querySelectorAll<HTMLTextAreaElement>('.novel-resistance-page textarea')].find(item => item.value === 'stored goal' || item.value === 'unsaved pressure goal')
  await type(goal(), 'unsaved pressure goal')
  await more('刷新阻力数据')
  await act(async () => reads[1].reject(new Error('resistance refresh failed')))
  check(goal()?.value === 'unsaved pressure goal' && a.dirty(), 'failed resistance refresh preserves dirty draft and leave guard')
  await more('刷新阻力数据')
  await act(async () => reads[2].resolve({ ...dashboard, tracks: [{ ...track, goal: 'external goal' }], environmentTracks: [{ ...track, goal: 'external goal' }] }))
  check(goal()?.value === 'unsaved pressure goal' && a.dirty(), 'successful resistance refresh cannot replace a dirty standalone track')
  await click(button('保存当前阻力线'))
  check(writes[0]?.id === 4 && writes[0]?.goal === 'unsaved pressure goal', 'resistance save uses the retained track identity and draft')
  await act(async () => reads[3].resolve(dashboard))
  check(!a.dirty(), 'successful resistance save clears the leave guard')
  await more('新建本类阻力')
  check(![...document.querySelectorAll<HTMLInputElement>('.novel-resistance-page input')].some(item => item.value === 'stored pressure'), 'new standalone track starts independently from the selected persisted track')
  await click(button('保存当前阻力线'))
  check(writes[1]?.id === undefined, 'new standalone track is saved as a new record')
  await act(async () => reads[4].resolve(dashboard))
  await act(async () => root.render(null))
}

export async function runDashboardDraftTests(root: Root) {
  await growthDraftTests(root)
  await arcDraftTests(root)
  await resistanceDraftTests(root)
  useNovelStore.getState().resetWorkspace()
}
