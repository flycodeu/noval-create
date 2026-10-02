import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { CodexMcpSetupStatus } from '../../src/shared/codex-mcp-setup'

const SERVER_NAME = 'novelforge'

function isFile(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile() } catch { return false }
}

function findCodexCli(input?: string): string | null {
  if (input !== undefined) {
    const selected = input.trim()
    if (!path.isAbsolute(selected) || path.basename(selected).toLowerCase() !== 'codex.exe' || !isFile(selected)) {
      throw new Error('请选择存在的 codex.exe 绝对路径。')
    }
    return selected
  }
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    ...((process.env.PATH || '').split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, 'codex.exe'))),
  ].filter((value): value is string => Boolean(value))
  return candidates.find(isFile) ?? null
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => path.normalize(value).replace(/[\\/]$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function runCodex(cliPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cliPath, args, { timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

export async function getCodexMcpSetupStatus(cliInput?: string): Promise<CodexMcpSetupStatus> {
  const novelForgePath = app.isPackaged ? app.getPath('exe') : null
  const supported = process.platform === 'win32' && Boolean(novelForgePath && isFile(novelForgePath))
  const codexCliPath = findCodexCli(cliInput)
  const command = supported && novelForgePath
    ? `${codexCliPath ? `& ${quotePowerShell(codexCliPath)}` : 'codex'} mcp add ${SERVER_NAME} -- ${quotePowerShell(novelForgePath)} --mcp`
    : null
  const base: CodexMcpSetupStatus = {
    supported,
    codexCliPath,
    novelForgePath,
    registration: 'unknown',
    registeredCommand: null,
    registeredArgs: [],
    command,
    message: '',
  }
  if (!supported) return { ...base, message: '请使用 Windows 安装版或便携版 NovelForge 配置 MCP。' }
  if (!codexCliPath) return { ...base, message: '未找到 Codex CLI，请指定 codex.exe 路径，或复制下方命令手动配置。' }

  try {
    const stdout = await runCodex(codexCliPath, ['mcp', 'get', SERVER_NAME, '--json'])
    const value = JSON.parse(stdout) as {
      enabled?: boolean
      transport?: { type?: string; command?: string; args?: string[] }
    }
    const registeredCommand = value.transport?.command ?? null
    const registeredArgs = Array.isArray(value.transport?.args) ? value.transport.args : []
    const configured = value.enabled === true && value.transport?.type === 'stdio'
      && registeredCommand !== null && samePath(registeredCommand, novelForgePath!)
      && registeredArgs.length === 1 && registeredArgs[0] === '--mcp'
    return {
      ...base,
      registration: configured ? 'configured' : 'different',
      registeredCommand,
      registeredArgs,
      message: configured
        ? 'Codex 已登记当前 NovelForge 的 MCP 启动命令。'
        : 'Codex 中已有 novelforge 配置，但与当前程序路径或启动参数不一致。',
    }
  } catch (error) {
    const failure = error as Error & { code?: number | string; stderr?: string }
    if (failure.code === 1 && /No MCP server named .* found|not found|not configured|does not exist/i.test(failure.stderr || failure.message)) {
      return { ...base, registration: 'missing', message: 'Codex 尚未登记 novelforge MCP。' }
    }
    return { ...base, message: `无法读取 Codex MCP 配置：${failure.message}` }
  }
}

export async function configureCodexMcp(cliInput?: string): Promise<CodexMcpSetupStatus> {
  const before = await getCodexMcpSetupStatus(cliInput)
  if (!before.supported || !before.novelForgePath) throw new Error('请从 Windows 安装版或便携版 NovelForge 执行配置。')
  if (!before.codexCliPath) throw new Error('未找到 Codex CLI，请先指定 codex.exe 路径。')
  if (before.registration === 'configured') return before
  await runCodex(before.codexCliPath, ['mcp', 'add', SERVER_NAME, '--', before.novelForgePath, '--mcp'])
  const after = await getCodexMcpSetupStatus(before.codexCliPath)
  if (after.registration !== 'configured') throw new Error(`配置命令已执行，但复核未通过：${after.message}`)
  return after
}
