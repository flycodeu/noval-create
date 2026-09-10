'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

async function assertHandoffIdempotency(input, loadTypeScriptModule) {
  const creativeStageService = loadTypeScriptModule('electron/services/creative-stage.service.ts')
  const artifactService = loadTypeScriptModule('electron/services/artifact.service.ts')
  const taskService = loadTypeScriptModule('electron/services/task.service.ts')
  const originals = {
    createHandoff: creativeStageService.createCreativeStageHandoff,
    listHandoffs: creativeStageService.listCreativeStageHandoffs,
    findArtifact: artifactService.findArtifactByIdempotency,
    runChatTask: taskService.runChatTask,
  }
  const artifacts = new Map()
  let createCount = 0
  try {
    creativeStageService.listCreativeStageHandoffs = () => []
    creativeStageService.createCreativeStageHandoff = (value) => {
      createCount += 1
      const artifact = {
        id: `nf14-handoff-${createCount}`,
        novelId: input.novelId,
        kind: 'creative_stage_handoff',
        status: 'draft',
        producerType: value.producerType,
        idempotencyKey: value.idempotencyKey,
        content: { stageId: value.stageId },
      }
      artifacts.set(value.idempotencyKey, artifact)
      return artifact
    }
    artifactService.findArtifactByIdempotency = (_novelId, _kind, key) => artifacts.get(key) || null
    taskService.runChatTask = async () => { throw new Error('NF14_DETERMINISTIC_HANDOFF_ONLY') }
    const handoff = loadTypeScriptModule('electron/services/creative-stage-handoff.service.ts')
    const [first, concurrentReplay] = await Promise.all([
      handoff.createChapterEndCreativeStageHandoffDraft(input),
      handoff.createChapterEndCreativeStageHandoffDraft(input),
    ])
    const sequentialReplay = await handoff.createChapterEndCreativeStageHandoffDraft(input)
    assert.equal(first.artifact.id, concurrentReplay.artifact.id)
    assert.equal(first.artifact.id, sequentialReplay.artifact.id)
    assert.equal(createCount, 1)
    return first.artifact.id
  } finally {
    creativeStageService.createCreativeStageHandoff = originals.createHandoff
    creativeStageService.listCreativeStageHandoffs = originals.listHandoffs
    artifactService.findArtifactByIdempotency = originals.findArtifact
    taskService.runChatTask = originals.runChatTask
  }
}

function assertMigrationUpgrade(Database, baselineRunMigrations, runMigrations) {
  const legacyDb = new Database(':memory:')
  try {
    baselineRunMigrations(legacyDb)
    const novelId = Number(legacyDb.prepare(`
      INSERT INTO novels (title, context_version) VALUES ('旧库', 4)
    `).run().lastInsertRowid)
    legacyDb.prepare(`
      INSERT INTO story_memory_checkpoints (novel_id, scope_type, summary, version)
      VALUES (?, 'novel', '迁移前摘要', 9)
    `).run(novelId)
    runMigrations(legacyDb)
    const columns = new Set(legacyDb.prepare('PRAGMA table_info(story_memory_checkpoints)').all().map((row) => row.name))
    assert.ok(columns.has('source_context_version'))
    assert.ok(columns.has('source_manifest_json'))
    assert.deepEqual(legacyDb.prepare(`
      SELECT summary, version, source_context_version AS sourceContextVersion,
             source_manifest_json AS sourceManifestJson
      FROM story_memory_checkpoints WHERE novel_id = ?
    `).get(novelId), {
      summary: '迁移前摘要',
      version: 9,
      sourceContextVersion: null,
      sourceManifestJson: null,
    })
    runMigrations(legacyDb)
    assert.equal(legacyDb.prepare(`
      SELECT COUNT(*) AS count FROM _schema_migrations
      WHERE id = '0066_checkpoint_source_manifest'
    `).get().count, 1)
  } finally {
    legacyDb.close()
  }
}

async function run({ Database, tempRoot, runMigrations, baselineRunMigrations, loadTypeScriptModule }) {
  const { app } = require('electron')
  fs.mkdirSync(tempRoot, { recursive: true })
  const originalUserData = app.getPath('userData')
  const isolatedUserData = fs.mkdtempSync(path.join(tempRoot, 'nf14-'))
  app.setPath('userData', isolatedUserData)
  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'

  const database = loadTypeScriptModule('electron/database/db.ts')
  try {
    database.initDb()
    const sqlite = database.getSqlite()
    const compiler = loadTypeScriptModule('electron/services/context-compiler.ts')
    const manifestApi = loadTypeScriptModule('electron/services/memory-source-manifest.ts')
    const storyMemory = loadTypeScriptModule('electron/services/story-memory.service.ts')
    const impact = loadTypeScriptModule('electron/services/context-impact.service.ts')
    const semantic = loadTypeScriptModule('electron/services/semantic-memory.service.ts')
    const semanticDocuments = loadTypeScriptModule('src/shared/semantic-memory.ts')
    const schema = loadTypeScriptModule('electron/database/schema.ts')

    const novelId = Number(sqlite.prepare(`
      INSERT INTO novels (title, target_words, context_version)
      VALUES ('NF-14 隔离验收', 200000, 10)
    `).run().lastInsertRowid)
    const chapter3Id = Number(sqlite.prepare(`
      INSERT INTO chapters (
        novel_id, chapter_num, title, content, summary, status,
        continuity_state_json, stale_reason_json, context_version
      ) VALUES (?, 3, '旧案', '第三章原文事实。', '发现旧钥匙。', 'completed', '{}', '[]', 10)
    `).run(novelId).lastInsertRowid)
    const chapter4Id = Number(sqlite.prepare(`
      INSERT INTO chapters (
        novel_id, chapter_num, title, content, summary, status,
        continuity_state_json, stale_reason_json, context_version
      ) VALUES (?, 4, '追踪', '第四章已有正文，不能被历史修订改写。', '追踪钥匙来源。', 'completed', '{}', '[]', 10)
    `).run(novelId).lastInsertRowid)
    const characterId = Number(sqlite.prepare(`
      INSERT INTO characters (novel_id, full_name, role_type, occupation)
      VALUES (?, '沈砚', 'protagonist', '调查员')
    `).run(novelId).lastInsertRowid)
    const character = database.getDb().select().from(schema.characters)
      .where(require('drizzle-orm').eq(schema.characters.id, characterId)).all()[0]
    const existingDocuments = semanticDocuments.buildCharacterSemanticDocuments(character)
    const insertExistingProjection = sqlite.prepare(`
      INSERT INTO semantic_memory_entries (
        novel_id, source_type, source_id, fragment_key, content_text,
        embedding_json, model_id, dimensions, embedding_profile, source_hash,
        context_version, entity_refs_json, visibility
      ) VALUES (?, ?, ?, ?, ?, '[0.1,0.2]', 'nf14-existing', 2, 'nf14-existing:2', ?, 9, ?, ?)
    `)
    for (const document of existingDocuments) {
      insertExistingProjection.run(
        novelId,
        document.sourceType,
        document.sourceId,
        document.fragmentKey,
        document.content,
        semantic.hashSemanticDocument(novelId, document, 'local-only:default'),
        JSON.stringify(document.entityRefs),
        document.visibility,
      )
    }

    const refreshed = storyMemory.refreshStoryMemoryCheckpoints(novelId)
    const novelCheckpoint = refreshed.find((row) => row.scopeType === 'novel')
    assert.ok(novelCheckpoint)
    assert.equal(novelCheckpoint.sourceContextVersion, 10)
    assert.equal(manifestApi.parseMemorySourceManifest(novelCheckpoint.sourceManifestJson, 10).state, 'verified')
    assert.equal(novelCheckpoint.version, 1)

    const rawContext = {
      novel: { id: novelId, contextVersion: 10 },
      currentChapter: { id: chapter4Id, chapterNum: 4 },
    }
    const allocatedContext = {
      contractVersionSummary: 'nf14-contract',
      hardConstraintEntries: [{ label: 'chapterGoal', content: '追踪钥匙来源', allocatedTokens: 8 }],
      softContextDecisions: [],
      contextBudgetReport: { availableContextBudget: 100, reservedForOutput: 20 },
    }
    const compiled = await compiler.compileChapterContextPack({
      rawContext,
      context: allocatedContext,
      stage: 'draft',
      modelProfile: 'balanced',
    })

    const oldWorker = semantic.processSemanticMemoryOutbox({
      novelId,
      allowRemoteEmbeddings: false,
    })
    const version11 = impact.markNovelContextChanged(novelId, 'Historical source fact changed')
    assert.equal(version11, 11)
    const oldWorkerResult = await oldWorker
    assert.equal(oldWorkerResult.supersededCount, 1)
    const oldProjectionState = sqlite.prepare(`
      SELECT COUNT(*) AS count, MAX(context_version) AS maxContextVersion
      FROM semantic_memory_entries
      WHERE novel_id = ? AND source_type = 'character' AND source_id = ?
    `).get(novelId, characterId)
    assert.equal(oldProjectionState.count, existingDocuments.length)
    assert.equal(oldProjectionState.maxContextVersion, 9)
    const requeued = sqlite.prepare(`
      SELECT status, revision, context_version AS contextVersion
      FROM semantic_memory_outbox
      WHERE novel_id = ? AND source_type = 'character' AND source_id = ?
    `).get(novelId, characterId)
    assert.equal(requeued.status, 'pending')
    assert.equal(requeued.contextVersion, 11)
    assert.ok(requeued.revision >= 2)

    await assert.rejects(
      () => compiler.compileChapterContextPack({
        rawContext: { ...rawContext, novel: { id: novelId, contextVersion: 11 } },
        context: allocatedContext,
        stage: 'draft',
        modelProfile: 'balanced',
        mode: 'active',
        restoredPack: compiled.pack,
      }),
      (error) => error && error.code === 'NF_CONTEXT_STALE',
    )

    const retry = await semantic.processSemanticMemoryOutbox({ novelId, allowRemoteEmbeddings: false })
    assert.equal(retry.processedCount, 1)
    const duplicate = await semantic.processSemanticMemoryOutbox({ novelId, allowRemoteEmbeddings: false })
    assert.equal(duplicate.claimedCount, 0)
    const semanticEntryCount = sqlite.prepare(`
      SELECT COUNT(*) AS count FROM semantic_memory_entries
      WHERE novel_id = ? AND source_type = 'character' AND source_id = ?
    `).get(novelId, characterId).count
    assert.ok(semanticEntryCount > 0)

    sqlite.prepare(`UPDATE chapters SET stale_reason_json = '[]' WHERE id = ?`).run(chapter4Id)
    const laterBodyBefore = sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(chapter4Id).content
    impact.markSubsequentChaptersStale(novelId, 3, 'Historical chapter revised')
    const laterChapter = sqlite.prepare('SELECT content, stale_reason_json AS staleReasons FROM chapters WHERE id = ?').get(chapter4Id)
    assert.equal(hash(laterChapter.content), hash(laterBodyBefore))
    assert.ok(JSON.parse(laterChapter.staleReasons).includes('Historical chapter revised'))

    sqlite.prepare(`
      UPDATE story_memory_checkpoints
      SET summary = '旧摘要仅兼容展示', source_context_version = NULL,
          source_manifest_json = NULL, locked = 1, stale = 1,
          last_refreshed_chapter_num = 4, updated_at = CURRENT_TIMESTAMP
      WHERE novel_id = ? AND scope_type = 'novel'
    `).run(novelId)
    const lockedBefore = sqlite.prepare(`
      SELECT summary, version FROM story_memory_checkpoints
      WHERE novel_id = ? AND scope_type = 'novel'
    `).get(novelId)
    const previousMode = process.env.NOVELFORGE_CONTEXT_COMPILER_MODE
    process.env.NOVELFORGE_CONTEXT_COMPILER_MODE = 'active'
    const promptPackage = storyMemory.buildStoryMemoryPromptPackage(novelId, {
      chapterId: chapter4Id,
      refreshMode: 'sync',
    })
    if (previousMode === undefined) delete process.env.NOVELFORGE_CONTEXT_COMPILER_MODE
    else process.env.NOVELFORGE_CONTEXT_COMPILER_MODE = previousMode
    const novelBucket = promptPackage.observability.buckets.find((bucket) => bucket.scopeType === 'novel')
    assert.equal(novelBucket.manifestState, 'legacy')
    assert.equal(novelBucket.usableAsFactPack, false)
    assert.ok(novelBucket.requiredGaps.includes('checkpoint_source_manifest_missing'))
    const lockedAfter = sqlite.prepare(`
      SELECT summary, version, stale FROM story_memory_checkpoints
      WHERE novel_id = ? AND scope_type = 'novel'
    `).get(novelId)
    assert.deepEqual(lockedAfter, { ...lockedBefore, stale: 1 })

    const handoffInput = {
      novelId,
      stageId: 701,
      chapterId: chapter4Id,
      chapterNum: 4,
      chapterTitle: '追踪',
      chapterContent: laterBodyBefore,
      summary: '追踪钥匙来源。',
      nextChapterSeed: '核对锁芯。',
    }
    const handoffArtifactId = await assertHandoffIdempotency(handoffInput, loadTypeScriptModule)
    assertMigrationUpgrade(Database, baselineRunMigrations, runMigrations)

    return {
      cases: {
        '14-01': 'PASS',
        '14-02': 'PASS',
        '14-03': 'PASS',
        '14-04': 'PASS',
        '14-05': 'PASS',
        '14-06': 'PASS',
        '14-07': 'PASS',
      },
      assertions: [
        'source change advances contextVersion and active compiler rejects the restored old pack',
        'v10 worker cannot write projection or clear dirty after v11, and safely requeues revision',
        'outbox replay and chapter handoff are idempotent',
        'historical invalidation leaves later chapter body hash unchanged',
        'legacy locked checkpoint stays displayable metadata but is not an active verified fact pack',
        '0066 upgrade preserves old summary/version and repeated migration is idempotent',
        'migration failure rollback is covered by scripts/migration-safety.test.cjs',
      ],
      sqlite: {
        contextVersion: version11,
        semanticEntryCount,
        handoffArtifactId,
        isolatedUserData,
      },
    }
  } finally {
    database.closeDb()
    app.setPath('userData', originalUserData)
  }
}

module.exports = { run }
