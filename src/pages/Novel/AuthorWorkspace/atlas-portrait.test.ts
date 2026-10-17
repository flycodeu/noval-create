import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity } from '../../../shared/story-atlas'
import { STORY_ATLAS_ATTRIBUTE_SCHEMAS } from '../../../shared/story-atlas'
import { validateJsonSchema } from '../../../shared/tool-contracts'
import { atlasPortraitImage, buildAtlasPortraitPrompt, importAtlasPortrait } from './atlas-portrait'
import { profileFieldGroups } from './atlas-profile'

const image = 'data:image/webp;base64,UklGRg=='
const character: StoryAtlasEntity = { id: 'character:1', kind: 'character', name: '陆闻', summary: '作者隐藏剧情', parentId: null, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' }, attributes: { appearance: '眼尾有浅疤', clothing: '洗旧的青布短衣', carriedItems: '小册与炭笔', physicalHabits: '抬手时先拢袖口', portraitImage: image, portraitPrompt: '作者视觉方案' } }

describe('optional character portraits', () => {
  it('uses only saved appearance details in a reusable visual brief', () => {
    const prompt = buildAtlasPortraitPrompt(character)
    expect(prompt).toContain('眼尾有浅疤')
    expect(prompt).toContain('常用衣着：洗旧的青布短衣')
    expect(prompt).toContain('随身物品：小册与炭笔')
    expect(prompt).toContain('动作与体态：抬手时先拢袖口')
    expect(prompt).not.toContain('作者隐藏剧情')
    expect(prompt).not.toContain('UklGRg')
    expect(prompt).not.toContain('年龄：')
  })
  it('accepts only bounded embedded raster portraits, excluding remote links and executable formats', () => {
    expect(atlasPortraitImage(image)).toBe(image)
    expect(atlasPortraitImage('https://example.com/portrait.png')).toBeUndefined()
    expect(atlasPortraitImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeUndefined()
    expect(atlasPortraitImage('data:image/png;base64,' + 'A'.repeat(12000))).toBeUndefined()
    expect(validateJsonSchema({ portraitImage: image }, STORY_ATLAS_ATTRIBUTE_SCHEMAS.character!).valid).toBe(true)
    expect(validateJsonSchema({ portraitImage: 'javascript:alert(1)' }, STORY_ATLAS_ATTRIBUTE_SCHEMAS.character!).valid).toBe(false)
    expect(validateJsonSchema({ appearance: { description: '眉骨平直', heightCm: 178, complexion: '偏白' }, portraitImage: image }, STORY_ATLAS_ATTRIBUTE_SCHEMAS.character!).valid).toBe(true)
  })
  it('keeps portrait bytes out of textual dossier groups while showing clothes, possessions and movement', () => {
    const groups = profileFieldGroups(character)
    expect(groups.find(group => group.title === '外貌与衣着')?.values).toMatchObject({ clothing: '洗旧的青布短衣', carriedItems: '小册与炭笔', physicalHabits: '抬手时先拢袖口' })
    expect(groups.some(group => 'portraitImage' in group.values || 'portraitPrompt' in group.values)).toBe(false)
  })
  it('rejects unsuitable uploads before attempting to decode them', async () => {
    await expect(importAtlasPortrait({ type: 'image/svg+xml', size: 20 } as File)).rejects.toThrow('PNG、JPEG 或 WebP')
    await expect(importAtlasPortrait({ type: 'image/png', size: 6 * 1024 * 1024 } as File)).rejects.toThrow('5MB')
  })
})
