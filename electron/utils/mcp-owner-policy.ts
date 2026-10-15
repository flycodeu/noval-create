import type { RuntimeHealth } from './mcp-runtime'
import { sameDirectory } from './desktop-profile'

export const MCP_OPEN_DESKTOP_MESSAGE = '请先手动打开已安装的 NovelForge，再重新连接 MCP。MCP 不会自动启动后台服务或临时实例。'

/** A running headless owner, source build or another installation is not consent to attach. */
export function assertMcpDesktopOwner(health: RuntimeHealth | undefined, directory: string, executable: string): void {
  if (!health || !health.desktopOpen) throw new Error(MCP_OPEN_DESKTOP_MESSAGE)
  const identity = health.identity
  if (!identity || identity.environment !== 'formal' || identity.source !== 'installed'
    || !sameDirectory(identity.dataDirectory, directory) || !sameDirectory(identity.executable, executable)) {
    throw new Error('MCP 只能连接当前安装版的正式桌面实例，不能连接其他安装路径、源码版或临时数据库。请手动打开配置中的 NovelForge 安装版。')
  }
}
