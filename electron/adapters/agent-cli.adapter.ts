import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import { BaseAdapter, type ChatOptions, type Message, normalizeContextWindowTokens } from './base.adapter'

export type NativeAgentProvider = 'codex' | 'claude_code'

const NATIVE_AGENT_CONTEXT_WINDOWS: Record<NativeAgentProvider, number> = {
  codex: 128_000,
  claude_code: 200_000,
}

const DEFAULT_NATIVE_TIMEOUT_MS = 10 * 60 * 1000
const MAX_NATIVE_TIMEOUT_MS = 20 * 60 * 1000
const MAX_NATIVE_OUTPUT_CHARS = 4_000_000
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/u
const SAFE_COMMAND = /^[A-Za-z0-9_./\\:+,\- ]+$/u

/**
 * NovelForge owns the workflow contract. The native clients are only model
 * runtimes: they may return a candidate, but they must not mutate the
 * workspace, call tools, write files, or decide whether a draft is canonical.
 */
export const NATIVE_AGENT_SYSTEM_PROMPT = [
  '你是 NovelForge 的受控文本生成器，不是项目管理员，也不是自主代理。',
  'NovelForge 已经固定了事实、人物、时间线、章节合同、视角和质量目标；只使用调用方提供的上下文，不得补造未提供的事实。',
  '只返回请求的候选草稿或结构化结果，不要调用工具、执行命令、读取或写入文件、修改项目、发送外部请求或写入正式正文。',
  '不要把自己的判断升级为事实；遇到信息不足时保留不确定性，不要用新事件填空。',
  '你的返回值只会进入事实门、质量门、结构门、独立审校和人工 Diff，绝不是已批准正文。',
].join('\n')

export interface AgentCliInvocation {
  command: string
  args: string[]
  provider: NativeAgentProvider
}

function assertSafeModelId(modelId: string): string {
  const normalized = typeof modelId === 'string' ? modelId.trim() : ''
  if (!normalized || !SAFE_MODEL_ID.test(normalized)) {
    throw new Error('原生模型 ID 只能包含字母、数字、点、下划线、冒号、斜线、加号、@ 或短横线。')
  }
  return normalized
}

function resolveCommand(provider: NativeAgentProvider): string {
  const envName = provider === 'codex' ? 'NOVELFORGE_CODEX_COMMAND' : 'NOVELFORGE_CLAUDE_COMMAND'
  const configured = process.env[envName]?.trim()
  const command = configured || (process.platform === 'win32'
    ? provider === 'codex' ? 'codex.cmd' : 'claude.exe'
    : provider === 'codex' ? 'codex' : 'claude')
  if (!SAFE_COMMAND.test(command)) {
    throw new Error(`${envName} 必须是单一可执行文件路径，不能包含 shell 控制字符。`)
  }
  return command
}

export function buildAgentCliInvocation(provider: NativeAgentProvider, modelId: string): AgentCliInvocation {
  const normalizedModelId = assertSafeModelId(modelId)
  const command = resolveCommand(provider)

  if (provider === 'codex') {
    return {
      provider,
      command,
      args: [
        '--ask-for-approval', 'never',
        'exec',
        '--model', normalizedModelId,
        '--sandbox', 'read-only',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--color', 'never',
        '-',
      ],
    }
  }

  return {
    provider,
    command,
    args: [
      '--print',
      '--model', normalizedModelId,
      '--permission-mode', 'plan',
      '--tools', '',
      '--no-session-persistence',
      '--safe-mode',
      '--output-format', 'text',
    ],
  }
}

export function composeAgentPrompt(messages: Message[], systemPrompt?: string): string {
  const system = [NATIVE_AGENT_SYSTEM_PROMPT, systemPrompt?.trim()].filter(Boolean).join('\n\n')
  const transcript = messages
    .map((message) => `<${message.role}>\n${message.content}\n</${message.role}>`)
    .join('\n\n')

  return [
    '<novelforge_system_contract>',
    system,
    '</novelforge_system_contract>',
    '<novelforge_conversation>',
    transcript,
    '</novelforge_conversation>',
    '<novelforge_final_guard>',
    '只输出候选结果，不要解释工具、命令、文件或正式写回。',
    '</novelforge_final_guard>',
  ].join('\n')
}

function buildNativeProcessEnv(): NodeJS.ProcessEnv {
  const childEnv = { ...process.env }
  for (const key of [
    'NOVELFORGE_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENROUTER_API_KEY',
    'DEEPSEEK_API_KEY',
    'KIMI_API_KEY',
    'DASHSCOPE_API_KEY',
    'QIANFAN_ACCESS_KEY',
    'QIANFAN_SECRET_KEY',
    'TAVILY_API_KEY',
    'BRAVE_API_KEY',
  ]) {
    delete childEnv[key]
  }
  return childEnv
}

function resolveNativeTimeout(timeoutMs?: number): number {
  const configured = Number(process.env.NOVELFORGE_NATIVE_MODEL_TIMEOUT_MS)
  const value = typeof timeoutMs === 'number'
    ? Math.round(timeoutMs)
    : Number.isFinite(configured)
      ? Math.round(configured)
      : DEFAULT_NATIVE_TIMEOUT_MS
  return Math.min(Math.max(value, 5_000), MAX_NATIVE_TIMEOUT_MS)
}

function terminateProcess(child: ChildProcessWithoutNullStreams): void {
  if (typeof child.pid !== 'number') return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.unref()
    return
  }
  child.kill('SIGTERM')
}

function quoteWindowsArgument(value: string): string {
  if (!/[\s"]/u.test(value)) return value
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`
}

function spawnAgentProcess(
  invocation: AgentCliInvocation,
  options: Parameters<typeof spawn>[2],
): ChildProcessWithoutNullStreams {
  const isWindowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(invocation.command)
  if (!isWindowsBatch) return spawn(invocation.command, invocation.args, options) as ChildProcessWithoutNullStreams

  const commandLine = [invocation.command, ...invocation.args].map(quoteWindowsArgument).join(' ')
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], options) as ChildProcessWithoutNullStreams
}

function runAgentCli(
  invocation: AgentCliInvocation,
  prompt: string,
  opts?: ChatOptions,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (opts?.signal?.aborted) {
    const error = new Error('用户已取消')
    error.name = 'AbortError'
    return Promise.reject(error)
  }
  return new Promise((resolve, reject) => {
    const child = spawnAgentProcess(invocation, {
      cwd: os.tmpdir(),
      env: buildNativeProcessEnv(),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      terminateProcess(child)
      finish(() => reject(new Error(`原生模型请求超时（${Math.ceil(resolveNativeTimeout(opts?.timeoutMs) / 1000)} 秒）`)))
    }, resolveNativeTimeout(opts?.timeoutMs))

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      opts?.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onAbort = () => {
      terminateProcess(child)
      const error = new Error('用户已取消')
      error.name = 'AbortError'
      finish(() => reject(error))
    }

    opts?.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = String(chunk)
      output += text
      if (output.length > MAX_NATIVE_OUTPUT_CHARS) {
        terminateProcess(child)
        finish(() => reject(new Error('原生模型输出超过安全上限。')))
        return
      }
      onChunk?.(text)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
      if (stderr.length > 32_000) stderr = stderr.slice(-32_000)
    })
    child.stdin.on('error', () => undefined)
    child.once('error', (error) => finish(() => reject(new Error(`原生模型启动失败：${error.message}`))))
    child.once('close', (code, signal) => {
      finish(() => {
        const result = output.trim()
        if (code === 0 && result) {
          resolve(result)
          return
        }
        const detail = stderr.trim() || output.trim() || `exit=${String(code)} signal=${String(signal)}`
        reject(new Error(`原生模型返回失败：${detail}`))
      })
    })

    child.stdin.end(prompt)
  })
}

export class AgentCliAdapter extends BaseAdapter {
  id: string
  name: string
  provider: NativeAgentProvider
  maxContextTokens: number
  private readonly modelId: string

  constructor(
    provider: NativeAgentProvider,
    modelId: string,
    maxContextTokens?: number | null,
    defaultTemperature = 0.75,
    defaultMaxTokens = 65_536,
  ) {
    super()
    this.provider = provider
    this.modelId = assertSafeModelId(modelId)
    this.id = provider
    this.name = provider === 'codex' ? 'Codex 原生模型' : 'Claude 原生模型'
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, NATIVE_AGENT_CONTEXT_WINDOWS[provider])
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }

  async chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    return runAgentCli(
      buildAgentCliInvocation(this.provider, this.modelId),
      composeAgentPrompt(messages, opts?.systemPrompt),
      opts,
    )
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    await runAgentCli(
      buildAgentCliInvocation(this.provider, this.modelId),
      composeAgentPrompt(messages, opts?.systemPrompt),
      opts,
      opts?.onStream,
    )
  }
}
