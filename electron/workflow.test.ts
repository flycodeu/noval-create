import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowSource = fs.readFileSync(
  path.resolve(__dirname, '../src/pages/Novel/workflow.ts'),
  'utf8',
)

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
})
