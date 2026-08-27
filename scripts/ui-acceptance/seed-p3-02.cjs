const { app } = require('electron')
const Database = require('better-sqlite3')

function main() {
  const payload = JSON.parse(process.argv[2] || '{}')
  const sqlite = new Database(payload.databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    const insertState = sqlite.prepare(`
      INSERT INTO character_state_versions (
        novel_id, character_id, chapter_id, chapter_num,
        injury_state, resource_state, stance_state, mental_state,
        relationship_heat_summary, goal_state, event_cause, change_reason,
        summary_text, state_delta_json, created_at, updated_at
      ) VALUES (
        @novelId, @characterId, @chapterId, @chapterNum,
        @injuryState, @resourceState, @stanceState, @mentalState,
        @relationshipHeatSummary, @goalState, @eventCause, @changeReason,
        @summaryText, @stateDeltaJson, @createdAt, @updatedAt
      )
    `)
    const removeCurrentStates = sqlite.prepare('DELETE FROM character_state_versions WHERE chapter_id = ? AND character_id = ?')
    const now = new Date().toISOString()
    const transaction = sqlite.transaction(() => {
      payload.seedStates.forEach((state, index) => {
        const characterId = Number(payload.characterIds[index])
        removeCurrentStates.run(payload.chapterId, characterId)
        insertState.run({
          novelId: payload.projectId,
          characterId,
          chapterId: payload.chapterId,
          chapterNum: payload.chapterNum,
          ...state,
          stateDeltaJson: JSON.stringify([{
            field: 'storyState',
            before: '未记录',
            after: state.summaryText,
            cause: state.eventCause,
            persistencePolicy: 'ongoing',
            reversible: true,
          }]),
          createdAt: now,
          updatedAt: now,
        })
      })
    })
    transaction()
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
