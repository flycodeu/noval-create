import type { RuntimeHealth } from './mcp-runtime'
import { sameDirectory } from './desktop-profile'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'

export const MCP_OPEN_DESKTOP_MESSAGE = formatUserFacingMessage('mcp.openDesktopRequired')

/** A running headless owner, source build or another installation is not consent to attach. */
export function assertMcpDesktopOwner(health: RuntimeHealth | undefined, directory: string, executable: string): void {
  if (!health || !health.desktopOpen) throw new Error(MCP_OPEN_DESKTOP_MESSAGE)
  const identity = health.identity
  if (!identity || identity.environment !== 'formal' || identity.source !== 'installed'
    || !sameDirectory(identity.dataDirectory, directory) || !sameDirectory(identity.executable, executable)) {
    throw new Error(formatUserFacingMessage('mcp.ownerMismatch'))
  }
}
