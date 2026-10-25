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
const STRING_LIMITS: Array<[keyof InspirationDraft, number]> = [
  ['seed', 6000], ['constraints', 3000], ['direction', 2400], ['directionBasis', 8000], ['title', 100], ['synopsis', 2000], ['request', 1500],
]
function hasValidDraftScalars(value: InspirationDraft): boolean {
  if (value.version !== 1 || typeof value.draftId !== 'string' || value.draftId.length < 8) return false
  if (!Number.isInteger(value.step) || value.step < 0 || value.step > 2) return false
  return STRING_LIMITS.every(([key, max]) => typeof value[key] === 'string' && String(value[key]).length <= max)
}
function sanitizeDraftRun(value: InspirationDraft, kind: 'directions' | 'packaging') {
  const run = value[kind]
  if (!run) return
  try {
    const validTask = Number.isSafeInteger(run.taskId) && run.taskId >= 1 && run.input?.draftId === value.draftId && run.input.kind === kind
    const validStrings = ['seed', 'constraints', 'direction'].every(key => typeof run.input?.[key as keyof typeof run.input] === 'string')
    if (!validTask || !validStrings) throw new Error('invalid batch')
    run.result = parseInspirationResult(run.result, kind)
  } catch { value[kind] = undefined }
}
function sanitizeDraftSelections(value: InspirationDraft) {
  if (value.selectedDirection) {
    try {
      if (!Number.isSafeInteger(value.selectedDirection.taskId) || !/^direction-[1-3]$/u.test(value.selectedDirection.item.id)) throw new Error('invalid selection')
      parseInspirationResult({ directions: [value.selectedDirection.item] }, 'directions')
    } catch { value.selectedDirection = undefined }
  }
  if (value.selectedPackage) {
    try {
      if (!Number.isSafeInteger(value.selectedPackage.taskId) || !/^package-[1-3]$/u.test(value.selectedPackage.item.id) || typeof value.selectedPackage.basis !== 'string') throw new Error('invalid selection')
      parseInspirationResult({ packages: [value.selectedPackage.item] }, 'packaging')
    } catch { value.selectedPackage = undefined }
  }
}
export function readInspirationDraft(): InspirationDraft | null {
  try {
    const raw = sessionStorage.getItem(INSPIRATION_DRAFT_KEY)
    if (!raw || raw.length > 80000) return null
    const value = JSON.parse(raw) as InspirationDraft
    if (!hasValidDraftScalars(value)) return null
    if (value.taskId !== undefined && (!Number.isSafeInteger(value.taskId) || value.taskId < 1)) value.taskId = undefined
    sanitizeDraftRun(value, 'directions')
    sanitizeDraftRun(value, 'packaging')
    sanitizeDraftSelections(value)
    if (value.creationRequest && (typeof value.creationRequest !== 'object' || Array.isArray(value.creationRequest))) value.creationRequest = undefined
    return value
  } catch { return null }
}
export function saveInspirationDraft(draft: InspirationDraft) {
  try { sessionStorage.setItem(INSPIRATION_DRAFT_KEY, JSON.stringify(draft)) } catch { console.warn('构思草稿未能写入会话存储，关闭标签页前请保留填写内容。') }
}
