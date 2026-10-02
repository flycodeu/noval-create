import * as characterService from '../services/character.service'
import * as novelService from '../services/novel.service'
import * as taskService from '../services/task.service'
import * as artifactService from '../services/artifact.service'
import * as agentToolAuditService from '../services/agent-tool-audit.service'
import { registerArtifactTools } from './artifact-tools'
import { registerCoreReadTools } from './core-read-tools'
import { registerCreativeTools } from './creative-tools'
import { AgentToolRegistry } from './tool-registry'

/** One public surface for desktop and external AI. */
export function createNovelForgeToolRegistry(): AgentToolRegistry {
  const registry = registerCoreReadTools(new AgentToolRegistry(agentToolAuditService.recordAgentToolInvocation), {
    listProjects: () => novelService.listNovels(),
    getProject: (novelId) => novelService.getNovel(novelId),
    listCharacters: (novelId) => characterService.listCharacters(novelId),
    getTask: (taskId) => taskService.getTaskRecord(taskId),
  })
  registerArtifactTools(registry, { getArtifact: (id) => artifactService.getArtifact(id), listArtifacts: (query) => artifactService.listArtifacts(query) })
  return registerCreativeTools(registry)
}

export const novelForgeToolRegistry = createNovelForgeToolRegistry()
