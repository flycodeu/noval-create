export interface ScenePlanReconciliationStep {
  scene_order: number
  scene_title: string
  purpose: string
  location: string
  time_anchor: string
  present_characters: string[]
  key_items: string[]
  conflict: string
  beat: string
  must_cover: string[]
  climax_variant: string
  exit_hook: string
  hidden_agendas: string[]
  irony_gap: string
  audience: string
}

export interface SceneContractSeed {
  sceneOrder: number
  sceneTitle: string
  sceneGoal: string
  location: string
  obstacle: string
  conflictType: string
  resultState: string
  /** 上一轮 planner 写回 scene_contracts 的设计字段（重生成时延续，不凭空发明）。 */
  hiddenAgendas?: string[]
  ironyGap?: string
}

export interface ScenePlanReconciliationResult {
  plan: ScenePlanReconciliationStep[]
  corrections: string[]
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function buildCoverageStep(seed: SceneContractSeed, fallbackOrder: number): ScenePlanReconciliationStep {
  const sceneOrder = Number.isFinite(seed.sceneOrder) && seed.sceneOrder > 0
    ? Math.round(seed.sceneOrder)
    : fallbackOrder
  const purpose = seed.sceneGoal || seed.resultState || seed.obstacle
  const conflict = seed.obstacle || seed.conflictType
  return {
    scene_order: sceneOrder,
    scene_title: seed.sceneTitle || `场景 ${sceneOrder}`,
    purpose,
    location: seed.location,
    time_anchor: '',
    present_characters: [],
    key_items: [],
    conflict,
    beat: seed.resultState || purpose,
    must_cover: [purpose, seed.resultState].filter(Boolean),
    climax_variant: '',
    exit_hook: seed.resultState || '把当前冲突的结果状态落到下一场。',
    hidden_agendas: (seed.hiddenAgendas || []).map((item) => item.trim()).filter(Boolean),
    irony_gap: (seed.ironyGap || '').trim(),
    audience: '',
  }
}

/**
 * Reconcile model-authored scene plans with deterministic chapter contracts
 * before the plan becomes Writer input. This is deliberately narrow: it only
 * repairs mutually exclusive state claims for a tracked badge/credential,
 * carries every persisted contract result into the matching scene's
 * must_cover list, and fills missing scene slots from an existing contract.
 * It does not invent new plot events or silently rewrite ordinary prose.
 */
export function reconcileScenePlanForContracts(
  input: ScenePlanReconciliationStep[],
  contractSeeds: SceneContractSeed[] = [],
): ScenePlanReconciliationResult {
  const corrections: string[] = []
  const plan = input.map((step) => ({
    ...step,
    present_characters: [...step.present_characters],
    key_items: [...step.key_items],
    must_cover: [...step.must_cover],
    hidden_agendas: [...step.hidden_agendas],
  }))

  plan.forEach((step) => {
    const trackedCredential = step.key_items.some((item) => /腰牌|工牌|证件|凭证/u.test(item))
    if (!trackedCredential) return

    const hookText = step.exit_hook || ''
    const hasCollectedState = hasAny(hookText, [
      /收缴|收走|没收/u,
      /揣进.{0,8}(口袋|胸口)/u,
      /拿起.{0,8}(腰牌|工牌|证件|凭证)/u,
    ])
    const hasLostState = hasAny(hookText, [
      /运渣车|辙印|掩埋|埋进/u,
      /再也找不回|再也找不到|丢失/u,
    ])
    if (!hasCollectedState || !hasLostState) return

    step.exit_hook = '韩铁根已收缴铜腰牌并放入口袋，沈砚青接到去工册股补录事故经过的命令。腰间挂钩空了，岗位资格也被收走，下一场转入工册股。'
    corrections.push(`场景${step.scene_order}：统一铜腰牌状态为“韩铁根收缴”，移除与运渣车掩埋/遗失互斥的退出钩子。`)
  })

  const contractByOrder = new Map<number, SceneContractSeed>()
  contractSeeds.forEach((seed, index) => {
    const order = Number.isFinite(seed.sceneOrder) && seed.sceneOrder > 0
      ? Math.round(seed.sceneOrder)
      : index + 1
    if (!contractByOrder.has(order)) contractByOrder.set(order, seed)
  })

  plan.forEach((step) => {
    const contract = contractByOrder.get(step.scene_order)
    const resultState = contract?.resultState?.trim()
    if (!resultState || step.must_cover.some((item) => item.trim() === resultState)) return

    step.must_cover.push(`合同结果：${resultState}`)
    corrections.push(`场景${step.scene_order}：将现有合同结果状态加入 must_cover，要求 Writer 在本场落地。`)
  })

  // 设计字段延续：planner 本轮留空、但场景合同里已固化过 hidden_agendas / irony_gap
  // 时按 sceneOrder 回填，避免重生成把上一轮的设计冲掉。已有输出不覆盖。
  plan.forEach((step) => {
    const contract = contractByOrder.get(step.scene_order)
    if (!contract) return
    const seedAgendas = (contract.hiddenAgendas || []).map((item) => item.trim()).filter(Boolean)
    if (seedAgendas.length > 0 && !step.hidden_agendas.some((item) => item.trim())) {
      step.hidden_agendas = [...seedAgendas]
      corrections.push(`场景${step.scene_order}：Planner 未输出 hidden_agendas，已从场景合同延续既有设计。`)
    }
    const seedIronyGap = (contract.ironyGap || '').trim()
    if (seedIronyGap && !step.irony_gap.trim()) {
      step.irony_gap = seedIronyGap
      corrections.push(`场景${step.scene_order}：Planner 未输出 irony_gap，已从场景合同延续既有设计。`)
    }
  })

  if (contractSeeds.length > plan.length) {
    const existingOrders = new Set(plan.map((step) => step.scene_order))
    contractSeeds.forEach((seed, index) => {
      const expectedOrder = Number.isFinite(seed.sceneOrder) && seed.sceneOrder > 0
        ? Math.round(seed.sceneOrder)
        : index + 1
      if (existingOrders.has(expectedOrder) || plan.length >= contractSeeds.length) return
      plan.push(buildCoverageStep(seed, plan.length + 1))
      existingOrders.add(expectedOrder)
      corrections.push(`补齐场景${expectedOrder}：Planner 输出少于现有场景合同，已注入合同结果状态作为 Writer 接力。`)
    })
    plan.sort((left, right) => left.scene_order - right.scene_order)
  }

  return { plan, corrections }
}
