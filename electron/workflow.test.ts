import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowSource = fs.readFileSync(
  path.resolve(__dirname, '../src/pages/Novel/workflow.ts'),
  'utf8',
)

describe('novel workflow ordering', () => {
  it('keeps the character roster ahead of items in the guided step order', () => {
    const guidedOrder = workflowSource.slice(
      workflowSource.indexOf('export const GUIDED_STEP_ORDER'),
      workflowSource.indexOf('export const GUIDED_STEP_LABELS'),
    )

    expect(guidedOrder.indexOf("'character-roster'"))
      .toBeLessThan(guidedOrder.indexOf("'items-equipment'"))
  })

  it('does not require items, the endgame, or a map before character generation', () => {
    const charactersCase = workflowSource.slice(
      workflowSource.indexOf("case 'characters':"),
      workflowSource.indexOf("case 'items':"),
    )

    expect(charactersCase).not.toContain('requireItems(')
    expect(charactersCase).not.toContain('requireEndgame(')
    expect(charactersCase).not.toContain('requireMap(')
  })
})
