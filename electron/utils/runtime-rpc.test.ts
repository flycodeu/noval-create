import { describe, expect, it } from 'vitest'
import { resolveRuntimeRpcChannel } from './runtime-rpc'

describe('runtime browser RPC allowlist', () => {
  it('maps shared story handlers without duplicating business routing', () => {
    expect(resolveRuntimeRpcChannel('novel', 'update')).toBe('novel:update')
    expect(resolveRuntimeRpcChannel('storyAtlas', 'query')).toBe('storyAtlas:query')
    expect(resolveRuntimeRpcChannel('agentTools', 'call')).toBe('agentTool:call')
    expect(resolveRuntimeRpcChannel('app', 'getCodexMcpSetupStatus')).toBe('app:getCodexMcpSetupStatus')
  })
  it('rejects native shell, window, approval-dialog and malformed channels', () => {
    expect(resolveRuntimeRpcChannel('app', 'configureCodexMcp')).toBeNull()
    expect(resolveRuntimeRpcChannel('window', 'close')).toBeNull()
    expect(resolveRuntimeRpcChannel('agentTools', 'approve')).toBeNull()
    expect(resolveRuntimeRpcChannel('model', 'getApiKey')).toBeNull()
    expect(resolveRuntimeRpcChannel('sourceSearch', 'getRuntimeConfig')).toBeNull()
    expect(resolveRuntimeRpcChannel('zhuque', 'localKey')).toBeNull()
    expect(resolveRuntimeRpcChannel('zhuque', 'getChapterResult')).toBe('zhuque:getChapterResult')
    expect(resolveRuntimeRpcChannel('novel', 'export')).toBeNull()
    expect(resolveRuntimeRpcChannel('__proto__', 'constructor')).toBeNull()
    expect(resolveRuntimeRpcChannel('novel', 'get:other')).toBeNull()
  })
})
