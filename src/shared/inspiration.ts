import { formatUserFacingMessage } from './user-facing-messages'
export type InspirationKind = 'directions' | 'packaging'
export interface InspirationDirection { id: string; title: string; premise: string; conflict: string }
export interface InspirationPackage { id: string; title: string; synopsis: string }
export interface InspirationInput {
  draftId: string; requestId: string; kind: InspirationKind; seed: string; constraints: string
  direction: string; request: string; modelConfigId?: number
}
export interface InspirationRun {
  taskId: number; status: string; error?: string; kind: InspirationKind; input: InspirationInput
  result?: { directions?: InspirationDirection[]; packages?: InspirationPackage[] }
}
export interface InspirationSource { draftId: string; seed: string; directionTaskId?: number; directionId?: string; packagingTaskId?: number; packagingId?: string }
export function inspirationBasis(seed: string, constraints: string, direction = '') { return JSON.stringify([seed.trim(), constraints.trim(), direction.trim()]) }
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function field(value: unknown, label: string, limit: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(formatUserFacingMessage('author.inspiration.invalidField', { label: label }))
  return value.trim()
}
export function parseInspirationResult(value: unknown, kind: InspirationKind): NonNullable<InspirationRun['result']> {
  const input = record(value), rows = kind === 'directions' ? input.directions : input.packages
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 3) throw new Error(formatUserFacingMessage('author.inspiration.invalidCandidates'))
  if (kind === 'directions') return { directions: rows.map((value, index) => {
    const row = record(value)
    return { id: `direction-${index + 1}`, title: field(row.title, '方向标题', 80), premise: field(row.premise, '故事方向', 1200), conflict: field(row.conflict, '核心冲突', 800) }
  }) }
  return { packages: rows.map((value, index) => { const row = record(value); return { id: `package-${index + 1}`, title: field(row.title, '书名', 100), synopsis: field(row.synopsis, '简介', 2000) } }) }
}
