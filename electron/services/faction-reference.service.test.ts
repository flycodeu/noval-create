import { describe, expect, it } from 'vitest'
import {
  createFactionCatalog,
  resolveFactionRowsFromCatalog,
} from './faction-reference.service'

describe('faction reference catalog', () => {
  it('resolves mixed id and name references without querying or duplicating rows', () => {
    const rows = [
      { id: 1, novelId: 7, name: '巡防队' },
      { id: 2, novelId: 7, name: '影阁' },
    ] as Array<never>
    const catalog = createFactionCatalog(rows)

    expect(resolveFactionRowsFromCatalog(
      catalog,
      JSON.stringify([1, '影 阁', '1', '不存在', 2]),
    ).map((row) => row.name)).toEqual(['巡防队', '影阁'])
  })
})
