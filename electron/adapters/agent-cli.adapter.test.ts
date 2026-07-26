import { afterEach, describe, expect, it } from 'vitest'
import { buildAgentCliInvocation, composeAgentPrompt, NATIVE_AGENT_SYSTEM_PROMPT } from './agent-cli.adapter'

const originalCodexCommand = process.env.NOVELFORGE_CODEX_COMMAND
const originalClaudeCommand = process.env.NOVELFORGE_CLAUDE_COMMAND

afterEach(() => {
  if (originalCodexCommand === undefined) delete process.env.NOVELFORGE_CODEX_COMMAND
  else process.env.NOVELFORGE_CODEX_COMMAND = originalCodexCommand
  if (originalClaudeCommand === undefined) delete process.env.NOVELFORGE_CLAUDE_COMMAND
  else process.env.NOVELFORGE_CLAUDE_COMMAND = originalClaudeCommand
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
})
