export type DesktopUpdateMode = 'installed' | 'portable' | 'development' | 'unsupported'
export type DesktopUpdatePhase = 'idle' | 'checking' | 'downloading' | 'up_to_date' | 'ready' | 'error'

export interface DesktopUpdateStatus {
  currentVersion: string
  mode: DesktopUpdateMode
  phase: DesktopUpdatePhase
  latestVersion: string | null
  downloadPercent: number | null
  checkedAt: string | null
  error: string | null
}
