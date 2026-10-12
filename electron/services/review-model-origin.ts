interface ModelIdentity { id: number; modelId: string }

/** Compare declared routes only; configuration IDs do not establish independent judgment. */
export function reviewModelOriginNote(generation: ModelIdentity | undefined, reviewer: ModelIdentity | undefined, currentSettings = false): string {
  if (!generation || !reviewer) return ''
  if (generation.id === reviewer.id) return currentSettings
    ? '本次审校使用当前生成模型配置。'
    : '审校与生成使用同一模型配置。'
  if (generation.modelId.trim() === reviewer.modelId.trim()) return currentSettings
    ? '本次审校与当前生成设置的配置不同，但模型标识相同。'
    : '审校与生成的配置不同，但模型标识相同，不能视为不同模型的独立验证。'
  return ''
}
