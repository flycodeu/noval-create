import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { promptOverrideAudits, promptOverrides } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\uFEFF/g, '')
    .trim()
}

function stringifyParam(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyParam(item))
      .filter(Boolean)
      .join('\n')
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export interface PromptOverrideRecord {
  key: string
  content: string
  updatedAt: string
}

const CHAPTER_PROMPT_KEYS = new Set([
  'scenePlan',
  'chapterDraft',
  'chapterWriting',
  'chapterReview',
  'chapterRewrite',
])

const PROTECTED_RULES = [
  '不可覆盖规则：保留反 AI 味禁用表达与“动作/细节替代抽象情绪”的要求。',
  '不可覆盖规则：保留角色差异化与 Voice Lock，不允许所有角色说成同一语气。',
  '不可覆盖规则：保留 POV 边界，只能写当前视角已知信息，禁止段内偷切视角。',
  '不可覆盖规则：保留锁定段落逐字不改的要求，只能调整周边衔接。',
  '不可覆盖规则：保留章节开头承接上章结尾、章尾留下自然钩子的要求。',
]

function normalizeRecord(row: typeof promptOverrides.$inferSelect): PromptOverrideRecord {
  return {
    key: row.key,
    content: row.content,
    updatedAt: row.updatedAt || '',
  }
}

function clipPreview(value: string): string {
  const normalized = normalizeText(value)
  if (normalized.length <= 220) return normalized
  return `${normalized.slice(0, 219).trim()}…`
}

function getProtectedRuleCount(key: string): number {
  return CHAPTER_PROMPT_KEYS.has(key) ? PROTECTED_RULES.length : 0
}

function recordAudit(key: string, action: 'save' | 'delete' | 'apply', contentPreview = ''): void {
  const db = getDb()
  db.insert(promptOverrideAudits).values({
    key,
    action,
    protectedRuleCount: getProtectedRuleCount(key),
    contentPreview: contentPreview ? clipPreview(contentPreview) : null,
  }).run()
}

function buildProtectedFooter(key: string): string {
  if (!CHAPTER_PROMPT_KEYS.has(key)) return ''
  return [
    '【系统保留规则】',
    ...PROTECTED_RULES.map((item) => `- ${item}`),
  ].join('\n')
}

export function listPromptOverrides(): PromptOverrideRecord[] {
  const db = getDb()
  return db.select().from(promptOverrides).all().map(normalizeRecord)
}

export function getPromptOverride(key: string): PromptOverrideRecord | null {
  const db = getDb()
  const row = db.select().from(promptOverrides).where(eq(promptOverrides.key, key)).all()[0]
  return row ? normalizeRecord(row) : null
}

export function savePromptOverride(key: string, content: string): void {
  const db = getDb()
  const normalizedKey = key.trim()
  if (!normalizedKey) {
    throwUserFacingError('prompt.keyRequired')
  }

  const normalizedContent = normalizeText(content)
  if (!normalizedContent) {
    deletePromptOverride(normalizedKey)
    return
  }

  const now = new Date().toISOString()
  const existing = getPromptOverride(normalizedKey)
  if (existing) {
    db.update(promptOverrides).set({
      content: normalizedContent,
      updatedAt: now,
    }).where(eq(promptOverrides.key, normalizedKey)).run()
    recordAudit(normalizedKey, 'save', normalizedContent)
    return
  }

  db.insert(promptOverrides).values({
    key: normalizedKey,
    content: normalizedContent,
    updatedAt: now,
  }).run()
  recordAudit(normalizedKey, 'save', normalizedContent)
}

export function deletePromptOverride(key: string): void {
  const db = getDb()
  const normalizedKey = key.trim()
  db.delete(promptOverrides).where(eq(promptOverrides.key, normalizedKey)).run()
  recordAudit(normalizedKey, 'delete')
}

export function applyPromptOverride(
  key: string,
  fallback: string,
  params: Record<string, unknown>,
): string {
  const override = getPromptOverride(key)
  if (!override?.content?.trim()) {
    return fallback
  }

  const overridden = override.content.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, token: string) => {
    return stringifyParam(params[token])
  })
  const protectedFooter = buildProtectedFooter(key)
  const finalPrompt = protectedFooter
    ? `${overridden}\n\n${protectedFooter}`
    : overridden
  recordAudit(key, 'apply', finalPrompt)
  return finalPrompt
}
