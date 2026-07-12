import * as characterService from '../services/character.service'
import * as novelService from '../services/novel.service'
import * as taskService from '../services/task.service'
import * as characterCastPlanningService from '../services/character-cast-planning.service'
import * as recommendationGovernanceService from '../services/recommendation-governance.service'
import * as artifactService from '../services/artifact.service'
import * as characterDraftWorkflowService from '../services/character-draft-workflow.service'
import * as agentToolAuditService from '../services/agent-tool-audit.service'
import * as genericAssetWorkflowService from '../services/generic-asset-workflow.service'
import * as qualityAgentWorkflowService from '../services/quality-agent-workflow.service'
import { registerArtifactTools } from './artifact-tools'
import { registerAuditTools } from './audit-tools'
import { registerCharacterDraftTools } from './character-draft-tools'
import { registerCharacterPlanningTools } from './character-tools'
import { registerCoreReadTools } from './core-read-tools'
import { registerGenericAssetTools } from './generic-asset-tools'
import { registerRecommendationTools } from './recommendation-tools'
import { registerQualityTools } from './quality-tools'
import { AgentToolRegistry } from './tool-registry'

export function createNovelForgeToolRegistry(): AgentToolRegistry {
  const registry = registerCoreReadTools(new AgentToolRegistry(agentToolAuditService.recordAgentToolInvocation), {
    listProjects: () => novelService.listNovels(),
    getProject: (novelId) => novelService.getNovel(novelId),
    listCharacters: (novelId) => characterService.listCharacters(novelId),
    getTask: (taskId) => taskService.getTaskRecord(taskId),
  })
  registerCharacterPlanningTools(registry, {
    analyzeNeeds: (input) => characterCastPlanningService.analyzeCharacterNeeds(input),
  })
  registerCharacterDraftTools(registry, {
    generateDraft: (input) => characterDraftWorkflowService.generateCharacterDraft(input),
    reviewDraft: (input) => characterDraftWorkflowService.reviewCharacterDraft(input),
    commitDraft: (input) => characterDraftWorkflowService.commitCharacterDraft(input),
  })
  registerGenericAssetTools(registry, {
    generateDraft: (input) => genericAssetWorkflowService.generateGenericAssetDraft(input),
    reviewDraft: (input) => genericAssetWorkflowService.reviewGenericAssetDraft(input),
  })
  registerArtifactTools(registry, {
    getArtifact: (artifactId) => artifactService.getArtifact(artifactId),
    listArtifacts: (query) => artifactService.listArtifacts(query),
  })
  registerAuditTools(registry, {
    queryInvocations: (query) => agentToolAuditService.queryAgentToolInvocations(query),
  })
  registerQualityTools(registry, {
    runEvaluation: (input) => qualityAgentWorkflowService.runAgentQualityEvaluation(input),
    runSemanticEvaluation: (input) => qualityAgentWorkflowService.runAgentQualitySemanticEvaluation(input),
    proposeRepairs: (input) => qualityAgentWorkflowService.proposeAgentQualityRepairs(input),
    applyRepairDraft: (input) => qualityAgentWorkflowService.applyAgentQualityRepairDraft(input),
    reviewRepairDraft: (input) => qualityAgentWorkflowService.reviewAgentQualityRepairDraft(input),
    compareRuns: (input) => qualityAgentWorkflowService.compareAgentQualityRuns(input),
  })
  return registerRecommendationTools(registry, {
    getAttemptState: (novelId) => recommendationGovernanceService.getRecommendationAttemptState(novelId),
    getWorkspace: (novelId) => recommendationGovernanceService.getRecommendationWorkspaceSnapshot(novelId),
    runPreflight: (input) => recommendationGovernanceService.runRecommendationPreflight(input),
    lockCandidate: (input, context) => recommendationGovernanceService.lockRecommendationCandidate(input, context),
    recordEvaluation: (input, context) => recommendationGovernanceService.recordRecommendationEvaluation(input, context),
  })
}

export const novelForgeToolRegistry = createNovelForgeToolRegistry()
