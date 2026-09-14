export type NarrativeTechniqueId = 'relationship_dialogue' | 'situated_observation' | 'concrete_thought' | 'environment_action' | 'information_reveal' | 'consequence_payoff'
export interface NarrativeTechniqueScene {
  scene_order?: number
  purpose?: string
  conflict?: string
  beat?: string
  location?: string
  present_characters?: string[]
  hidden_agendas?: string[]
  irony_gap?: string
  must_cover?: string[]
  theme_consequence?: string
}
export interface NarrativeTechnique {
  id: NarrativeTechniqueId
  applicable: string
  requires: string
  guidance: string
  counterexample: string
  sources: Array<{ work: string; location: string; url: string; evidence: 'text' | 'interview' }>
}

/** Static research-derived options; book titles never participate in selection or enter the model prompt. */
export const NARRATIVE_TECHNIQUES: readonly NarrativeTechnique[] = [
  { id: 'relationship_dialogue', applicable: '双方想得到不同回应，或对关系投入不同', requires: '在场人物、当前诉求或隐含分歧',
    guidance: '让回应受各自的打算和亲疏关系影响：对方可以只回答一部分、纠正细节或岔开话题。读者仍需明白眼下在商量什么。',
    counterexample: '工作确认可以直说，不把每句对白都改成谜语，也不按配额添口头禅。',
    sources: [{ work: '傲慢与偏见', location: '第一章夫妇谈新邻居', url: 'https://www.gutenberg.org/cache/epub/1342/pg1342-images.html', evidence: 'text' }] },
  { id: 'situated_observation', applicable: '观察、进入陌生场所或辨认线索', requires: '观察对象、位置与人物此时关注的事',
    guidance: '按这个人此刻会先注意什么安排观察；熟悉的东西可以略过，拿不准的地方允许暂时误认。描写的先后要有感知上的连接。',
    counterexample: '不把场所写成与谁来看都一样的介绍，也不为每件陈设附会象征。',
    sources: [{ work: '红楼梦', location: '林黛玉初入贾府；研究 C03', url: 'https://zh.wikisource.org/wiki/紅樓夢/第003回', evidence: 'text' }] },
  { id: 'concrete_thought', applicable: '犹疑、盘算、自我解释或不愿承认的顾虑', requires: '人物已知信息和眼前难题',
    guidance: '可以直接写心里的盘算、偏袒和反复；让想法围绕眼前难题，被一句话或现场变化打断。不替人物立刻完成正确的自我总结。',
    counterexample: '心理不必一律换成握拳和深呼吸；纷乱也不是随机跳句。',
    sources: [{ work: '罪与罚', location: '第一部第一章；思想受住处和欠债干扰', url: 'https://www.gutenberg.org/cache/epub/2554/pg2554-images.html', evidence: 'text' }] },
  { id: 'environment_action', applicable: '行动受到空间、天气、路线或身体条件影响', requires: '已知场所与行动限制',
    guidance: '让空间和环境通过实际行动被感到：看不清、绕路、借力、停下或改变动作。保留本书已有的地理和能力边界。',
    counterexample: '天气不能临时送来解围条件；闲适场景也不必硬造障碍。',
    sources: [{ work: '水浒传', location: '林教头风雪山神庙；研究 C05', url: 'https://zh.wikisource.org/wiki/水滸傳/第010回', evidence: 'text' }] },
  { id: 'information_reveal', applicable: '询问、调查、识别异常或已有信息差', requires: '已知线索与谁知道什么',
    guidance: '把读者此刻理解行动所需的信息给清楚；尚未证实的解释保留为人物判断。新发现应能改变前面一处细节的理解，而非只宣布又有谜团。',
    counterexample: '不藏起人物已知且理解当前行动必需的信息；不临时发明决定答案的证据。',
    sources: [{ work: '斑点带子案', location: '房间细节与调查', url: 'https://www.gutenberg.org/cache/epub/1661/pg1661-images.html', evidence: 'text' }] },
  { id: 'consequence_payoff', applicable: '回应已经建立的约定、损失、发现或成长', requires: '前事依据及本场确实承担的回应',
    guidance: '让前事留下来的能力、关系或损失影响这次选择。兑现可以是明白一件事、兑现约定或用上已获得的经验；允许结果后安静停留。',
    counterexample: '换阶段不清空技能和关系；不把每章都写成升级结算或必须另付代价。',
    sources: [{ work: '全职高手', location: '第一章；经验与位置、资产分离', url: 'https://www.webnovel.com/book/7176992105000305/19453999690351712', evidence: 'text' },
      { work: '庆余年', location: '作者谈关键情节积累与修订', url: 'https://www.chinawriter.com.cn/n1/2019/1219/c405057-31513903.html', evidence: 'interview' }] },
]

export function selectNarrativeTechniques(scene: NarrativeTechniqueScene): NarrativeTechnique[] {
  const aim = [scene.purpose, scene.conflict, scene.beat].filter(Boolean).join(' ')
  const signals: Record<NarrativeTechniqueId, boolean> = {
    relationship_dialogue: (scene.hidden_agendas?.length || 0) > 0 || ((scene.present_characters?.length || 0) > 1 && /商量|劝|争|谈|问|约|借|道歉|告别|交涉/.test(aim)),
    situated_observation: Boolean(scene.location && /观察|辨认|查看|进入|察看|检查/.test(aim)),
    concrete_thought: /犹豫|盘算|顾虑|担心|自责|回忆|打算/.test(aim),
    environment_action: Boolean(scene.location && /躲|逃|追|攀|渡|绕|跋涉|风雪|路线/.test(aim)),
    information_reveal: Boolean(scene.irony_gap?.trim()) || /调查|线索|询问|查明|发现|辨认/.test(aim),
    consequence_payoff: Boolean(scene.theme_consequence?.trim()) || /兑现|归还|偿还|履约|回应|善后|余波/.test([aim, ...(scene.must_cover || [])].join(' ')),
  }
  return NARRATIVE_TECHNIQUES.filter((method) => signals[method.id]).slice(0, 2)
}

export function compileNarrativeTechniques(scenes: NarrativeTechniqueScene[]): { text: string; selections: Array<{ sceneOrder: number; methodIds: NarrativeTechniqueId[] }> } {
  const selections = scenes.map((scene, index) => ({ sceneOrder: scene.scene_order || index + 1, methods: selectNarrativeTechniques(scene) }))
  return { text: selections.filter((item) => item.methods.length).map((item) => `第 ${item.sceneOrder} 场可用写法：\n${item.methods.map((method) => `${method.guidance}${method.counterexample}`).join('\n')}`).join('\n\n'),
    selections: selections.map((item) => ({ sceneOrder: item.sceneOrder, methodIds: item.methods.map((method) => method.id) })) }
}
