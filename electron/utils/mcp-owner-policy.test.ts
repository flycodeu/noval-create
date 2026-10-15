import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {} }))
import { assertMcpDesktopOwner } from './mcp-owner-policy'
import type { RuntimeHealth } from './mcp-runtime'

const directory = 'C:/Users/author/AppData/Roaming/NovelForge'
const executable = 'D:/Program Files/NovelForge/NovelForge.exe'
const health = (): RuntimeHealth => ({ instanceId: 'manual-owner', version: '2.4.25', storage: 'ready', tools: 26, activeRequests: 0, modelConfigured: true, desktopAvailable: true, desktopOpen: true,
  identity: { environment: 'formal', source: 'installed', version: '2.4.25', dataDirectory: directory, executable } })

describe('MCP connection-only owner policy', () => {
  it('accepts the open installed desktop with its existing formal data', () => {
    expect(() => assertMcpDesktopOwner(health(), directory, executable)).not.toThrow()
  })
  it('asks the user to open the app when absent or running headless', () => {
    expect(() => assertMcpDesktopOwner(undefined, directory, executable)).toThrow('请先手动打开')
    expect(() => assertMcpDesktopOwner({ ...health(), desktopOpen: false }, directory, executable)).toThrow('请先手动打开')
  })
  it.each([
    { environment: 'test' as const }, { source: 'source' as const },
    { executable: 'C:/Program Files/NovelForge/NovelForge.exe' },
    { dataDirectory: 'C:/Temp/NovelForge' },
  ])('rejects a different owner identity: %j', patch => {
    const h = health(); h.identity = { ...h.identity!, ...patch }
    expect(() => assertMcpDesktopOwner(h, directory, executable)).toThrow('只能连接')
  })
  it('rejects old owners without identity instead of guessing', () => {
    expect(() => assertMcpDesktopOwner({ ...health(), identity: undefined }, directory, executable)).toThrow('只能连接')
  })
})
