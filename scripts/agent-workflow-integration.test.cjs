const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(workspaceRoot, '.tmp-tests', 'agent-workflow-integration')
if (!tempRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error(`Refusing to use a temp directory outside the workspace: ${tempRoot}`)
}
fs.rmSync(tempRoot, { recursive: true, force: true })
fs.mkdirSync(tempRoot, { recursive: true })
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setName('NovelForge Agent Workflow Test')
app.setPath('userData', tempRoot)
app.commandLine.appendSwitch('disable-gpu')
registerProjectTsRuntime(workspaceRoot)

function project(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

async function run() {
  const { initDb, closeDb, getSqlite } = project('electron/database/db.ts')
  const artifactService = project('electron/services/artifact.service.ts')
  const approvalService = project('electron/services/approval.service.ts')
  const workflowService = project('electron/services/character-draft-workflow.service.ts')
  const recommendationService = project('electron/services/recommendation-governance.service.ts')
  const auditService = project('electron/services/agent-tool-audit.service.ts')
  const { novelForgeToolRegistry } = project('electron/application/novelforge-tool-registry.ts')
  const { DESKTOP_AGENT_TOOL_SCOPES } = project('src/shared/tool-contracts/index.ts')
  initDb()
  const sqlite = getSqlite()

  try {
    const novelInfo = sqlite.prepare(`
      INSERT INTO novels (title, status, target_words, context_version)
      VALUES ('审计港', 'serializing', 200000, 1)
    `).run()
    const novelId = Number(novelInfo.lastInsertRowid)
    const planContent = {
      planId: 'castplan_integration',
      taskId: 1,
      reviewTaskId: null,
      scopeSummary: '全书',
      existingCount: 0,
      priorRange: { min: 1, suggested: 1, max: 2, rationale: '测试' },
      recommended: { keep: 0, update: 0, mergeGroups: 0, create: 1, archive: 0, activeCastAfterCommit: 1, confidence: 0.9 },
      existingActions: [],
      mergeGroups: [],
      roleSlots: [],
      review: {
        mode: 'deterministic', status: 'passed', score: 92, summary: '通过', hardBlockers: [], warnings: [], revisionSuggestions: [],
        dimensionScores: { necessity: 90, causality: 90, worldFit: 90, tension: 90, differentiation: 90, writability: 90, growthSpace: 90, entranceFeasibility: 90 },
      },
      deterministicChecks: [],
      risks: [],
      assumptions: [],
      contextVersion: 1,
    }
    const plan = artifactService.createArtifact({
      id: planContent.planId,
      novelId,
      kind: 'character_cast_plan',
      status: 'reviewed',
      content: planContent,
      contextVersion: 1,
      producerType: 'system',
      producerId: 'integration-test',
      producerClient: 'integration-test',
    })
    const draftContent = {
      schemaVersion: 'character-draft-v1',
      planId: plan.id,
      planContentHash: plan.contentHash,
      plan: planContent,
      characters: [{
        fullName: '林渡',
        roleType: 'supporting',
        recordStatus: 'draft',
        entityType: 'human',
        goals: '找回被替换的第五封信',
        surfaceDesire: '进入旧港档案室',
        deepNeed: '承认自己曾参与隐瞒',
        innerConflict: '公开真相会牵连家人',
        dramaticEngine: '每提供一条线索，就暴露一层旧关系',
        relationshipTension: '需要主角信任，却不能一次说完真相',
      }],
      taskId: 1,
      qualityReview: { stage: 'accepted', review: { summary: '独立模型审校通过', rejectRequired: false, rewriteRequired: false } },
      generatedAt: new Date().toISOString(),
    }
    const draft = artifactService.createArtifact({
      novelId,
      kind: 'character_draft',
      status: 'draft',
      parentArtifactId: plan.id,
      content: draftContent,
      contextVersion: 1,
      producerType: 'novelforge_model',
      producerId: 'task:1',
      producerClient: 'integration-test',
      taskId: null,
      idempotencyKey: 'integration-draft-key',
    })
    const reviewContent = {
      schemaVersion: 'character-draft-review-v1',
      draftArtifactId: draft.id,
      draftContentHash: draft.contentHash,
      status: 'passed',
      score: 95,
      committable: true,
      summary: '通过',
      hardBlockers: [],
      warnings: [],
      checks: [],
      modelReview: { stage: 'accepted' },
      reviewedContextVersion: 1,
      createdAt: new Date().toISOString(),
    }
    const review = artifactService.createArtifact({
      novelId,
      kind: 'character_review',
      status: 'reviewed',
      parentArtifactId: draft.id,
      content: reviewContent,
      contextVersion: 1,
      producerType: 'system',
      producerId: 'integration-reviewer',
      producerClient: 'integration-test',
    })
    artifactService.updateArtifactLifecycle(draft.id, { status: 'reviewed', reviewArtifactId: review.id })

    assert.throws(
      () => sqlite.prepare(`UPDATE artifacts SET content_json = '{}' WHERE id = ?`).run(draft.id),
      /ARTIFACT_CONTENT_IMMUTABLE/,
    )

    const actor = {
      type: 'human',
      actorId: 'integration-user',
      clientId: 'integration-client',
      sessionId: 'integration-session',
    }
    const callRequest = {
      toolId: 'novelforge.characters.commit_draft',
      input: {
        novelId,
        draftArtifactId: draft.id,
        expectedContextVersion: 1,
        expectedContentHash: draft.contentHash,
        idempotencyKey: 'integration-commit-key',
      },
    }
    const wrongGrant = approvalService.createApprovalGrant({ request: callRequest, actor })
    assert.equal(approvalService.consumeApprovalGrant({
      approvalId: wrongGrant.approvalId,
      request: { ...callRequest, input: { ...callRequest.input, expectedContextVersion: 2 } },
      actor,
    }), false)
    assert.equal(approvalService.consumeApprovalGrant({ approvalId: wrongGrant.approvalId, request: callRequest, actor }), true)
    assert.equal(approvalService.consumeApprovalGrant({ approvalId: wrongGrant.approvalId, request: callRequest, actor }), false)

    const committed = workflowService.commitCharacterDraft(callRequest.input)
    assert.deepEqual(committed.createdCharacterNames, ['林渡'])
    assert.equal(committed.contextVersionBefore, 1)
    assert.equal(committed.contextVersionAfter, 2)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM characters WHERE novel_id = ?').get(novelId).count, 1)
    assert.equal(sqlite.prepare('SELECT context_version FROM novels WHERE id = ?').get(novelId).context_version, 2)

    const denied = await novelForgeToolRegistry.invoke({ ...callRequest, approvalId: 'forged' }, {
      actor,
      scopes: [...DESKTOP_AGENT_TOOL_SCOPES],
    })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'APPROVAL_REQUIRED')

    const replayGrant = approvalService.createApprovalGrant({ request: callRequest, actor })
    assert.equal(approvalService.consumeApprovalGrant({ approvalId: replayGrant.approvalId, request: callRequest, actor }), true)
    const replay = await novelForgeToolRegistry.invoke({ ...callRequest, approvalId: replayGrant.approvalId }, {
      actor,
      scopes: [...DESKTOP_AGENT_TOOL_SCOPES],
      approvalId: replayGrant.approvalId,
    })
    assert.equal(replay.ok, true)
    assert.equal(replay.data.idempotentReplay, true)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM characters WHERE novel_id = ?').get(novelId).count, 1)

    await novelForgeToolRegistry.invoke({
      toolId: 'novelforge.artifacts.list',
      input: { novelId, limit: 10 },
    }, { actor, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] })
    const audits = auditService.queryAgentToolInvocations({ novelId, limit: 20 })
    assert.ok(audits.some((entry) => entry.toolId === 'novelforge.characters.commit_draft' && entry.status === 'denied'))
    assert.ok(audits.some((entry) => entry.toolId === 'novelforge.characters.commit_draft' && entry.status === 'success'))
    assert.ok(audits.every((entry) => !JSON.stringify(entry.redactedInput).includes(replayGrant.approvalId)))
    const missingProject = await novelForgeToolRegistry.invoke({
      toolId: 'novelforge.projects.get',
      input: { novelId: 99999999 },
    }, { actor, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] })
    assert.equal(missingProject.ok, false)
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM tool_invocations
      WHERE tool_id = 'novelforge.projects.get' AND novel_id IS NULL
    `).get().count, 1)

    const recommendationNovel = sqlite.prepare(`
      INSERT INTO novels (title, status, target_words, context_version)
      VALUES ('推荐门测试', 'serializing', 200000, 1)
    `).run()
    const recommendationNovelId = Number(recommendationNovel.lastInsertRowid)
    sqlite.prepare(`
      INSERT INTO chapters (
        novel_id, chapter_num, title, content, word_count, status,
        target_words, context_version, quality_scores_json
      ) VALUES (?, 1, '第一章', ?, 1200, 'final', 1200, 1, ?)
    `).run(
      recommendationNovelId,
      '潮水退去后，证人把第五封信放在没有灯的桌面上。'.repeat(60),
      JSON.stringify({
        dimensions: [
          { name: '文笔质量', score: 9 }, { name: '逻辑连贯', score: 9 },
          { name: '节奏控制', score: 9 }, { name: '情感深度', score: 9 },
          { name: '人物塑造', score: 9 }, { name: '世界一致', score: 9 },
          { name: '创新性', score: 9 }, { name: '追读欲', score: 9 },
        ],
        ai_like_rate: 5,
        overall_score: 90,
        weak_dimensions: [],
      }),
    )

    const qualityEvaluationRequest = {
      toolId: 'novelforge.quality.run_evaluation',
      input: {
        novelId: recommendationNovelId,
        profile: 'longform_health_v1',
        maxFindings: 20,
        idempotencyKey: 'integration-quality-report-1',
      },
    }
    const qualityEvaluation = await novelForgeToolRegistry.invoke(qualityEvaluationRequest, {
      actor,
      scopes: [...DESKTOP_AGENT_TOOL_SCOPES],
    })
    assert.equal(qualityEvaluation.ok, true)
    assert.equal(qualityEvaluation.data.reportArtifact.kind, 'quality_report')
    assert.equal(qualityEvaluation.data.report.contextVersion, 1)
    const qualityReplay = await novelForgeToolRegistry.invoke(qualityEvaluationRequest, {
      actor,
      scopes: [...DESKTOP_AGENT_TOOL_SCOPES],
    })
    assert.equal(qualityReplay.ok, true)
    assert.equal(qualityReplay.data.idempotentReplay, true)

    const repairPlan = await novelForgeToolRegistry.invoke({
      toolId: 'novelforge.quality.propose_repairs',
      input: {
        novelId: recommendationNovelId,
        reportArtifactId: qualityEvaluation.data.reportArtifact.id,
        goals: ['优先关闭硬阻塞并防止 AI 痕迹复现'],
        idempotencyKey: 'integration-quality-repair-plan-1',
      },
    }, { actor, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] })
    assert.equal(repairPlan.ok, true)
    assert.equal(repairPlan.data.repairPlanArtifact.kind, 'repair_plan')
    assert.equal(repairPlan.data.plan.canonicalWriteAllowed, false)

    const staleReviewDraft = artifactService.createArtifact({
      novelId: recommendationNovelId,
      kind: 'quality_repair_draft',
      status: 'draft',
      parentArtifactId: repairPlan.data.repairPlanArtifact.id,
      content: {
        schemaVersion: 'agent-quality-repair-draft-v1',
        requestFingerprint: `sha256:${'d'.repeat(64)}`,
        repairPlanArtifactId: repairPlan.data.repairPlanArtifact.id,
        repairPlanContentHash: repairPlan.data.repairPlanArtifact.contentHash,
        sourceReportArtifactId: qualityEvaluation.data.reportArtifact.id,
        sourceContextVersion: 1,
        selectedRepairItemIds: [],
        status: 'ready_for_review',
        summary: '用于验证过期语义审校拒绝。',
        hardBlockers: [],
        warnings: [],
        chapters: [],
        readyForHumanReview: true,
        canonicalWriteAllowed: false,
        requiresFreshEvaluationAfterApply: true,
        createdAt: new Date().toISOString(),
      },
      contextVersion: 1,
      producerType: 'system',
      producerId: 'integration-fixture',
      producerClient: 'integration-test',
      idempotencyKey: 'integration-review-stale-fixture',
    })

    sqlite.prepare('UPDATE novels SET context_version = 2 WHERE id = ?').run(recommendationNovelId)
    const staleSemanticEvaluation = await novelForgeToolRegistry.invoke({
      toolId: 'novelforge.quality.run_semantic_evaluation',
      input: {
        novelId: recommendationNovelId,
        reportArtifactId: qualityEvaluation.data.reportArtifact.id,
        idempotencyKey: 'integration-stale-semantic-quality-report',
      },
    }, { actor, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] })
    assert.equal(staleSemanticEvaluation.ok, false)
    assert.equal(staleSemanticEvaluation.error.code, 'QUALITY_REPORT_STALE')
    const staleRepairDraft = await novelForgeToolRegistry.invoke({
      toolId: 'novelforge.quality.apply_repair_draft',
      input: {
        novelId: recommendationNovelId,
        repairPlanArtifactId: repairPlan.data.repairPlanArtifact.id,
        idempotencyKey: 'integration-stale-quality-repair-draft',
      },
    }, { actor, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] })
    assert.equal(staleRepairDraft.ok, false)
    assert.equal(staleRepairDraft.error.code, 'REPAIR_PLAN_STALE')
    const staleSemanticReview = await novelForgeToolRegistry.invoke({
      toolId: 'novelforge.quality.review_repair_draft',
      input: {
        novelId: recommendationNovelId,
        repairDraftArtifactId: staleReviewDraft.id,
        idempotencyKey: 'integration-stale-quality-repair-review',
      },
    }, { actor, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] })
    assert.equal(staleSemanticReview.ok, false)
    assert.equal(staleSemanticReview.error.code, 'REPAIR_DRAFT_STALE')
    const candidateQuality = await novelForgeToolRegistry.invoke({
      toolId: 'novelforge.quality.run_evaluation',
      input: {
        novelId: recommendationNovelId,
        profile: 'longform_health_v1',
        maxFindings: 20,
        baselineReportArtifactId: qualityEvaluation.data.reportArtifact.id,
        idempotencyKey: 'integration-quality-report-2',
      },
    }, { actor, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] })
    assert.equal(candidateQuality.ok, true)
    assert.equal(candidateQuality.data.report.contextVersion, 2)
    const qualityComparison = await novelForgeToolRegistry.invoke({
      toolId: 'novelforge.quality.compare_runs',
      input: {
        novelId: recommendationNovelId,
        baselineReportArtifactId: qualityEvaluation.data.reportArtifact.id,
        candidateReportArtifactId: candidateQuality.data.reportArtifact.id,
      },
    }, { actor, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] })
    assert.equal(qualityComparison.ok, true)
    assert.equal(qualityComparison.data.profileCompatible, true)
    assert.equal(qualityComparison.data.scopeCompatible, true)
    const qualityAudits = auditService.queryAgentToolInvocations({ novelId: recommendationNovelId, limit: 20 })
    assert.ok(qualityAudits.some((entry) => entry.toolId === 'novelforge.quality.run_evaluation' && entry.status === 'success'))
    assert.ok(qualityAudits.some((entry) => entry.toolId === 'novelforge.quality.run_semantic_evaluation' && entry.errorCode === 'QUALITY_REPORT_STALE'))
    assert.ok(qualityAudits.some((entry) => entry.toolId === 'novelforge.quality.propose_repairs' && entry.status === 'success'))
    assert.ok(qualityAudits.some((entry) => entry.toolId === 'novelforge.quality.apply_repair_draft' && entry.errorCode === 'REPAIR_PLAN_STALE'))
    assert.ok(qualityAudits.some((entry) => entry.toolId === 'novelforge.quality.review_repair_draft' && entry.errorCode === 'REPAIR_DRAFT_STALE'))
    assert.ok(qualityAudits.some((entry) => entry.toolId === 'novelforge.quality.compare_runs' && entry.status === 'success'))

    const preflight = recommendationService.runRecommendationPreflight({ novelId: recommendationNovelId })
    assert.equal(preflight.countedExternalAttempt, false)
    assert.equal(recommendationService.getRecommendationAttemptState(recommendationNovelId).totalEvaluationCount, 0)
    sqlite.prepare(`
      UPDATE recommendation_preflight_runs
      SET status = 'ready', score = 90, confidence_lower_bound = 85,
          coverage_rate = 100, blockers_json = '[]'
      WHERE id = ?
    `).run(preflight.runId)
    const candidate = recommendationService.lockRecommendationCandidate({
      novelId: recommendationNovelId,
      preflightRunId: preflight.runId,
      expectedContextVersion: preflight.contextVersion,
      expectedContentHash: preflight.contentHash,
    }, { actor, approvalId: 'integration-recommendation-approval' })
    const firstFailureInput = {
      novelId: recommendationNovelId,
      candidateId: candidate.id,
      source: 'author_requested',
      outcome: 'failed',
      confirmedBy: 'integration-editor',
      failureReason: '开篇留存不足',
      idempotencyKey: 'recommendation-failure-1',
      evidence: { receipt: 'integration-1' },
    }
    const firstFailure = recommendationService.recordRecommendationEvaluation(firstFailureInput, { actor, approvalId: 'integration-recommendation-approval' })
    assert.equal(firstFailure.state.totalEvaluationCount, 1)
    assert.equal(firstFailure.state.status, 'eligible')
    const firstReplay = recommendationService.recordRecommendationEvaluation(firstFailureInput, { actor, approvalId: 'integration-recommendation-approval' })
    assert.equal(firstReplay.idempotentReplay, true)
    assert.equal(firstReplay.state.totalEvaluationCount, 1)
    assert.throws(
      () => recommendationService.recordRecommendationEvaluation({
        ...firstFailureInput,
        failureReason: '试图用同一幂等键覆盖失败原因',
      }, { actor, approvalId: 'integration-recommendation-approval' }),
      (error) => error && error.code === 'IDEMPOTENCY_KEY_CONFLICT',
    )
    recommendationService.recordRecommendationEvaluation({ ...firstFailureInput, idempotencyKey: 'recommendation-failure-2' }, { actor, approvalId: 'integration-recommendation-approval' })
    const thirdFailure = recommendationService.recordRecommendationEvaluation({ ...firstFailureInput, idempotencyKey: 'recommendation-failure-3' }, { actor, approvalId: 'integration-recommendation-approval' })
    assert.equal(thirdFailure.state.status, 'recommendation_locked')
    assert.equal(thirdFailure.state.failedEvaluationCount, 3)
    assert.throws(
      () => recommendationService.recordRecommendationEvaluation({ ...firstFailureInput, idempotencyKey: 'recommendation-failure-4' }, { actor, approvalId: 'integration-recommendation-approval' }),
      (error) => error && (error.code === 'RECOMMENDATION_LOCKED' || error.code === 'RECOMMENDATION_ATTEMPTS_EXHAUSTED'),
    )

    const completedNovel = sqlite.prepare(`
      INSERT INTO novels (title, status, target_words, context_version)
      VALUES ('完结推荐门测试', 'completed', 10000, 1)
    `).run()
    const completedNovelId = Number(completedNovel.lastInsertRowid)
    sqlite.prepare(`
      INSERT INTO recommendation_preflight_runs (
        novel_id, profile_version, status, score, confidence_lower_bound,
        coverage_rate, context_version, content_hash, counted_external_attempt
      ) VALUES (?, 'integration-v1', 'ready', 90, 85, 100, 1, ?, 0)
    `).run(completedNovelId, `sha256:${'c'.repeat(64)}`)
    const completedPreflightId = Number(sqlite.prepare(`SELECT id FROM recommendation_preflight_runs WHERE novel_id = ?`).get(completedNovelId).id)
    const completedCandidateInfo = sqlite.prepare(`
      INSERT INTO recommendation_candidates (
        novel_id, preflight_run_id, status, context_version, content_hash,
        snapshot_json, actor_type, actor_id, client_id, approval_id, locked_at
      ) VALUES (?, ?, 'locked', 1, ?, '{}', 'human', 'integration-user', 'integration-client', 'approval', ?)
    `).run(completedNovelId, completedPreflightId, `sha256:${'c'.repeat(64)}`, new Date().toISOString())
    const completedFailure = recommendationService.recordRecommendationEvaluation({
      novelId: completedNovelId,
      candidateId: Number(completedCandidateInfo.lastInsertRowid),
      source: 'platform_auto',
      outcome: 'failed',
      confirmedBy: 'integration-platform',
      failureReason: '完结质量未通过',
      idempotencyKey: 'completed-recommendation-failure-1',
    }, { actor, approvalId: 'integration-recommendation-approval' })
    assert.equal(completedFailure.state.status, 'recommendation_locked')
    assert.equal(completedFailure.state.failureLockThreshold, 1)
    assert.equal(sqlite.prepare(`
      SELECT work_state_at_evaluation AS workState
      FROM external_evaluation_attempts
      WHERE novel_id = ?
    `).get(completedNovelId).workState, 'completed')
    sqlite.prepare(`UPDATE novels SET status = 'serializing' WHERE id = ?`).run(completedNovelId)
    const historicalCompletedFailureState = recommendationService.getRecommendationAttemptState(completedNovelId)
    assert.equal(historicalCompletedFailureState.status, 'recommendation_locked')
    assert.equal(historicalCompletedFailureState.failureLockThreshold, 1)
    assert.throws(
      () => recommendationService.recordRecommendationEvaluation({
        novelId: completedNovelId,
        candidateId: Number(completedCandidateInfo.lastInsertRowid),
        source: 'platform_auto',
        outcome: 'failed',
        confirmedBy: 'integration-platform',
        failureReason: '不得通过回退作品状态绕过完结锁定',
        idempotencyKey: 'completed-recommendation-failure-2',
      }, { actor, approvalId: 'integration-recommendation-approval' }),
      (error) => error && error.code === 'RECOMMENDATION_LOCKED',
    )

    console.log(`agent workflow integration passed: novel=${novelId}, artifacts=${artifactService.listArtifacts({ novelId }).length}, audits=${audits.length}, qualityAudits=${qualityAudits.length}, recommendationAttempts=${thirdFailure.state.totalEvaluationCount}`)
  } finally {
    closeDb()
  }
}

app.whenReady().then(async () => {
  try {
    await run()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
