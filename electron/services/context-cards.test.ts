import { describe, expect, it } from 'vitest'
import type { characters } from '../database/schema'
import {
  buildCharacterContextCards,
  pickProtagonistDramaticEngine,
  renderCharacterCards,
} from './context-cards'

type CharacterRow = typeof characters.$inferSelect

function buildCharacterRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1,
    novelId: 1,
    roleType: 'protagonist',
    recordStatus: 'confirmed',
    fullName: '沈砚青',
    dramaticEngine: '每次退让都会让他离“证明自己不是废物”更远',
    goals: '守住锅炉岗位',
    sortOrder: 0,
    ...overrides,
  } as CharacterRow
}

describe('角色卡携带戏剧引擎', () => {
  it('buildCharacterContextCards 输出 dramaticEngine 字段并在渲染中可见', () => {
    const cards = buildCharacterContextCards({
      allCharacters: [buildCharacterRow()],
      relationRows: [],
    })
    expect(cards).toHaveLength(1)
    expect(cards[0].dramaticEngine).toContain('证明自己不是废物')

    const rendered = renderCharacterCards(cards)
    expect(rendered).toContain('戏剧引擎=')
    expect(rendered).toContain('证明自己不是废物')
  })

  it('未填写戏剧引擎时渲染不输出空字段', () => {
    const rendered = renderCharacterCards(buildCharacterContextCards({
      allCharacters: [buildCharacterRow({ dramaticEngine: null })],
      relationRows: [],
    }))
    expect(rendered).not.toContain('戏剧引擎=')
  })
})

describe('pickProtagonistDramaticEngine', () => {
  it('优先取 confirmed 主角的非空戏剧引擎', () => {
    const engine = pickProtagonistDramaticEngine([
      { roleType: 'protagonist', recordStatus: 'draft', dramaticEngine: '草稿引擎' },
      { roleType: 'protagonist', recordStatus: 'confirmed', dramaticEngine: '正式引擎' },
      { roleType: 'major', recordStatus: 'confirmed', dramaticEngine: '配角引擎' },
    ])
    expect(engine).toBe('正式引擎')
  })

  it('没有 confirmed 主角时容忍草稿态；非主角不参与', () => {
    expect(pickProtagonistDramaticEngine([
      { roleType: 'protagonist', recordStatus: 'draft', dramaticEngine: '草稿引擎' },
    ])).toBe('草稿引擎')
    expect(pickProtagonistDramaticEngine([
      { roleType: 'major', recordStatus: 'confirmed', dramaticEngine: '配角引擎' },
    ])).toBe('')
  })

  it('主角未填写戏剧引擎时返回空串（critic 跳过 dramatic_drive）', () => {
    expect(pickProtagonistDramaticEngine([
      { roleType: 'protagonist', recordStatus: 'confirmed', dramaticEngine: '  ' },
    ])).toBe('')
    expect(pickProtagonistDramaticEngine([])).toBe('')
  })
})
