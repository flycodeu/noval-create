import { readAtlasRecords } from '../database/story-atlas-store'
import { getSqlite } from '../database/db'
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
    listCharacters: (novelId) => readAtlasRecords(getSqlite(), novelId).filter(item => !item.retired && item.record.kind === 'character').map(item => {
      const record = item.record
      if (!('name' in record)) throw new Error('Invalid character record')
      const value = (key: string) => typeof record.attributes[key] === 'string' ? record.attributes[key] as string : undefined
      return { id: record.id, nativeId: item.nativeId, novelId, fullName: record.name, summary: record.summary, attributes: record.attributes,
        roleType: value('roleType'), recordStatus: record.status === 'planned' ? 'draft' : 'confirmed', occupation: value('occupation'), goals: value('goals'),
        speechPattern: value('speechPattern'), entityType: value('entityType'), species: value('species'), age: typeof record.attributes.age === 'number' ? record.attributes.age : undefined,
      }
    }),
    getTask: (taskId) => taskService.getTaskRecord(taskId),
  })
  registerArtifactTools(registry, { getArtifact: (id) => artifactService.getArtifact(id), listArtifacts: (query) => artifactService.listArtifacts(query) })
  return registerCreativeTools(registry)
}

export const novelForgeToolRegistry = createNovelForgeToolRegistry()
