import { throwUserFacingError } from './user-facing-error'

export function requireId(value: unknown, name = 'id'): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
    throwUserFacingError('ipc.invalidPositiveInteger', { name, value: String(value) })
  return n
}

export function requireIds(value: unknown, name = 'ids'): number[] {
  if (!Array.isArray(value) || value.length === 0)
    throwUserFacingError('ipc.invalidNonEmptyArray', { name })
  return value.map((v, i) => requireId(v, `${name}[${i}]`))
}

export function requireObject<T extends object = Record<string, unknown>>(value: unknown, name = 'data'): T {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throwUserFacingError('ipc.invalidObject', { name })
  return value as T
}

export function parseObjectPayload<T extends object = Record<string, unknown>>(value: unknown, name = 'data'): T {
  return requireObject<T>(value, name)
}

export function requireString(value: unknown, name = 'value'): string {
  if (typeof value !== 'string' || value.trim() === '')
    throwUserFacingError('ipc.invalidNonEmptyString', { name })
  return value
}

export function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined
  return typeof value === 'string' ? value : String(value)
}
