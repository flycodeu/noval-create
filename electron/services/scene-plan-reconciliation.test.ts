import { describe, expect, it } from 'vitest'
import { reconcileScenePlanForContracts, type ScenePlanReconciliationStep } from './scene-plan-reconciliation'

function buildStep(overrides: Partial<ScenePlanReconciliationStep> = {}): ScenePlanReconciliationStep {
  return {
    scene_order: 1,
    scene_title: '炉前赌气',
    purpose: '建立冲突',
    location: '锅炉场',
    time_anchor: '午后',
    present_characters: ['沈砚青'],
    key_items: ['铜腰牌'],
    conflict: '沈砚青与标准工序冲突',
    beat: '风门卡死',
    must_cover: ['收缴腰牌'],
    climax_variant: 'reversal',
    exit_hook: '韩铁根把铜腰牌揣进自己口袋，随后运渣车把腰牌掩埋，再也找不回来。',
    hidden_agendas: [],
    irony_gap: '',
    audience: '',
    ...overrides,
  }
}

describe('scene plan reconciliation', () => {
  it('removes mutually exclusive credential outcomes before Writer input', () => {
    const result = reconcileScenePlanForContracts([buildStep()])

    expect(result.corrections).toHaveLength(1)
    expect(result.plan[0].exit_hook).toContain('收缴')
    expect(result.plan[0].exit_hook).not.toContain('运渣车')
    expect(result.plan[0].exit_hook).not.toContain('再也找不回来')
  })

  it('fills a missing scene from the existing contract result state', () => {
    const result = reconcileScenePlanForContracts(
      [buildStep({ exit_hook: '转入下一场。' })],
      [
        {
          sceneOrder: 1,
          sceneTitle: '炉前赌气',
          sceneGoal: '建立冲突',
          location: '锅炉场',
          obstacle: '标准工序',
          conflictType: '开局压力',
          resultState: '风门卡死',
        },
        {
          sceneOrder: 2,
          sceneTitle: '纸上的惩罚',
          sceneGoal: '进入工册股',
          location: '工册股',
          obstacle: '文字与制度',
          conflictType: '推进压力',
          resultState: '事故登记表被退回，夜校通知单落到手里',
        },
      ],
    )

    expect(result.plan).toHaveLength(2)
    expect(result.plan[1].scene_title).toBe('纸上的惩罚')
    expect(result.plan[1].exit_hook).toContain('夜校通知单')
    expect(result.corrections).toContain('补齐场景2：Planner 输出少于现有场景合同，已注入合同结果状态作为 Writer 接力。')
  })

  it('carries every existing contract result into the matching scene coverage', () => {
    const result = reconcileScenePlanForContracts(
      [buildStep({ scene_order: 2, key_items: [], exit_hook: '转入工册股。' })],
      [{
        sceneOrder: 2,
        sceneTitle: '工棚收尾',
        sceneGoal: '完成岗位调整',
        location: '工棚',
        obstacle: '失去独立工具格',
        conflictType: '结果压力',
        resultState: '旧档柜留下三个待查问题，明早先到辅助工位报到',
      }],
    )

    expect(result.plan[0].must_cover).toContain('合同结果：旧档柜留下三个待查问题，明早先到辅助工位报到')
    expect(result.corrections).toContain('场景2：将现有合同结果状态加入 must_cover，要求 Writer 在本场落地。')
  })

  it('planner 留空时从合同 seed 延续设计字段；已有输出不覆盖', () => {
    const seed = {
      sceneOrder: 1,
      sceneTitle: '炉前赌气',
      sceneGoal: '建立冲突',
      location: '锅炉场',
      obstacle: '标准工序',
      conflictType: '开局压力',
      resultState: '风门卡死',
      hiddenAgendas: ['韩铁根在护着侄子'],
      ironyGap: '读者知道缺页是韩铁根撕的',
    }

    const emptyResult = reconcileScenePlanForContracts(
      [buildStep({ exit_hook: '转入下一场。', hidden_agendas: [], irony_gap: '' })],
      [seed],
    )
    expect(emptyResult.plan[0].hidden_agendas).toEqual(['韩铁根在护着侄子'])
    expect(emptyResult.plan[0].irony_gap).toBe('读者知道缺页是韩铁根撕的')
    expect(emptyResult.corrections).toContain('场景1：Planner 未输出 hidden_agendas，已从场景合同延续既有设计。')
    expect(emptyResult.corrections).toContain('场景1：Planner 未输出 irony_gap，已从场景合同延续既有设计。')

    const filledResult = reconcileScenePlanForContracts(
      [buildStep({
        exit_hook: '转入下一场。',
        hidden_agendas: ['沈砚青想借事故换岗位'],
        irony_gap: '读者知道风门早已锈死',
      })],
      [seed],
    )
    expect(filledResult.plan[0].hidden_agendas).toEqual(['沈砚青想借事故换岗位'])
    expect(filledResult.plan[0].irony_gap).toBe('读者知道风门早已锈死')
  })

  it('补齐缺失场景时同步带出 seed 里的设计字段', () => {
    const result = reconcileScenePlanForContracts(
      [buildStep({ exit_hook: '转入下一场。' })],
      [
        {
          sceneOrder: 1,
          sceneTitle: '炉前赌气',
          sceneGoal: '建立冲突',
          location: '锅炉场',
          obstacle: '标准工序',
          conflictType: '开局压力',
          resultState: '风门卡死',
        },
        {
          sceneOrder: 2,
          sceneTitle: '纸上的惩罚',
          sceneGoal: '进入工册股',
          location: '工册股',
          obstacle: '文字与制度',
          conflictType: '推进压力',
          resultState: '事故登记表被退回',
          hiddenAgendas: ['股长只想不担责'],
          ironyGap: '无',
        },
      ],
    )
    expect(result.plan).toHaveLength(2)
    expect(result.plan[1].hidden_agendas).toEqual(['股长只想不担责'])
    expect(result.plan[1].irony_gap).toBe('无')
  })
})
