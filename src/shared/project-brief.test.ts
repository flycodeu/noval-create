import { describe, expect, it } from 'vitest'
import {
  buildProjectBriefPayload,
  buildProjectBriefSummary,
  getPlatformDesignProfile,
  isProjectPlatformMode,
  parseProjectBriefDocument,
} from './project-brief'

describe('project brief platform strategy', () => {
  it('supports platform-specific modes while preserving legacy modes', () => {
    expect(isProjectPlatformMode('fanqie')).toBe(true)
    expect(isProjectPlatformMode('feilu')).toBe(true)
    expect(isProjectPlatformMode('web_serial')).toBe(true)
    expect(isProjectPlatformMode('unknown')).toBe(false)

    expect(parseProjectBriefDocument('{"platform_mode":"fanqie"}').platformMode).toBe('fanqie')
    expect(parseProjectBriefDocument('{"platformMode":"not-a-platform"}').platformMode).toBe('')
  })

  it('exposes different design constraints for tomato and feilu', () => {
    const fanqie = getPlatformDesignProfile('fanqie')
    const feilu = getPlatformDesignProfile('feilu')

    expect(fanqie.label).toBe('番茄小说')
    expect(fanqie.openingFocus).toContain('即时损失')
    expect(feilu.label).toBe('飞卢小说')
    expect(feilu.rhythmFocus).toContain('动作结果')
    expect(fanqie.rhythmFocus).not.toBe(feilu.rhythmFocus)
  })

  it('injects the selected platform strategy into downstream context payloads', () => {
    const payload = buildProjectBriefPayload({
      platformMode: 'feilu',
      targetAudience: '男频都市异能',
    })
    const summary = buildProjectBriefSummary(parseProjectBriefDocument(payload))

    expect(summary).toContain('目标平台：飞卢小说')
    expect(summary).toContain('平台风险：')
    expect(summary).toContain('目标赛道：男频都市异能')
  })
})
