import { runEditableListTests } from './hooks-editable-lists'
import { runLifecycleTests } from './hooks-lifecycles'
import { runBoundaryTests } from './hooks-boundaries'
import { runLoadFormTests } from './hooks-loads-forms'
import { runDashboardDraftTests } from './hooks-dashboard-drafts'
import React, { act, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useAsyncSnapshot } from '../../src/hooks/useAsyncSnapshot'
import { useCreativeWorkflow } from '../../src/pages/Novel/AuthorWorkspace/workflow-client'
import { useScopedState } from '../../src/hooks/useScopedState'
import WorldAndCast from '../../src/pages/Novel/AuthorWorkspace/WorldAndCast'
import StagePlanner from '../../src/pages/Novel/StagePlanner'
import TaskCenter from '../../src/pages/TaskCenter'
import AiPatchEditor from '../../src/pages/Novel/components/AiPatchEditor'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.getElementById('root')!
const root = createRoot(container)
function check(value: unknown, description: string): asserts value {
  if (!value) throw new Error(description)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function click(element: Element | null) {
  check(element, 'click target must exist')
  await act(async () => { (element as HTMLElement).click() })
}
function button(text: string) {
  return [...document.querySelectorAll('button')].find(item => item.textContent?.replace(/\s/g, '') === text) || null
}
const text = () => document.body.textContent || ''

async function scopedStateTests() {
  const commits: Array<{ filter: string; page: number; selected: number[] }> = []
  let api!: { page: number; draft: string; setPage: React.Dispatch<React.SetStateAction<number>>; setDraft: React.Dispatch<React.SetStateAction<string>>; setSelected: React.Dispatch<React.SetStateAction<number[]>> }
  function Pager({ filter }: { filter: string }) {
    const [page, setPage] = useScopedState(filter, 1)
    const [selected, setSelected] = useScopedState<number[]>(filter, [])
    const [draft, setDraft] = useState('unsaved')
    useLayoutEffect(() => { api = { page, setPage, draft, setDraft, setSelected } })
    useEffect(() => { commits.push({ filter, page, selected }) }, [filter, page, selected])
    return <output>{filter}:{page}</output>
  }
  await act(async () => root.render(<Pager filter="A" />))
  const staleSetter = api.setPage
  await act(async () => { api.setPage(4); api.setSelected([11]); api.setDraft('keep me') })
  check(api.setPage === staleSetter, 'setter must stay stable within a scope')
  await act(async () => root.render(<Pager filter="B" />))
  check(api.page === 1 && api.draft === 'keep me', 'reset pagination without resetting an unrelated draft')
  check(commits.filter(item => item.filter === 'B').every(item => item.page === 1 && !item.selected.length), 'no stale page or bulk selection may reach committed effects')
  await act(async () => { api.setPage(previous => previous + 1) })
  check(api.page === 2, 'functional pagination must work after reset')
  await act(async () => staleSetter(9))
  check(api.page === 2, 'late setter from an old filter must not overwrite current page')
  await act(async () => root.render(<Pager filter="A" />))
  await act(async () => staleSetter(9))
  check(api.page === 1, 'returning to an old filter must not revive old setters or old page')
  await act(async () => root.render(null))
}

async function taskDetailTests() {
  const attempts = new Map<number, ReturnType<typeof deferred<any[]>>>()
  const contexts = new Map<number, ReturnType<typeof deferred<any>>>()
  let rows = [1, 2, 3].map(id => ({ id, novelId: id, type: 'init', status: 'success', title: `task-${id}`, createdAt: 1, updatedAt: 1 }))
  Object.assign(window, { electron: {
    task: {
      query: async () => ({ items: rows, page: 1, pageSize: 10, total: rows.length, hasMore: false }),
      getStats: async () => ({ total: rows.length }),
      modelAttempts: (id: number) => { const request = deferred<any[]>(); attempts.set(id, request); return request.promise },
    },
    novel: { getContextStatus: (id: number) => { const request = deferred<any>(); contexts.set(id, request); return request.promise } },
  } })
  await act(async () => root.render(<MemoryRouter><TaskCenter /></MemoryRouter>))
  check(attempts.has(1) && contexts.has(1), 'first task is selected without a selection synchronization effect')
  await act(async () => {
    attempts.get(1)!.resolve([{ request_id: 'a', model_id: 'MODEL_A', provider: 'fixture', started_at: 1 }])
    contexts.get(1)!.resolve({ contextVersion: 101, totalChapterCount: 11 })
  })
  await click([...document.querySelectorAll('.ant-collapse-header')].find(item => item.textContent?.includes('模型调用记录')) || null)
  check(text().includes('MODEL_A') && text().includes('v101'), 'first task result visible')
  await click(container.querySelectorAll('.task-center-list button')[1])
  await click([...document.querySelectorAll('.ant-collapse-header')].find(item => item.textContent?.includes('模型调用记录')) || null)
  check(!text().includes('MODEL_A') && !text().includes('v101'), 'switch hides previous model attempts and novel context immediately')
  check(text().includes('正在读取模型调用记录'), 'new task keeps its own loading indicator')
  await click(container.querySelectorAll('.task-center-list button')[2])
  await click([...document.querySelectorAll('.ant-collapse-header')].find(item => item.textContent?.includes('模型调用记录')) || null)
  await act(async () => {
    attempts.get(2)!.resolve([{ request_id: 'b', model_id: 'STALE_MODEL_B', provider: 'fixture', started_at: 1 }])
    contexts.get(2)!.resolve({ contextVersion: 202 })
  })
  check(!text().includes('STALE_MODEL_B') && !text().includes('v202'), 'late result from another task must be ignored')
  await act(async () => {
    attempts.get(3)!.reject(new Error('fixture failure'))
    contexts.get(3)!.reject(new Error('fixture failure'))
  })
  check(text().includes('模型调用记录暂时无法读取') && text().includes('无法读取'), 'current request failures remain visible')
  rows = []
  await click(button('刷新'))
  check(!text().includes('模型调用记录暂时无法读取') && !text().includes('上下文版本'), 'empty task list clears details and stale errors')
  await act(async () => root.render(null))
}

async function patchIsolationTests() {
  const pending = deferred<any>()
  let suggestCalls = 0
  let applied = 0
  Object.assign(window, { electron: { aiPatch: {
    suggest: () => { suggestCalls += 1; return pending.promise },
    apply: async () => { applied += 1 },
  } } })
  const render = (id: number) => root.render(<AiPatchEditor target={{ type: 'character', id }} />)
  await act(async () => render(1))
  await click(button('定向AI修改'))
  const field = document.querySelector<HTMLTextAreaElement>('.novel-ai-patch-editor textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'preserve character identity')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(button('生成修改建议'))
  check(suggestCalls === 1, 'real patch component starts a request')
  await act(async () => render(2))
  await act(async () => pending.resolve({ summary: 'STALE_PATCH', target: { type: 'character', id: 1 }, changedFields: [{ field: 'name', label: 'Name', before: 'a', after: 'b' }], warnings: [], patch: { name: 'b' } }))
  await click(button('定向AI修改'))
  check(!text().includes('STALE_PATCH') && !button('应用修改'), 'old candidate cannot be applied to a new target')
  check(document.querySelector<HTMLTextAreaElement>('.novel-ai-patch-editor textarea')?.value === '' && applied === 0, 'new target starts with an empty instruction and no writes')
  await act(async () => root.render(null))
}


async function asyncSnapshotTests() {
  let api!: ReturnType<typeof useAsyncSnapshot<string>>
  const requests: Array<{ owner: string; pending: ReturnType<typeof deferred<string>> }> = []
  const reader = (owner: string) => () => {
    const pending = deferred<string>()
    requests.push({ owner, pending })
    return pending.promise
  }
  const readA = reader('A')
  const readB = reader('B')
  function Snapshot({ read }: { read: () => Promise<string> }) {
    const value = useAsyncSnapshot(read)
    useLayoutEffect(() => { api = value })
    return <output>{value.loading ? 'loading:' : 'ready:'}{value.data}</output>
  }
  const render = (read: () => Promise<string>) => root.render(<React.StrictMode><Snapshot read={read} /></React.StrictMode>)
  await act(async () => render(readA))
  check(api.loading && api.data === null, 'initial snapshot exposes loading before a result')
  check(requests.length === 2, 'StrictMode repeats effect setup for cleanup verification')
  await act(async () => requests[0].pending.resolve('discarded strict effect'))
  check(api.data === null && api.loading, 'StrictMode cleanup invalidates the first read')
  await act(async () => requests[1].pending.resolve('A1'))
  check(api.data === 'A1' && !api.loading, 'latest initial read settles')
  const staleReload = api.reload
  await act(async () => { void api.reload() })
  check(api.data === 'A1' && api.loading, 'refresh preserves previous successful data')
  await act(async () => requests[2].pending.reject(new Error('refresh failed')))
  check(api.data === 'A1' && !api.loading && api.error instanceof Error, 'failed refresh keeps usable data and exposes error')
  await act(async () => { void api.reload(); void api.reload() })
  await act(async () => requests[4].pending.resolve('A2'))
  await act(async () => requests[3].pending.reject(new Error('stale failure')))
  check(api.data === 'A2' && !api.loading && api.error === null, 'older refresh failure cannot replace newer success')
  await act(async () => { void api.reload() })
  await act(async () => render(readB))
  check(api.data === null && api.error === null && api.loading, 'new owner cannot show previous data or errors')
  const readCount = requests.length
  await act(async () => { await staleReload() })
  check(requests.length === readCount, 'old reload cannot issue a read or cancel the new owner request')
  await act(async () => requests[5].pending.resolve('stale A'))
  check(api.data === null && api.loading, 'old owner response is ignored')
  await act(async () => requests[6].pending.resolve('B1'))
  check(api.data === 'B1' && !api.loading, 'new owner request survives calls to stale reload')
  await act(async () => render(readA))
  await act(async () => { await staleReload() })
  check(requests.length === readCount + 1, 'A to B to A does not reactivate old reload')
  await act(async () => requests[7].pending.resolve('A3'))
  check(api.data === 'A3', 'returning owner receives only fresh data')
  const broken = (): Promise<string> => { throw new Error('sync IPC failure') }
  await act(async () => render(broken))
  check(!api.loading && api.data === null && api.error instanceof Error, 'synchronous IPC errors settle without an unhandled rejection')
  await act(async () => render(readB))
  const unmountedReload = api.reload
  const finalRead = requests.at(-1)!
  await act(async () => root.render(null))
  const beforeUnmountedReload = requests.length
  await act(async () => { await unmountedReload(); finalRead.pending.resolve('unmounted') })
  check(requests.length === beforeUnmountedReload, 'unmounted reload cannot read again')
}

async function snapshotRevisionTests() {
  let api!: ReturnType<typeof useAsyncSnapshot<string>>
  const reads: Array<ReturnType<typeof deferred<string>>> = []
  const read = () => { const pending = deferred<string>(); reads.push(pending); return pending.promise }
  const observations: string[] = []
  function Snapshot({ revision }: { revision: number }) {
    const value = useAsyncSnapshot(read, revision)
    useLayoutEffect(() => { api = value; observations.push(`${revision}:${value.loading}:${value.data}`) })
    return null
  }
  const render = (revision: number) => root.render(<Snapshot revision={revision} />)
  await act(async () => render(0))
  await act(async () => reads[0].resolve('saved'))
  await act(async () => render(1))
  check(api.loading && api.data === 'saved', 'external revision keeps the successful snapshot while reading')
  check(observations.at(-1) === '1:true:saved', 'external revision exposes loading before committing children')
  await act(async () => render(2))
  await act(async () => reads[1].resolve('obsolete revision'))
  check(api.loading && api.data === 'saved', 'superseded revision cannot settle the new revision')
  await act(async () => reads[2].reject(new Error('revision failed')))
  check(!api.loading && api.data === 'saved' && api.error instanceof Error, 'failed external refresh retains successful data')
  await act(async () => render(3))
  check(api.loading && api.error === null && api.data === 'saved', 'next external revision clears the old error without clearing data')
  await act(async () => reads[3].resolve('updated'))
  check(!api.loading && api.data === 'updated', 'latest external revision commits its result')
  await act(async () => root.render(null))
}

async function workflowIsolationTests() {
  let api!: ReturnType<typeof useCreativeWorkflow>
  const requests: Array<{ tool: string; novelId: number; pending: ReturnType<typeof deferred<any>> }> = []
  Object.assign(window, { electron: { agentTools: { call: ({ toolId, input }: { toolId: string; input: { novelId: number } }) => {
    const pending = deferred<any>()
    requests.push({ tool: toolId, novelId: input.novelId, pending })
    return pending.promise
  } } } })
  let completions = 0
  const completed = () => { completions += 1 }
  window.addEventListener('novelforge:creative-completed', completed)
  const result = (novelId: number, status = 'running') => ({ ok: true, data: { run: { runId: novelId, novelId, status, step: status === 'completed' ? 'completed' : 'generating', updatedAt: novelId } } })
  function Workflow({ novelId }: { novelId: number }) {
    const value = useCreativeWorkflow(novelId)
    useLayoutEffect(() => { api = value })
    return <output>{value.run?.novelId}</output>
  }
  await act(async () => root.render(<Workflow novelId={1} />))
  const staleRefresh = api.refresh
  await act(async () => { void api.review(11, 'review first novel') })
  check(api.submitting && requests.length === 2, 'review is pending while initial poll runs')
  await act(async () => root.render(<Workflow novelId={2} />))
  check(!api.submitting && api.run === null && api.error === '' && requests[2].novelId === 2, 'new novel resets state and starts its own poll immediately')
  await act(async () => requests[0].pending.resolve(result(1, 'completed')))
  await act(async () => { await api.refresh(); await staleRefresh() })
  check(requests.length === 3, 'old finally cannot unlock the new poll; stale refresh cannot read the old novel')
  await act(async () => requests[1].pending.resolve(result(1, 'completed')))
  check(api.run === null && completions === 0, 'late review cannot write or emit completion for another novel')
  await act(async () => requests[2].pending.resolve(result(2)))
  check(api.run?.novelId === 2 && !api.submitting, 'current poll still commits')
  await act(async () => { void api.refresh() })
  await act(async () => requests[3].pending.reject(new Error('current read failed')))
  check(api.error === 'current read failed' && api.run?.novelId === 2, 'current refresh error preserves the last run')
  await act(async () => { void api.refresh() })
  await act(async () => requests[4].pending.resolve(result(2, 'completed')))
  check(completions === 1 && api.error === '', 'current completion emits once and clears the error')
  await act(async () => { void api.refresh() })
  await act(async () => requests[5].pending.resolve(result(2, 'completed')))
  check(completions === 1, 'repeated poll must not duplicate completion events')
  await act(async () => root.render(<Workflow novelId={1} />))
  const beforeStaleCalls = requests.length
  await act(async () => { await staleRefresh() })
  check(requests.length === beforeStaleCalls, 'A to B to A must not reactivate a stale workflow refresh')
  await act(async () => requests.at(-1)!.pending.resolve(result(1)))
  check(api.run?.novelId === 1, 'fresh poll survives a stale refresh after returning to the same novel')
  const pendingPoll = requests.length
  await act(async () => { void api.refresh() })
  await act(async () => { void api.start({ stage: 'chapter', request: 'revise the current chapter', autoApply: false }); void api.review(11, 'duplicate mutation') })
  check(requests.length === pendingPoll + 2 && api.submitting, 'one mutation holds the lock while an earlier poll is pending')
  await act(async () => requests[pendingPoll].pending.resolve(result(1, 'completed')))
  check(api.run?.step === 'generating' && completions === 1, 'a pre-mutation poll cannot replace the active run or notify completion')
  await act(async () => requests[pendingPoll + 1].pending.resolve(result(1)))
  check(!api.submitting && api.run?.step === 'generating', 'the latest mutation releases its lock and installs its own result')
  await act(async () => root.render(null))
  window.removeEventListener('novelforge:creative-completed', completed)
}


async function stagePlannerTests() {
  const contextReads: Array<{ stageId: number; novelId: number; pending: ReturnType<typeof deferred<any>> }> = []
  const evaluation = deferred<any>()
  const report = (summary: string) => ({ status: 'passed', score: 90, confidenceLowerBound: 80, coverageRate: 100, summary, blockers: [], warnings: [], findings: [] })
  const stages = (novelId: number) => [1, 2].map(id => ({ id, novelId, name: 'novel-' + novelId + '-stage-' + id, kind: 'chapter-window', status: id === 1 ? 'active' : 'planned', sequence: id, chapterStart: id, chapterEnd: id, coreAssetCount: 0, activeAssetCount: 0, plannedAssetCount: 0 }))
  const context = (label: string) => ({ assets: [], health: { status: 'ready', hardBlockers: [], warnings: [] }, packet: { chapterRange: label, focusAssets: [], projectContextVersion: 1, stageContextVersion: 1 }, quality: { status: 'healthy', warnings: [], trend: { status: 'stable', points: [], repeatedIssueKeys: [], summary: '' } } })
  Object.assign(window, { electron: {
    creativeStage: {
      list: async (novelId: number) => stages(novelId),
      getContext: (novelId: number, stageId: number) => { const pending = deferred<any>(); contextReads.push({ novelId, stageId, pending }); return pending.promise },
      listHandoffs: async () => [],
    },
    agentTools: { call: async ({ toolId }: { toolId: string }) => {
      if (toolId === 'novelforge.quality.run_evaluation') return evaluation.promise
      return { ok: true, data: { artifacts: [] } }
    } },
  } })
  sessionStorage.setItem('novelforge-stage-planner:1', '2')
  sessionStorage.setItem('novelforge-stage-planner:2', '1')
  const render = (novelId: number) => root.render(<StagePlanner novelId={novelId} />)
  await act(async () => render(1))
  check(contextReads.length === 1 && contextReads[0].stageId === 2, 'stage planner restores the saved stage without briefly reading a fallback stage')
  await act(async () => contextReads[0].pending.resolve(context('current-stage-two')))
  check(text().includes('current-stage-two'), 'current stage context is rendered')
  await click(button('运行质量评审'))
  await click(container.querySelector('[data-stage-id="1"]'))
  check(!text().includes('current-stage-two'), 'stage switch immediately hides previous context')
  await act(async () => evaluation.resolve({ ok: true, data: { report: report('STALE_EVALUATION') } }))
  await act(async () => contextReads[1].pending.resolve(context('current-stage-one')))
  check(text().includes('current-stage-one') && !text().includes('STALE_EVALUATION'), 'late evaluation cannot become another stage report')
  await click(container.querySelector('[data-stage-id="2"]'))
  await click(container.querySelector('[data-stage-id="1"]'))
  await act(async () => contextReads[2].pending.resolve(context('STALE_CONTEXT')))
  check(!text().includes('STALE_CONTEXT'), 'late context from another stage is ignored')
  await act(async () => contextReads[3].pending.resolve(context('new-stage-one')))
  check(text().includes('new-stage-one'), 'returning stage uses a fresh context')
  const handoffField = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(handoffField, 'unsaved handoff')
    handoffField.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => render(1))
  check(container.querySelector('textarea')?.value === 'unsaved handoff', 'unrelated rerender preserves handoff edits')
  await act(async () => render(2))
  check(!text().includes('novel-1-stage') && !text().includes('new-stage-one'), 'changing novel clears previous stage data')
  check(contextReads.at(-1)?.novelId === 2 && contextReads.at(-1)?.stageId === 1, 'new novel restores its own saved selection')
  check(container.querySelector('textarea')?.value !== 'unsaved handoff', 'handoff draft is not reused across novels')
  await act(async () => contextReads.at(-1)!.pending.resolve(context('novel-two-context')))
  check(text().includes('novel-two-context'), 'new novel loads normally after identity reset')
  await act(async () => root.render(null))
  sessionStorage.removeItem('novelforge-stage-planner:1')
  sessionStorage.removeItem('novelforge-stage-planner:2')
}


async function atlasDraftTests() {
  let navigate!: ReturnType<typeof useNavigate>
  const reads: Array<ReturnType<typeof deferred<any>>> = []
  const writes: any[] = []
  const entity = { id: 'character:1', novelId: 1, kind: 'character', name: 'fixture character', summary: 'original summary', attributes: {}, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'human', note: 'fixture' } }
  Object.assign(window, { electron: {
    chapter: { list: async () => [] },
    storyAtlas: {
      query: () => { const pending = deferred<any>(); reads.push(pending); return pending.promise },
      apply: async (input: unknown) => { writes.push(input); return {} },
    },
  } })
  function RouteControl() { const value = useNavigate(); useLayoutEffect(() => { navigate = value }); return null }
  await act(async () => root.render(<MemoryRouter initialEntries={['/?tab=characters&entity=character%3A1']}><RouteControl /><WorldAndCast novelId={1} /></MemoryRouter>))
  await act(async () => reads[0].resolve({ novelId: 1, contextVersion: 7, entities: [entity], relations: [], diagnostics: [] }))
  await click(button('编辑'))
  const field = document.querySelector<HTMLInputElement>('input[aria-label="名称"]')!
  check(field, 'atlas editor is open')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'keep unsaved name')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => navigate('/?tab=characters&entity=character%3A1&atChapter=2'))
  check(document.querySelector<HTMLInputElement>('input[aria-label="名称"]')?.value === 'keep unsaved name', 'filter loading must not unmount an open editor or discard its draft')
  await act(async () => reads[1].reject(new Error('filtered read failed')))
  check(document.querySelector<HTMLInputElement>('input[aria-label="名称"]')?.value === 'keep unsaved name', 'failed filtered read preserves the draft')
  await click(button('保存'))
  check(writes.length === 1 && writes[0].expectedContextVersion === 7 && writes[0].effectiveFromChapter === 0, 'save retains the original context version and effective chapter')
  check(writes[0].changes[0].name === 'keep unsaved name', 'save sends the preserved draft')
  await act(async () => reads[2].resolve({ novelId: 1, contextVersion: 8, entities: [{ ...entity, name: 'keep unsaved name' }], relations: [], diagnostics: [] }))
  await act(async () => root.render(null))
}

Object.assign(window, { runHooksStateTests: async () => {
  await scopedStateTests()
  await asyncSnapshotTests()
  await snapshotRevisionTests()
  await workflowIsolationTests()
  await stagePlannerTests()
  await atlasDraftTests()
  await runLoadFormTests(root)
  await runDashboardDraftTests(root)
  await runLifecycleTests(root)
  await runEditableListTests(root)
  await runBoundaryTests(root)
  await taskDetailTests()
  await patchIsolationTests()
  return 'Hooks browser regressions passed: scoped pagination, async snapshot refresh, external revision and isolation, growth/arc/resistance draft refresh and save, workflow polling and review isolation, stage context and quality isolation, atlas draft preservation, routed composer, endgame and volume drafts, imported details, source key draft, chat/quality lifecycles, version feedback and races, timeline cascade, contracts, editable lists, routed identity and pending-save drafts, recoverable load failures, batch selection, task polling, task details, AI patch isolation'
} })
