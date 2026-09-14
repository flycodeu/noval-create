const camera = '他把摄像头转向门口，检查摄像机的电源，又从录像里找出昨夜的影像。画面停在九点，他把时间记在纸上。'
const metaphor = '雾像棉絮，像碎云，又像潮水，灯光仿佛刀锋，宛如火焰，把他的心照得无处藏身。'
const scenes = [{ scene_order: 1, scene_title: '出院', purpose: '姐姐请弟弟接母亲出院', conflict: '弟弟担心错过上班', hidden_agendas: ['姐姐没说自己也请不到假'], irony_gap: '读者知道母亲已经约好邻居', location: '病房', time_anchor: '早上', present_characters: ['姐姐', '弟弟'], key_items: [], beat: '商量接送', must_cover: [], climax_variant: '', exit_hook: '', audience: '' }]
function writerFixture(kind) {
  return { novelTitle: '原创诊断样例', genre: '家庭关系', chapterNum: 2, chapterTitle: '出院', emotionTone: '平静', targetWords: 1500, storyCore: '共同照顾母亲', context: { chapterGoal: '约定明天轮流照顾母亲', currentArc: '姐弟共同安排陪护', authorStyleMaterials: { targetWorkSampleGuide: '', humanStyleSampleLock: kind === 'prose' ? '姐姐把袋子放在床边。弟弟没接，低头看了一眼手机。' : '日常中文，不写总结句。' } }, themeChapterTest: '', consistencyNotes: '', structuralAlertsSummary: '', scenePlanText: '姐姐请弟弟接母亲出院；弟弟担心错过上班。', ...(kind === 'typed' ? { scenePlan: scenes } : {}), runtimeAssertions: [], narrativeFields: {}, guidance: {}, protagonistReference: '姐姐', protagonistRule: '', promptTier: 'normal' }
}
module.exports = { camera, metaphor, scenes, writerFixture }
