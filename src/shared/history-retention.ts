export interface HistoryRetentionSettings {
  enabled: boolean
  keepDays: number
  cleanTasks: boolean
  cleanLogs: boolean
}

export const DEFAULT_HISTORY_RETENTION: HistoryRetentionSettings = {
  enabled: false, keepDays: 30, cleanTasks: true, cleanLogs: true,
}

export interface HistoryCleanupPreview {
  taskCount: number
  protectedTaskCount: number
  attemptCount: number
  logCount: number
  logBytes: number
}
