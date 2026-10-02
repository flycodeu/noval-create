export interface CodexMcpSetupStatus {
  supported: boolean
  codexCliPath: string | null
  novelForgePath: string | null
  registration: 'configured' | 'missing' | 'different' | 'unknown'
  registeredCommand: string | null
  registeredArgs: string[]
  command: string | null
  message: string
  runtime?: {
    reachable: boolean
    projectReadable: boolean
    modelConfigured: boolean
    toolCount: number
    activeRequests: number
    message: string
  }
}
