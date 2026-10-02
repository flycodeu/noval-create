// Browser clients may use registered story operations, never native window or shell commands.
const STORY_SERVICES = new Set([
  'agentTool', 'storyAtlas', 'novel', 'model', 'sourceSearch', 'ai', 'aiPatch', 'chapter', 'chapterBatch',
  'character', 'map', 'narrativeBoard', 'creativeStage', 'item', 'thread', 'faction', 'glossary',
  'sceneTemplate', 'template', 'prompt', 'structure', 'outline', 'rhythm', 'timeline', 'characterArc',
  'resistance', 'endgameAsset', 'foreshadow', 'volumeDesign', 'contract', 'storyFact', 'knowledgeBoundary',
  'growthSystem', 'task', 'workflow', 'workflowNode', 'history', 'revision', 'premiseDraft', 'planningDraft',
  'subplot', 'worldRules', 'batchWorkbench', 'writeback', 'quality', 'embedding', 'style', 'parallel',
])
const APP_METHODS = new Set(['getDatabasePath', 'getMaintenanceStatus', 'getCapabilities', 'getUpdateStatus', 'getCodexMcpSetupStatus'])
const SENSITIVE_METHODS: Record<string, Set<string>> = {
  model: new Set(['list', 'create', 'update', 'delete', 'setDefault', 'test']),
  sourceSearch: new Set(['getSettings', 'updateSettings', 'test']),
  agentTool: new Set(['list', 'call']),
}

export function resolveRuntimeRpcChannel(service: string, method: string): string | null {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(service) || !/^[A-Za-z][A-Za-z0-9]*$/.test(method)) return null
  const namespace = service === 'agentTools' ? 'agentTool' : service
  if (namespace === 'app') return APP_METHODS.has(method) ? `app:${method}` : null
  if (SENSITIVE_METHODS[namespace] && !SENSITIVE_METHODS[namespace].has(method)) return null
  if (!STORY_SERVICES.has(namespace) || (namespace === 'agentTool' && method === 'approve')
    || (namespace === 'novel' && method === 'export')) return null
  return `${namespace}:${method}`
}
