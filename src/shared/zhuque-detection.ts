export interface ZhuqueSettingsView {
  enabled: boolean
  autoDetect: boolean
  apiKeySet: boolean
}
export interface ZhuqueSettingsUpdate {
  enabled?: boolean
  autoDetect?: boolean
  /** Omitted retains the local credential; empty clears it. Never returned. */
  apiKey?: string
}
export interface ZhuqueMetrics {
  humanRatio: number
  aiRatio: number
  suspectedAiRatio: number
  confidence: number
  riskRatio: number
  tokensUsed?: number
  quotaTokensUsed?: number
  segments: Array<{ label: 0 | 1 | 2; confidence: number; text: string }>
}
export interface ZhuqueReport {
  chapterId: number
  contentHash: string
  checkedAt: string
  status: 'success' | 'failed'
  metrics?: ZhuqueMetrics
  error?: string
}
export interface ZhuqueChapterView extends ZhuqueSettingsView {
  status: 'not_checked' | 'running' | 'success' | 'failed' | 'stale'
  report?: ZhuqueReport
}
export interface ZhuqueTestResult { success: boolean; info: string; latency: number }
