import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { AgentCliAdapter, buildAgentCliInvocation, composeAgentPrompt, NATIVE_AGENT_SYSTEM_PROMPT } from './agent-cli.adapter'

const originalCodexCommand = process.env.NOVELFORGE_CODEX_COMMAND
const originalClaudeCommand = process.env.NOVELFORGE_CLAUDE_COMMAND

afterEach(() => {
  if (originalCodexCommand === undefined) delete process.env.NOVELFORGE_CODEX_COMMAND
  else process.env.NOVELFORGE_CODEX_COMMAND = originalCodexCommand
  if (originalClaudeCommand === undefined) delete process.env.NOVELFORGE_CLAUDE_COMMAND
  else process.env.NOVELFORGE_CLAUDE_COMMAND = originalClaudeCommand
  spawnMock.mockReset()
})

describe('native agent CLI adapter', () => {
  it('builds a read-only, ephemeral Codex invocation', () => {
    const invocation = buildAgentCliInvocation('codex', 'gpt-5')

    expect(invocation.args).toEqual(expect.arrayContaining([
      'exec', '--model', 'gpt-5', '--sandbox', 'read-only', '--ask-for-approval', 'never',
      '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
    ]))
    expect(invocation.args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('builds a plan-only Claude invocation without tools or persistence', () => {
    const invocation = buildAgentCliInvocation('claude_code', 'sonnet')

    expect(invocation.args).toEqual(expect.arrayContaining([
      '--print', '--model', 'sonnet', '--permission-mode', 'plan', '--tools', '',
      '--no-session-persistence', '--safe-mode',
    ]))
  })

  it('rejects command-like model IDs and executable paths', () => {
    expect(() => buildAgentCliInvocation('codex', 'gpt-5; whoami')).toThrow('模型 ID')
    process.env.NOVELFORGE_CODEX_COMMAND = 'codex.cmd & whoami'
    expect(() => buildAgentCliInvocation('codex', 'gpt-5')).toThrow('NOVELFORGE_CODEX_COMMAND')
  })

  it('keeps NovelForge controls outside the native client prompt', () => {
    const prompt = composeAgentPrompt([{ role: 'user', content: '生成候选章节。' }], '章节只能使用给定事实。')

    expect(prompt.indexOf(NATIVE_AGENT_SYSTEM_PROMPT)).toBeGreaterThanOrEqual(0)
    expect(prompt).toContain('不得补造未提供的事实')
    expect(prompt).toContain('<novelforge_final_guard>')
  })

  it('records one cli lifecycle per spawned process without executing a real agent', async () => {
    process.env.NOVELFORGE_CODEX_COMMAND = 'fake-agent.exe'
    const child = new EventEmitter() as EventEmitter & Record<string, any>
    child.pid = 123
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = new EventEmitter()
    child.stdin.end = vi.fn(() => queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('候选正文'))
      child.emit('close', 0, null)
    }))
    child.kill = vi.fn()
    spawnMock.mockReturnValue(child)
    const events: Array<{ kind: string; status: string; requestId: string }> = []

    const result = await new AgentCliAdapter('codex', 'gpt-5').chat(
      [{ role: 'user', content: '生成' }],
      {
        requestObserver: {
          onRequestStart: (event) => events.push(event),
          onRequestEnd: (event) => events.push(event),
        },
      },
    )

    expect(result).toBe('候选正文')
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(events.map((event) => [event.kind, event.status])).toEqual([
      ['cli', 'started'],
      ['cli', 'success'],
    ])
    expect(events[0].requestId).toBe(events[1].requestId)
  })
})
