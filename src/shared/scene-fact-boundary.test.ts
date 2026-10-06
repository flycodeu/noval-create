import { describe, expect, it } from 'vitest'
import { selectStyleParagraphs } from './scene-fact-boundary'

describe('selectStyleParagraphs', () => {
  it('puts viewpoint paragraphs first and returns at most two', () => {
    expect(selectStyleParagraphs([
      '河风很硬，绳子湿了一截。',
      '   ',
      '邱账房对着账本停了停。',
      '陈舟把新绳换上，没回头。',
      '灯还亮着。',
    ], ['陈舟', '邱账房'])).toEqual([
      '邱账房对着账本停了停。',
      '陈舟把新绳换上，没回头。',
    ])
  })

  it('keeps unnamed paragraphs when they are needed to fill the limit', () => {
    expect(selectStyleParagraphs([
      '河风很硬，绳子湿了一截。',
      '陈舟把新绳换上，没回头。',
      '灯还亮着。',
    ], ['陈舟'])).toEqual([
      '陈舟把新绳换上，没回头。',
      '河风很硬，绳子湿了一截。',
    ])
  })
})
