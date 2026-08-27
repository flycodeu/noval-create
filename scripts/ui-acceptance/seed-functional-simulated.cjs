const { app } = require('electron')
const Database = require('better-sqlite3')

function main() {
  const payload = JSON.parse(process.argv[2] || '{}')
  if (!payload.databasePath) throw new Error('缺少 databasePath')
  if (!Number.isInteger(Number(payload.projectId)) || Number(payload.projectId) <= 0) {
    throw new Error('缺少有效 projectId')
  }
  if (!Number.isInteger(Number(payload.modelConfigId)) || Number(payload.modelConfigId) <= 0) {
    throw new Error('缺少有效 modelConfigId')
  }

  const sqlite = new Database(payload.databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const insertTask = sqlite.prepare(`
      INSERT INTO tasks (
        novel_id, type, status, input_json, model_config_id, error_message,
        related_entity_type, related_entity_id, runner_type, retryable,
        recovery_hint_json, progress_json, control_json, created_at, updated_at
      ) VALUES (
        @novelId, @type, @status, @inputJson, @modelConfigId, @errorMessage,
        @relatedEntityType, @relatedEntityId, @runnerType, @retryable,
        @recoveryHintJson, @progressJson, @controlJson, @createdAt, @updatedAt
      )
    `)
    const messages = JSON.stringify([
      { role: 'user', content: '请返回一个简短的模拟审校结果。' },
    ])
    const retryable = insertTask.run({
      novelId: Number(payload.projectId),
      type: 'review',
      status: 'failed',
      inputJson: messages,
      modelConfigId: Number(payload.modelConfigId),
      errorMessage: '模拟首次执行失败，等待重试。',
      relatedEntityType: 'simulation',
      relatedEntityId: null,
      runnerType: 'chat',
      retryable: 1,
      recoveryHintJson: JSON.stringify({
        kind: 'open_page',
        label: '回到模拟任务',
        description: '本地模拟任务可安全重试。',
        path: '/tasks',
      }),
      progressJson: JSON.stringify({ message: '模拟失败，允许安全重试。' }),
      controlJson: JSON.stringify({ contentAttemptNumber: 0 }),
      createdAt: now,
      updatedAt: now,
    }).lastInsertRowid

    const workflowProgress = {
      completedSections: ['overview', 'power', 'species', 'ecology', 'map', 'dynamics', 'timeline', 'language'],
      pendingSections: [],
      failedSections: [],
      completedSectionCount: 8,
      pendingSectionCount: 0,
      totalSections: 8,
      completed: false,
      workingRules: {},
      message: '模拟 checkpoint，继续后应安全收尾。',
    }
    const workflow = insertTask.run({
      novelId: Number(payload.projectId),
      type: 'world_rules_auto_generate',
      status: 'paused',
      inputJson: JSON.stringify({ currentRules: {}, sectionOrder: workflowProgress.completedSections }),
      modelConfigId: Number(payload.modelConfigId),
      errorMessage: '模拟应用重启后暂停。',
      relatedEntityType: null,
      relatedEntityId: null,
      runnerType: 'workflow',
      retryable: 0,
      recoveryHintJson: JSON.stringify({
        kind: 'resume',
        label: '继续世界规则流程',
        description: '本地模拟 checkpoint 可继续执行。',
        path: '/novels/' + Number(payload.projectId) + '/core-settings',
      }),
      progressJson: JSON.stringify(workflowProgress),
      controlJson: JSON.stringify({ cancelRequested: false, retryCount: 0 }),
      createdAt: now,
      updatedAt: new Date(Date.now() + 1).toISOString(),
    }).lastInsertRowid

    process.stdout.write(JSON.stringify({
      retryableTaskId: Number(retryable),
      workflowTaskId: Number(workflow),
    }))
  } finally {
    sqlite.close()
  }
}

app.whenReady().then(() => {
  try {
    main()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    app.exit(process.exitCode || 0)
  }
})
