import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { promptOverrides } from '../database/schema'

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

export function listPromptOverrides(): PromptOverrideRecord[] {
  const db = getDb()
  return db.select().from(promptOverrides).all()
}

export function getPromptOverride(key: string): PromptOverrideRecord | null {
  const db = getDb()
  return db.select().from(promptOverrides).where(eq(promptOverrides.key, key)).all()[0] || null
}

export function savePromptOverride(key: string, content: string): void {
  const db = getDb()
  const normalizedKey = key.trim()
  if (!normalizedKey) {
    throw new Error('Prompt key is required')
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
    return
  }

  db.insert(promptOverrides).values({
    key: normalizedKey,
    content: normalizedContent,
    updatedAt: now,
  }).run()
}

export function deletePromptOverride(key: string): void {
  const db = getDb()
  db.delete(promptOverrides).where(eq(promptOverrides.key, key.trim())).run()
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

  return override.content.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, token: string) => {
    return stringifyParam(params[token])
  })
}
