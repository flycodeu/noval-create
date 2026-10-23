import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContentDocument } from './ContentDocument'
import { AtlasFields } from './AtlasFields'
import { authorText } from './author-content'
import { atlasEditedAttributes } from './atlas-profile'

describe('author content presentation', () => {
  it('hides process fields in both document and atlas views without mutating stored records', () => {
    const value = { authorPlanning: { truth_boundary: '内部边界', approvalSource: '审批来源', characterArc: '为救同伴放弃报酬' }, profileDesignStatus: 'user_approved_author_design', enabled: false, cost: 0 }
    const original = structuredClone(value)
    for (const html of [renderToStaticMarkup(React.createElement(ContentDocument, { value })), renderToStaticMarkup(React.createElement(AtlasFields, { values: value, entities: [], chapters: [] }))]) {
      expect(html).toContain('为救同伴放弃报酬')
      expect(html).not.toContain('内部边界')
      expect(html).not.toContain('审批来源')
      expect(html).not.toContain('user_approved_author_design')
      expect(html).toContain('否')
      expect(html).toContain('0')
    }
    expect(value).toEqual(original)
  })
  it('removes only the specific process heading and keeps plot, dates and ordinary author notes', () => {
    expect(authorText('【2026-10-15扩展采纳｜作者规划】\n段宁决定留下。\n2026-10-15：修灯。\n【作者规划】林芷先救人。')).toBe('段宁决定留下。\n2026-10-15：修灯。\n【作者规划】林芷先救人。')
    expect(authorText('作者规划并不是秘密；此处让读者先看见脚印。')).toBe('作者规划并不是秘密；此处让读者先看见脚印。')
  })
  it('preserves internal fields and reference ids when editing visible attributes', () => {
    const old = { approval_source: 'human', characterId: 'character:1', notes: '旧关系', authorPlanning: { future: '重逢', revision: 2 } }
    expect(atlasEditedAttributes(old, { ...old, approval_source: 'other', characterId: 'character:2', notes: '新关系' })).toEqual({ notes: '新关系' })
  })
})
