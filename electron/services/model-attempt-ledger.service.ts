import { createHash } from 'node:crypto'
import { getSqlite } from '../database/db'
import type { ModelRequestEvent, ModelRequestObserver } from '../../src/shared/model-call-telemetry'

// Keep the complete digest and length even when a provider returns unusually large text.
// The database stores at most this many characters per physical request.
export const MAX_RECORDED_MODEL_OUTPUT_CHARS = 524_288
export const MAX_RECORDED_MODEL_PROMPT_CHARS = 524_288

export function hashModelPrompt(messages: readonly { role: string; content: string }[], systemPrompt?: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({ systemPrompt: systemPrompt || '', messages }), 'utf8').digest('hex')}`
}

function redactKnownCredentials(value: string): string {
  let redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/giu, '[REDACTED_API_KEY]')
    .replace(/\b((?:(?:OPENAI|ANTHROPIC|DEEPSEEK|KIMI|DASHSCOPE|QIANFAN|NOVELFORGE)_)?API[_-]?KEY|AUTHORIZATION|ACCESS[_-]?TOKEN)\s*([:=])\s*["']?[^\s"']{8,}["']?/giu, '$1$2[REDACTED]')
  for (const [name, secret] of Object.entries(process.env)) {
    if (/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH)/iu.test(name) && secret && secret.length >= 8) {
      redacted = redacted.replaceAll(secret, '[REDACTED_ENV_SECRET]')
    }
  }
  return redacted
}

export function snapshotModelPrompt(messages: readonly { role: string; content: string }[], systemPrompt?: string): {
  promptHash: string
  promptText: string
  promptTruncated: boolean
} {
  const sections = [
    ...(systemPrompt ? [`<systemPrompt>\n${redactKnownCredentials(systemPrompt)}\n</systemPrompt>`] : []),
    ...messages.map((message, index) => `<${message.role} index=${index}>\n${redactKnownCredentials(message.content)}\n</${message.role}>`),
  ]
  const fullText = sections.join('\n\n')
  return {
    promptHash: hashModelPrompt(messages, systemPrompt),
    promptText: fullText.slice(0, MAX_RECORDED_MODEL_PROMPT_CHARS),
    promptTruncated: fullText.length > MAX_RECORDED_MODEL_PROMPT_CHARS,
  }
}

export function snapshotModelOptions(options: {
  temperature?: number
  maxTokens?: number
  providerOptions?: { kimiThinking?: 'enabled' | 'disabled' }
}): string {
  // Whitelist only generation controls. Never serialize headers, keys, or arbitrary provider data.
  return JSON.stringify({
    temperature: Number.isFinite(options.temperature) ? options.temperature : null,
    maxTokens: Number.isSafeInteger(options.maxTokens) ? options.maxTokens : null,
    kimiThinking: options.providerOptions?.kimiThinking || null,
  })
}

export interface ModelAttemptLedgerSink extends ModelRequestObserver {
  appendOutput: (chunk: string) => void
  recordOutput: (output: string) => void
  getPersistenceFailures: () => readonly Error[]
}

function normalizePersistenceError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

export function createModelAttemptLedgerSink(input: {
  taskId?: number | null
  novelId?: number | null
  contextPackId?: string | null
  promptHash?: string | null
  promptText?: string | null
  promptTruncated?: boolean
  optionsJson?: string | null
}): ModelAttemptLedgerSink {
  const taskId = typeof input.taskId === 'number' ? input.taskId : null
  const novelId = typeof input.novelId === 'number' ? input.novelId : null
  const contextPackId = input.contextPackId?.trim() || null
  const promptHash = input.promptHash?.trim() || null
  const promptText = input.promptText ?? null
  const promptTruncated = Number(Boolean(input.promptTruncated))
  const optionsJson = input.optionsJson ?? null
  const persistenceFailures: Error[] = []
  let activeRequestId: string | null = null
  let lastRequestId: string | null = null
  let streamedOutput = ''
  let streamChars = 0
  let streamDigest = createHash('sha256')
  let pendingHighSurrogate = ''

  const resetStream = () => {
    streamedOutput = ''
    streamChars = 0
    streamDigest = createHash('sha256')
    pendingHighSurrogate = ''
  }

  const safely = (operation: () => void) => {
    try {
      operation()
    } catch (error) {
      persistenceFailures.push(normalizePersistenceError(error))
      throw error
    }
  }

  return {
    onRequestStart: (event) => {
      activeRequestId = event.requestId
      lastRequestId = event.requestId
      resetStream()
      safely(() => insertStartedAttempt(event, { taskId, novelId, contextPackId, promptHash, promptText, promptTruncated, optionsJson }))
    },
    onRequestEnd: (event) => {
      if (pendingHighSurrogate) streamDigest.update(pendingHighSurrogate, 'utf8')
      const output = activeRequestId === event.requestId && streamChars > 0
        ? { text: redactKnownCredentials(streamedOutput).slice(0, MAX_RECORDED_MODEL_OUTPUT_CHARS), chars: streamChars, sha256: streamDigest.digest('hex'), truncated: streamChars > MAX_RECORDED_MODEL_OUTPUT_CHARS }
        : null
      activeRequestId = null
      resetStream()
      safely(() => finishAttempt(event, output))
    },
    appendOutput: (chunk) => {
      if (!activeRequestId || !chunk) return
      streamChars += chunk.length
      const next = pendingHighSurrogate + chunk
      const lastCodeUnit = next.charCodeAt(next.length - 1)
      const endsWithHighSurrogate = lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF
      pendingHighSurrogate = endsWithHighSurrogate ? next.slice(-1) : ''
      streamDigest.update(endsWithHighSurrogate ? next.slice(0, -1) : next, 'utf8')
      if (streamedOutput.length < MAX_RECORDED_MODEL_OUTPUT_CHARS) {
        streamedOutput += chunk.slice(0, MAX_RECORDED_MODEL_OUTPUT_CHARS - streamedOutput.length)
      }
    },
    recordOutput: (output) => {
      if (!lastRequestId) return
      // Chat adapters report request completion before returning their text.
      // Save it on that same physical attempt, including filtered/length outputs.
      try {
        saveOutput(lastRequestId, {
          text: redactKnownCredentials(output).slice(0, MAX_RECORDED_MODEL_OUTPUT_CHARS),
          chars: output.length,
          sha256: createHash('sha256').update(output, 'utf8').digest('hex'),
          truncated: output.length > MAX_RECORDED_MODEL_OUTPUT_CHARS,
        })
      } catch (error) {
        persistenceFailures.push(normalizePersistenceError(error))
      }
    },
    getPersistenceFailures: () => [...persistenceFailures],
  }
}

interface RecordedOutput {
  text: string
  chars: number
  sha256: string
  truncated: boolean
}

function insertStartedAttempt(
  event: ModelRequestEvent,
  scope: {
    taskId: number | null; novelId: number | null; contextPackId: string | null
    promptHash: string | null; promptText: string | null; promptTruncated: number; optionsJson: string | null
  },
): void {
  const sqlite = getSqlite()
  const insert = sqlite.transaction(() => {
    const attemptIndex = scope.taskId === null
      ? 1
      : Number((sqlite.prepare(`
          SELECT COALESCE(MAX(attempt_index), 0) + 1 AS next_index
          FROM model_request_attempts
          WHERE task_id = ?
        `).get(scope.taskId) as { next_index: number }).next_index)
    sqlite.prepare(`
      INSERT INTO model_request_attempts (
        request_id, task_id, novel_id, kind, provider, model_id,
        attempt_index, status, started_at, usage_json, completion_json,
        error_code, context_pack_id, prompt_hash, prompt_text, prompt_truncated, options_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
    `).run(
      event.requestId,
      scope.taskId,
      scope.novelId,
      event.kind,
      event.provider,
      event.modelId,
      attemptIndex,
      new Date().toISOString(),
      serialize(event.usage),
      scope.contextPackId,
      scope.promptHash,
      scope.promptText,
      scope.promptTruncated,
      scope.optionsJson,
    )
  })
  insert.immediate()
}

function finishAttempt(event: ModelRequestEvent, output: RecordedOutput | null): void {
  if (event.status === 'started') return
  const sqlite = getSqlite()
  sqlite.prepare(`
    UPDATE model_request_attempts
    SET status = ?, finished_at = ?, usage_json = ?, completion_json = ?, error_code = ?,
        output_text = COALESCE(?, output_text),
        output_sha256 = COALESCE(?, output_sha256),
        output_chars = COALESCE(?, output_chars),
        output_truncated = COALESCE(?, output_truncated)
    WHERE request_id = ? AND status = 'started'
  `).run(
    event.status,
    new Date().toISOString(),
    serialize(event.usage),
    event.completion ? serialize(event.completion) : null,
    event.errorCode?.slice(0, 120) || null,
    output?.text ?? null,
    output?.sha256 ?? null,
    output?.chars ?? null,
    output ? Number(output.truncated) : null,
    event.requestId,
  )
}

function saveOutput(requestId: string, output: RecordedOutput): void {
  getSqlite().prepare(`
    UPDATE model_request_attempts
    SET output_text = ?, output_sha256 = ?, output_chars = ?, output_truncated = ?
    WHERE request_id = ?
  `).run(output.text, output.sha256, output.chars, Number(output.truncated), requestId)
}

export function interruptStartedModelAttempts(): number {
  const result = getSqlite().prepare(`
    UPDATE model_request_attempts
    SET status = 'interrupted',
        finished_at = ?,
        error_code = 'APP_RESTART_INTERRUPTED'
    WHERE status = 'started'
  `).run(new Date().toISOString())
  return Number(result.changes)
}

export function listModelAttemptsByTask(taskId: number) {
  return getSqlite().prepare(`
    SELECT *
    FROM model_request_attempts
    WHERE task_id = ?
    ORDER BY attempt_index ASC, request_id ASC
  `).all(taskId)
}

export function listModelAttemptsForTaskTree(taskId: number) {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return []
  return getSqlite().prepare(`
    WITH RECURSIVE task_tree(id) AS (
      SELECT id FROM tasks WHERE id = ?
      UNION
      SELECT child.id FROM tasks child JOIN task_tree parent ON child.parent_task_id = parent.id
    )
    SELECT attempt.*
    FROM model_request_attempts attempt
    JOIN task_tree ON attempt.task_id = task_tree.id
    ORDER BY attempt.started_at ASC, attempt.request_id ASC
  `).all(taskId)
}
