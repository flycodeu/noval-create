import { parseInspirationResult, type InspirationDirection, type InspirationPackage, type InspirationRun } from '../../shared/inspiration'

export const INSPIRATION_DRAFT_KEY = 'novelforge.inspiration.v1'
export interface InspirationInitial { title?: string; userBackground?: string; constraints?: string; modelConfigId?: number; genreId?: number; targetWords?: number }
export interface InspirationDraft {
  version: 1; draftId: string; step: number; seed: string; constraints: string; direction: string; directionBasis: string
  title: string; synopsis: string; request: string; modelConfigId?: number; genreId?: number; targetWords?: number
  taskId?: number; directions?: InspirationRun; packaging?: InspirationRun
  selectedDirection?: { taskId: number; item: InspirationDirection }
  selectedPackage?: { taskId: number; item: InspirationPackage; basis: string }
  creationRequest?: Record<string, unknown>
}
export function createInspirationDraft(initial: InspirationInitial = {}): InspirationDraft {
  return { version: 1, draftId: crypto.randomUUID(), step: 0, seed: initial.userBackground || '', constraints: initial.constraints || '',
    direction: '', directionBasis: '', title: initial.title || '', synopsis: '', request: '', modelConfigId: initial.modelConfigId, genreId: initial.genreId, targetWords: initial.targetWords }
}
export function readInspirationDraft(): InspirationDraft | null {
  try {
    const raw = sessionStorage.getItem(INSPIRATION_DRAFT_KEY)
    if (!raw || raw.length > 80000) return null
    const value = JSON.parse(raw) as InspirationDraft
    if (value.version !== 1 || typeof value.draftId !== 'string' || value.draftId.length < 8 || !Number.isInteger(value.step) || value.step < 0 || value.step > 2) return null
    if (['seed', 'constraints', 'direction', 'directionBasis', 'title', 'synopsis', 'request'].some(key => typeof value[key as keyof InspirationDraft] !== 'string')) return null
    if (value.seed.length > 6000 || value.constraints.length > 3000 || value.direction.length > 2400 || value.title.length > 100 || value.synopsis.length > 2000 || value.request.length > 1500) return null
    if (value.taskId !== undefined && (!Number.isSafeInteger(value.taskId) || value.taskId < 1)) value.taskId = undefined
    for (const kind of ['directions', 'packaging'] as const) {
      const run = value[kind]
      if (!run) continue
      try {
        if (!Number.isSafeInteger(run.taskId) || run.taskId < 1 || run.input?.draftId !== value.draftId || run.input.kind !== kind || ['seed', 'constraints', 'direction'].some(key => typeof run.input[key as keyof typeof run.input] !== 'string')) throw new Error('invalid batch')
        run.result = parseInspirationResult(run.result, kind)
      } catch { value[kind] = undefined }
    }
    if (value.selectedDirection) {
      try { if (!Number.isSafeInteger(value.selectedDirection.taskId) || !/^direction-[1-3]$/u.test(value.selectedDirection.item.id)) throw new Error('invalid selection'); parseInspirationResult({ directions: [value.selectedDirection.item] }, 'directions') }
      catch { value.selectedDirection = undefined }
    }
    if (value.selectedPackage) {
      try { if (!Number.isSafeInteger(value.selectedPackage.taskId) || !/^package-[1-3]$/u.test(value.selectedPackage.item.id) || typeof value.selectedPackage.basis !== 'string') throw new Error('invalid selection'); parseInspirationResult({ packages: [value.selectedPackage.item] }, 'packaging') }
      catch { value.selectedPackage = undefined }
    }
    if (value.creationRequest && (typeof value.creationRequest !== 'object' || Array.isArray(value.creationRequest))) value.creationRequest = undefined
    return value
  } catch { return null }
}
export function saveInspirationDraft(draft: InspirationDraft) {
  try { sessionStorage.setItem(INSPIRATION_DRAFT_KEY, JSON.stringify(draft)) } catch { console.warn('构思草稿未能写入会话存储，关闭标签页前请保留填写内容。') }
}
