import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowSource = fs.readFileSync(
  path.resolve(__dirname, '../src/pages/Novel/workflow.ts'),
  'utf8',
)

const guideSource = fs.readFileSync(
  path.resolve(__dirname, '../src/pages/Novel/Guide/index.tsx'),
  'utf8',
)

function findStepKeyIndex(source: string, key: string) {
  return source.search(new RegExp(`key:\\s*['"]${key}['"]`))
}

describe('novel workflow ordering', () => {
  it('keeps items ahead of characters in the guided step order', () => {
    const guidedOrder = workflowSource.slice(
      workflowSource.indexOf('export const GUIDED_STEP_ORDER'),
      workflowSource.indexOf('export const EMPTY_WORKFLOW_STATS'),
    )

    expect(guidedOrder.indexOf("'items-equipment'"))
      .toBeLessThan(guidedOrder.indexOf("'character-roster'"))
  })

  it('blocks character generation until items exist', () => {
    const charactersCase = workflowSource.slice(
      workflowSource.indexOf("case 'characters':"),
      workflowSource.indexOf("case 'items':"),
    )

    expect(charactersCase).toContain("requireItems('生成人物')")
  })

  it('runs and displays items before characters in the guide workflow', () => {
    const pipelineSection = guideSource.slice(
      guideSource.indexOf('const runPipeline = async () => {'),
      guideSource.indexOf('const recommendedCharacterCount'),
    )
    const stepsSection = guideSource.slice(
      guideSource.indexOf('const steps = useMemo<StepConfig[]>(() => ['),
      guideSource.indexOf('const structureReadyCount'),
    )

    expect(pipelineSection.indexOf("step: 'items'"))
      .toBeLessThan(pipelineSection.indexOf("step: 'characters'"))
    const itemStepIndex = findStepKeyIndex(stepsSection, 'items-equipment')
    const characterStepIndex = findStepKeyIndex(stepsSection, 'character-roster')

    expect(itemStepIndex).toBeGreaterThanOrEqual(0)
    expect(characterStepIndex).toBeGreaterThanOrEqual(0)
    expect(itemStepIndex).toBeLessThan(characterStepIndex)
  })
})
