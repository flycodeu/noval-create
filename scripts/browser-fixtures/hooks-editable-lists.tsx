import React, { act, useLayoutEffect } from 'react'
import type { Root } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import Glossary from '../../src/pages/Novel/Glossary'
import SceneTemplates from '../../src/pages/Novel/SceneTemplates'
import Characters from '../../src/pages/Novel/Characters/CharacterWorkspace'
import Items from '../../src/pages/Novel/ItemsWorkspace'
import BatchWorkbench from '../../src/pages/Novel/BatchWorkbench'
import TaskCenter from '../../src/pages/TaskCenter'
import StoryThreads from '../../src/pages/Novel/StoryThreads'
import { NovelWorkspaceActionsContext, type NovelWorkspaceActions } from '../../src/pages/Novel/workspace-shortcuts-context'
import { useNovelStore } from '../../src/stores/novel.store'
import { readFixtures, check, deferred, button, click, type, novel } from './hooks-lifecycles'

function actions() {
  let guard: (() => boolean) | null = null
  const value: NovelWorkspaceActions = { mutationToken: 0, notifyWorkspaceMutation() {}, registerClearHandler() {}, registerSaveHandler() {}, registerEscapeHandler() {}, registerLeaveGuard(fn) { guard = fn } }
  return { value, dirty: () => guard?.() ?? false }
}
async function deepLinkList(root: Root, kind: 'glossary' | 'sceneTemplate') {
  const fixtures = readFixtures()
  const reads: Array<ReturnType<typeof deferred<any>>> = []
  const details: Array<{ id: number; pending: ReturnType<typeof deferred<any>> }> = []
  fixtures[kind].query = () => { const pending = deferred<any>(); reads.push(pending); return pending.promise }
  fixtures[kind].get = (id: number) => { const pending = deferred<any>(); details.push({ id, pending }); return pending.promise }
  fixtures.glossary.usageReport = async () => null
  Object.assign(window, { electron: fixtures })
  useNovelStore.getState().setCurrentNovel(novel())
  const a = actions()
  let navigate!: ReturnType<typeof useNavigate>
  function Routes() { const value = useNavigate(); useLayoutEffect(() => { navigate = value }); return null }
  const key = kind === 'glossary' ? 'glossaryId' : 'templateId'
  const render = (revision: number) => root.render(<MemoryRouter initialEntries={['/?' + key + '=20']}><Routes /><NovelWorkspaceActionsContext.Provider value={{ ...a.value, mutationToken: revision }}>{kind === 'glossary' ? <Glossary novelId={1} /> : <SceneTemplates novelId={1} />}</NovelWorkspaceActionsContext.Provider></MemoryRouter>)
  await act(async () => render(0))
  await act(async () => navigate('/?' + key + '=21'))
  const entry = (id: number, builtin = false) => kind === 'glossary'
    ? { id, novelId: 1, term: 'term ' + id, category: 'concept', definition: 'definition', isCanonical: 1 }
    : { id, novelId: 1, name: 'template ' + id, category: 'conflict', description: '', isBuiltin: builtin ? 1 : 0 }
  await act(async () => details.find(item => item.id === 21)!.pending.resolve(entry(21)))
  await act(async () => reads[0].resolve({ items: [], total: 0 }))
  await act(async () => details.find(item => item.id === 20)!.pending.resolve(entry(20)))
  const field = () => document.querySelector<HTMLInputElement>(kind === 'glossary' ? '#term' : '#name')
  check(field()?.value === (kind === 'glossary' ? 'term 21' : 'template 21'), kind + ' preserves routed entry outside a late filtered list and rejects stale detail')
  await type(field(), 'unsaved ' + kind)
  check(a.dirty(), kind + ' registers dirty state')
  await act(async () => render(1))
  await act(async () => reads[1].resolve({ items: [], total: 0 }))
  check(field()?.value === 'unsaved ' + kind && a.dirty(), kind + ' external refresh keeps the routed draft and persisted signature')
  if (kind === 'sceneTemplate') {
    // Route changes retain the existing behavior of opening a builtin record;
    // builtin templates must remain read-only.
    await act(async () => navigate('/?templateId=22'))
    await act(async () => details.find(item => item.id === 22)!.pending.resolve(entry(22, true)))
    check(field()?.disabled, 'builtin scene template stays read-only after a deep link')
  }
  await act(async () => root.render(null))
}

async function creatingList(root: Root, kind: 'character' | 'item') {
  const fixtures = readFixtures()
  const reads: Array<ReturnType<typeof deferred<any>>> = []
  fixtures[kind].query = () => { const pending = deferred<any>(); reads.push(pending); return pending.promise }
  fixtures[kind].getFilterOptions = async () => kind === 'character' ? { species: [], factions: [], roleTypes: [], entityTypes: [] } : { categories: [], rarities: [], statuses: [] }
  fixtures.character.getGraph = async () => ({ characters: [], relations: [] })
  fixtures.item.search = async () => []
  fixtures.timeline.search = async () => []
  fixtures.structure.listCreativeStages = async () => []
  let details = 0
  fixtures[kind].get = async () => { details += 1; return null }
  fixtures[kind].getDetailContext = async () => { details += 1; throw new Error('A creating draft must not read persisted details') }
  Object.assign(window, { electron: fixtures })
  useNovelStore.getState().setCurrentNovel(novel())
  const a = actions()
  await act(async () => root.render(<MemoryRouter><NovelWorkspaceActionsContext.Provider value={a.value}>{kind === 'character' ? <Characters novelId={1} /> : <Items novelId={1} />}</NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  await click(button(kind === 'character' ? '新建人物' : '新建模板'))
  const field = () => document.querySelector<HTMLInputElement>(kind === 'character' ? '#fullName' : '#itemName')
  await type(field(), 'new unsaved ' + kind)
  await act(async () => { for (const read of reads) read.resolve({ items: [{ id: 1, novelId: 1, fullName: 'old person', itemName: 'old item', itemKind: 'template', status: 'available', roleType: 'major' }], total: 1 }) })
  check(field()?.value === 'new unsaved ' + kind && details === 0 && a.dirty(), kind + ' initial page response cannot replace a creating draft')
  if (kind === 'character') {
    const created = { id: 2, novelId: 1, fullName: 'new unsaved character', roleType: 'major', recordStatus: 'confirmed' }
    fixtures.character.create = async () => 2
    fixtures.character.get = async () => created
    fixtures.character.getDetailContext = async () => ({ relatedItems: [], relatedCharacters: [], relatedRelations: [] })
    fixtures.character.query = async () => ({ items: [created], total: 1 })
    await click(button('保存并确认'))
    check(field()?.value === created.fullName && !a.dirty(), 'successful character creation clears the saved draft guard')
    const write = deferred<void>()
    fixtures.character.update = () => write.promise
    await type(field(), 'submitted character')
    await click(button('保存并确认'))
    await type(field(), 'typed during save')
    await act(async () => write.resolve())
    check(field()?.value === 'typed during save' && a.dirty(), 'character save completion keeps newer input and its leave guard')
  }
  await act(async () => root.render(null))
}

async function batchLatestSelection(root: Root) {
  const reads: Array<{ id: number | undefined; pending: ReturnType<typeof deferred<any>> }> = []
  Object.assign(window, { electron: { batchWorkbench: { getData: (_novel: number, id?: number) => { const pending = deferred<any>(); reads.push({ id, pending }); return pending.promise } } } })
  const snapshot = (id: number) => ({ id, batchIndex: id, status: 'completed', chapterStart: id, chapterEnd: id, chapterNums: [id], source: 'fixture' })
  const data = (id: number) => ({ snapshots: [snapshot(1), snapshot(2)], activeSnapshot: snapshot(id), globalLockLibrary: { lockedCanonFacts: ['locks for ' + id], lockedParagraphs: [], lockedStyleRules: [], lockedCharacterVoice: [] }, inspections: [], rollbacks: [] })
  await act(async () => root.render(<BatchWorkbench novelId={1} />))
  await act(async () => reads[0].pending.resolve(data(1)))
  const snapshotButtons = [...document.querySelectorAll('button')].filter(item => item.textContent?.includes('第 2–2 章'))
  await click(snapshotButtons[0])
  check(reads[1]?.id === 2, 'batch history selection requests the explicit snapshot')
  await click(document.querySelector('[data-batch-snapshot-id="1"]'))
  check(reads[2]?.id === 1, 'newer history selection requests its explicit snapshot')
  await act(async () => reads[2].pending.resolve(data(1)))
  await act(async () => reads[1].pending.resolve(data(2)))
  const field = document.querySelector<HTMLTextAreaElement>('.novel-batch-workbench__lock-grid textarea, .novel-batch-workbench__body textarea')
  check(field?.value === 'locks for 1', 'late selected snapshot cannot replace the newer selection or its lock library')
  await act(async () => root.render(null))
}

async function taskPolling(root: Root) {
  const originalInterval = window.setInterval
  let poll!: () => void
  window.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 5000 && typeof callback === 'function') { poll = callback as () => void; return 123456 }
    return originalInterval(callback, delay, ...args)
  }) as typeof window.setInterval
  const reads: Array<ReturnType<typeof deferred<any>>> = []
  Object.assign(window, { electron: { task: { query: () => { const pending = deferred<any>(); reads.push(pending); return pending.promise }, getStats: async () => ({ total: 0, running: 0, pending: 0, completed: 0, failed: 0 }) } } })
  const page = { items: [], total: 0, page: 1, pageSize: 20 }
  try {
    await act(async () => root.render(<MemoryRouter><TaskCenter /></MemoryRouter>))
    await act(async () => { poll() })
    check(reads.length === 1, 'task polling skips an in-flight initial foreground load')
    await act(async () => reads[0].resolve(page))
    await act(async () => { poll() })
    check(!button('刷新')?.classList.contains('ant-btn-loading'), 'silent task polling does not flash foreground loading')
    await click(button('刷新'))
    check(reads.length === 3, 'foreground refresh supersedes a pending poll')
    await act(async () => reads[2].resolve(page))
    await act(async () => { poll() })
    check(reads.length === 3, 'one older poll still owns the polling lock')
    await act(async () => reads[1].resolve(page))
    await act(async () => { poll() })
    check(reads.length === 4, 'polling resumes after its owner finishes')
    await act(async () => reads[3].resolve(page))
    await act(async () => root.render(null))
  } finally { window.setInterval = originalInterval }
}

async function threadRoutedDraft(root: Root) {
  const fixtures = readFixtures()
  const details: Array<{ id: number; pending: ReturnType<typeof deferred<any>> }> = []
  let reads = 0
  const writes: any[] = []
  fixtures.thread.query = async () => { reads += 1; return { items: [], total: 0 } }
  fixtures.thread.getForeshadowSnapshot = async () => ({ currentChapterNum: 0, pending: [], dueSoon: [], resolved: [], overdue: [] })
  fixtures.thread.get = (id: number) => { const pending = deferred<any>(); details.push({ id, pending }); return pending.promise }
  fixtures.thread.update = async (id: number, values: any) => { writes.push({ id, values }) }
  Object.assign(window, { electron: fixtures })
  useNovelStore.getState().setCurrentNovel(novel())
  let navigate!: ReturnType<typeof useNavigate>
  let save: (() => void) | null = null
  const a = actions()
  const value = { ...a.value, registerSaveHandler(fn: (() => void) | null) { save = fn } }
  function Routes() { const nav = useNavigate(); useLayoutEffect(() => { navigate = nav }); return null }
  const render = (revision: number) => root.render(<MemoryRouter initialEntries={['/?threadId=1&action=edit']}><Routes /><NovelWorkspaceActionsContext.Provider value={{ ...value, mutationToken: revision }}><StoryThreads novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>)
  await act(async () => render(0))
  await act(async () => navigate('/?threadId=2&action=edit'))
  const thread = (id: number) => ({ id, novelId: 1, title: 'thread ' + id, threadType: 'subplot', status: 'planned', priority: 'medium' })
  await act(async () => details.find(item => item.id === 2)!.pending.resolve(thread(2)))
  await act(async () => details.find(item => item.id === 1)!.pending.resolve(thread(1)))
  check(document.querySelector<HTMLInputElement>('#title')?.value === 'thread 2', 'thread deep link rejects stale detail')
  await type(document.querySelector<HTMLInputElement>('#title'), 'unsaved thread')
  await act(async () => navigate('/?threadId=2&action=edit&panel=overview'))
  await act(async () => render(1))
  check(reads === 2 && details.length === 2 && document.querySelector<HTMLInputElement>('#title')?.value === 'unsaved thread', 'thread external list refresh and unrelated route do not reopen the editor')
  check(save, 'thread shortcut save is registered')
  await act(async () => { save?.() })
  check(writes.length === 1 && writes[0].id === 2 && writes[0].values.title === 'unsaved thread', 'thread save retains routed identity and draft')
  await act(async () => root.render(null))
}

export async function runEditableListTests(root: Root) {
  await deepLinkList(root, 'glossary')
  await deepLinkList(root, 'sceneTemplate')
  await creatingList(root, 'character')
  await creatingList(root, 'item')
  await batchLatestSelection(root)
  await taskPolling(root)
  await threadRoutedDraft(root)
  useNovelStore.getState().resetWorkspace()
}
