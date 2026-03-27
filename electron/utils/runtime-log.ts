import fs from 'fs'
import path from 'path'
import { app } from 'electron'

type RuntimeLogLevel = 'info' | 'warn' | 'error'

interface RuntimeLogOptions {
  consoleSummary?: string
  context?: Record<string, unknown>
  error?: unknown
}

type SerializableValue =
  | null
  | boolean
  | number
  | string
  | SerializableValue[]
  | { [key: string]: SerializableValue }

function getFallbackLogDir(): string {
  return path.join(process.cwd(), '.runtime-logs')
}

function getRuntimeLogDir(): string {
  try {
    if (app.isReady()) return path.join(app.getPath('userData'), 'logs')
  } catch {
    // Fall back to the working directory before Electron app paths are available.
  }
  return getFallbackLogDir()
}

function getRuntimeLogPath(): string {
  return path.join(getRuntimeLogDir(), 'main-runtime.log')
}

function ensureRuntimeLogDir(): void {
  fs.mkdirSync(getRuntimeLogDir(), { recursive: true })
}

function serializeUnknown(value: unknown, seen = new Set<unknown>()): SerializableValue {
  if (value === undefined) return null
  if (
    value == null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  ) return value

  if (typeof value === 'bigint') return value.toString()

  if (value instanceof Error) {
    if (seen.has(value)) return '[Circular Error]'
    seen.add(value)
    const typed = value as Error & { code?: string; cause?: unknown }
    const payload: Record<string, SerializableValue> = {
      name: typed.name,
      message: typed.message,
      stack: typed.stack || '',
    }
    if (typed.code) payload.code = typed.code
    if (typed.cause !== undefined) payload.cause = serializeUnknown(typed.cause, seen)
    return payload
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular Array]'
    seen.add(value)
    return value.map((item) => serializeUnknown(item, seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular Object]'
    seen.add(value)
    const record = value as Record<string, unknown>
    const next: Record<string, SerializableValue> = {}
    Object.entries(record).forEach(([key, item]) => {
      next[key] = serializeUnknown(item, seen)
    })
    return next
  }

  return String(value)
}

function writeConsole(level: RuntimeLogLevel, summary: string): void {
  if (level === 'error') console.error(summary)
  else if (level === 'warn') console.warn(summary)
  else console.log(summary)
}

function writeRuntimeLog(level: RuntimeLogLevel, channel: string, message: string, options: RuntimeLogOptions = {}): void {
  const consoleSummary = options.consoleSummary || `[${channel}:${level}] detail written to runtime log`
  writeConsole(level, consoleSummary)

  try {
    ensureRuntimeLogDir()
    const payload: Record<string, SerializableValue> = {
      timestamp: new Date().toISOString(),
      level,
      channel,
      message,
    }
    if (options.context) payload.context = serializeUnknown(options.context)
    if (options.error !== undefined) payload.error = serializeUnknown(options.error)
    fs.appendFileSync(getRuntimeLogPath(), `${JSON.stringify(payload)}\n`, 'utf8')
  } catch (logError) {
    writeConsole('warn', `[logger:warn] failed to write runtime log`)
    void logError
  }
}

export function logInfo(channel: string, message: string, options?: RuntimeLogOptions): void {
  writeRuntimeLog('info', channel, message, options)
}

export function logWarn(channel: string, message: string, options?: RuntimeLogOptions): void {
  writeRuntimeLog('warn', channel, message, options)
}

export function logError(channel: string, message: string, options?: RuntimeLogOptions): void {
  writeRuntimeLog('error', channel, message, options)
}
