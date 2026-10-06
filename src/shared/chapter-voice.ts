/** One chapter voice card. Scene jobs stay concrete; a fact stays on its scene line; the craft note is said once. */

export interface ChapterSceneCard {
  segmentOrder?: number
  pov?: string
  sceneGoal?: string
  obstacle?: string
  resultState?: string
}

export interface ChapterVoiceInput {
  scenes: ChapterSceneCard[]
  /** Avoid lines already observed in this book. The caller caps and cleans them. */
  recurringAvoids?: string[]
  /** Known only inside that scene. Not copied onto other scenes. */
  sceneFacts?: Array<{ sceneOrder: number; text: string }>
}

const CRAFT_NOTE = '按各场自己的视角写。这个人还不知道的事，不要写成他的判断、内心或口吻。'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function factsForScene(facts: ChapterVoiceInput['sceneFacts'], order: number): string[] {
  return (facts || [])
    .filter(fact => fact.sceneOrder === order)
    .map(fact => clean(fact.text))
    .filter(text => text.length > 0)
}

function sceneLine(scene: ChapterSceneCard, index: number, facts: ChapterVoiceInput['sceneFacts']): string {
  const order = typeof scene.segmentOrder === 'number' ? scene.segmentOrder : index + 1
  const fields = [`场景${order}`]
  const pov = clean(scene.pov)
  const goal = clean(scene.sceneGoal)
  const obstacle = clean(scene.obstacle)
  const result = clean(scene.resultState)
  if (pov) fields.push(`视角：${pov}`)
  if (goal) fields.push(`要完成：${goal}`)
  if (obstacle) fields.push(`阻碍：${obstacle}`)
  if (result) fields.push(`场末状态：${result}`)
  const known = factsForScene(facts, order)
  if (fields.length === 1 && known.length === 0) return ''
  for (const text of known) fields.push(`本场已知：${text}`)
  return fields.join('；')
}

/** Returns an empty string when there is nothing to tell the writer. */
export function formatChapterVoice(input: ChapterVoiceInput): string {
  const cards = input.scenes.map((scene, index) => sceneLine(scene, index, input.sceneFacts)).filter(Boolean)
  const avoids = (input.recurringAvoids || []).map(clean).filter(Boolean).slice(0, 3)
  if (!cards.length && !avoids.length) return ''
  const parts = [CRAFT_NOTE]
  if (avoids.length) parts.push(`本书近章容易重复，这一章避开：${avoids.join('；')}`)
  if (cards.length) parts.push(cards.join('\n'))
  return parts.join('\n')
}
