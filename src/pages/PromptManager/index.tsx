import React, { useState } from 'react'
import { Tabs, Button, Tag, message, Input, Modal } from 'antd'
import { CopyOutlined, EditOutlined, CheckOutlined } from '@ant-design/icons'

interface PromptDef {
  key: string
  name: string
  description: string
  category: string
  template: string
  params: string[]
}

const PROMPTS: PromptDef[] = [
  {
    key: 'expandBackground',
    name: '背景扩充',
    description: '根据用户输入的简短背景，AI 扩充为完整世界观、生成3个标题候选和简介',
    category: '创作初始化',
    params: ['userBackground（用户背景）', 'genre（题材）', 'worldTemplateSummary（世界观模板）'],
    template: `用户提供了以下小说创作背景：
【用户背景】{userBackground}
【选择题材】{genre}
【世界观模板】{worldTemplateSummary}

请完成以下任务：
1. 对用户的背景进行扩充，完善世界基础设定、时代氛围、核心冲突雏形。保留用户原始意图，扩充后300~500字，语言自然，不要写成百科介绍。
2. 提供3个标题候选，风格要有明显差异：标题A以主角为核心，标题B以核心主题为中心，标题C营造意境或悬念。
3. 生成一段简介（150~200字），吸引读者，不剧透结局。

输出格式为JSON，不要包含任何其他文字：
{"expanded_background":"...","titles":["A","B","C"],"synopsis":"..."}`,
  },
  {
    key: 'protagonist',
    name: '主角生成',
    description: '根据小说背景和题材，生成完整主角信息（姓名、性格、经历等）',
    category: '人物系统',
    params: ['novelTitle', 'novelSynopsis', 'genre', 'worldSummary', 'gender'],
    template: `请为小说《{novelTitle}》创建主角信息。

小说背景：{novelSynopsis}
题材：{genre}
世界观：{worldSummary}
指定性别：{gender}

姓名要求：
- 姓氏备选（从中选一）：赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦...
- 名字以2字为主，符合题材时代背景

请生成完整主角信息，用JSON输出：
{"surname":"","given_name":"","full_name":"","gender":"","age":0,"appearance":"...","personality_traits":["..."],"flaws":["..."],"habits":["..."],"background":"...","goals":"...","first_impression":"...","occupation":""}`,
  },
  {
    key: 'batchCharacter',
    name: '批量生成人物',
    description: '根据主角信息，批量生成配角（含姓名、性格、与主角关系等）',
    category: '人物系统',
    params: ['novelTitle', 'count', 'genderRatio', 'specialRequirements'],
    template: `为小说《{novelTitle}》批量生成{count}个配角。

小说背景：{novelSynopsis}
主角：{protagonistSummary}
已有人物（姓名不能重复）：{existingNames}
题材：{genre}，世界观：{worldSummary}
性别分配：{genderRatio}
特殊要求：{specialRequirements}

每个配角包含：姓名、性别、年龄、角色类型、功能定位、性格关键词、与主角的关系、登场阶段、简要外貌。

以JSON数组输出，不要输出多余文字。`,
  },
  {
    key: 'characterRelations',
    name: '关系网络生成',
    description: '为人物列表自动设计合理的关系网络',
    category: '人物系统',
    params: ['novelSynopsis', 'characterList（人物列表）'],
    template: `基于以下人物为小说生成关系网络。

小说背景：{novelSynopsis}
人物列表：
{characterList}

为这些人物设计合理的关系网络：
- 关系类型：friend/enemy/lover/parent_child/colleague/rival/mentor_student/acquaintance
- 关系要符合人物背景和世界观
- 不是所有人物都需要相互认识

输出JSON数组：
[{"char_a":"人物A名","char_b":"人物B名","type":"关系类型","label":"关系标签","description":"关系详情","bilateral":true}]`,
  },
  {
    key: 'storyArcs',
    name: '故事弧规划',
    description: '根据核心设定，规划3-5个故事弧结构（章节范围、目标、转折点）',
    category: '大纲规划',
    params: ['novelTitle', 'genre', 'storyGoal', 'coreConflict', 'mainPlot', 'totalChapters'],
    template: `为小说《{novelTitle}》规划故事弧结构。

题材：{genre}
核心设定：
- 故事目标：{storyGoal}
- 核心冲突：{coreConflict}
- 主线概述：{mainPlot}
总章节数：{totalChapters}章

请规划3~5个故事弧：
1. 每个弧有明确的叙事阶段功能
2. 支线在弧推进中有合理穿插
3. 最后一个弧负责收束

每个弧包含：弧名称、叙事阶段定位、章节范围、核心目标、关键转折点。

以JSON数组输出，不要输出多余文字。`,
  },
  {
    key: 'chapterOutline',
    name: '章节细纲生成',
    description: '为指定故事弧的章节生成详细大纲',
    category: '大纲规划',
    params: ['novelTitle', 'arcName', 'arcGoal', 'chapterStart', 'chapterEnd'],
    template: `为小说《{novelTitle}》的{arcName}生成章节细纲（第{chapterStart}章到第{chapterEnd}章）。

本弧目标：{arcGoal}
前情摘要：{previousSummary}
当前主要人物状态：{characterStates}
世界规则摘要：{worldRulesSummary}

为每章生成：
- 章节序号和标题
- 叙事目标
- 主要情节点（3~5个，按顺序）
- 登场人物、主要场景、情绪基调
- 衔接说明

以JSON数组输出，每个元素对应一章。`,
  },
  {
    key: 'chapterWriting',
    name: '正文生成',
    description: '根据章节大纲和上下文，生成完整章节正文',
    category: '正文编写',
    params: ['novelTitle', 'chapterNum', 'chapterGoal', 'plotPoints', 'emotionTone', 'targetWords'],
    template: `【全局写作规范】
语言自然，不堆砌华丽辞藻。禁止「不禁」「不由得」「忍不住」等万能引导词。
直接输出正文内容，不要开头说「好的，以下是」之类的话。

---

你正在为小说《{novelTitle}》创作第{chapterNum}章。

【世界规则与禁止事项】
{worldRules}

【当前涉及人物状态】
{characterStates}

【前情摘要】
{previousSummaries}

【上章结尾】
{lastChapterEnding}

【本章大纲】
标题：{chapterTitle}
目标：{chapterGoal}
情节点：{plotPoints}
情绪基调：{emotionTone}

【文风要求】
{styleTemplate}

目标字数：{targetWords}字左右。直接输出正文。`,
  },
  {
    key: 'chapterSummary',
    name: '章节摘要生成',
    description: '为已完成的章节生成摘要，用于后续章节的上下文',
    category: '正文编写',
    params: ['chapterContent（章节内容）'],
    template: `为以下章节内容生成摘要，用于后续章节的上下文参考。

【章节内容】
{chapterContent}

摘要要求：
1. 长度150~200字
2. 包含：发生了什么事件、涉及哪些人物、产生了什么结果
3. 记录重要的人物状态变化
4. 用客观陈述语气

同时生成下一章引导提示（50字以内）。

输出JSON：{"summary":"...","next_chapter_seed":"..."}`,
  },
  {
    key: 'aiCheck',
    name: 'AI 痕迹检测',
    description: '检测文本中的 AI 写作特征并给出修改建议，输出 0-100 评分',
    category: '正文编写',
    params: ['text（待检测文本）'],
    template: `分析以下小说段落，检测AI写作特征并给出修改建议。

【待检测文本】
{text}

检测维度：
1. 过度修饰：环境描写是否过于繁琐
2. 万能引导词：「不禁」「不由得」「忍不住」等
3. 情绪套路：「眼眶湿润」「攥紧拳头」「深吸一口气」等
4. 辞藻堆砌：形容词叠加，比喻过度
5. 对话模板：是否每句对话都接「某某说」
6. 冗余内容：对剧情没有推进的段落

输出JSON：
{"score":0到100,"issues":[{"type":"问题类型","location":"原文引用","suggestion":"修改建议"}],"overall_feedback":"一句话总体评价"}`,
  },
  {
    key: 'rewriteParagraph',
    name: '段落重写',
    description: '对选中段落进行重写，减少 AI 痕迹，保留核心内容',
    category: '正文编写',
    params: ['originalParagraph', 'contextBefore', 'specificRequirements'],
    template: `【全局写作规范】
语言自然，不堆砌华丽辞藻。禁止「不禁」「不由得」等引导词。

改写以下段落：

【原始段落】
{originalParagraph}

【上下文参考】
{contextBefore}

【改写要求】
{specificRequirements}

改写原则：
- 保留段落的核心事件和信息
- 语言更接近真实人类写作
- 情绪表达更含蓄，用行为代替心理叙述
- 句式有变化，长短句结合

直接输出改写后的段落，不要任何解释。`,
  },
  {
    key: 'mapGeneration',
    name: '地图生成',
    description: '根据世界观，批量生成三层嵌套的地图结构',
    category: '世界构建',
    params: ['novelTitle', 'worldSummary', 'genre', 'mapStructure', 'namedPlaces'],
    template: `为小说《{novelTitle}》生成地图信息。

世界观：{worldSummary}
题材：{genre}
地图结构：{mapStructure}
用户已命名的地点：{namedPlaces}

要求：
- 命名风格符合题材
- 每个地点有独特氛围
- 地点之间有合理的地理逻辑

输出三层嵌套JSON：
{"regions":[{"name":"","description":"","atmosphere":"","sub_regions":[{"name":"","description":"","atmosphere":"","locations":[{"name":"","type":"","description":"","atmosphere":"","plot_relevance":""}]}]}]}`,
  },
]

const CATEGORIES = ['全部', '创作初始化', '人物系统', '大纲规划', '正文编写', '世界构建']

export default function PromptManager() {
  const [activeCategory, setActiveCategory] = useState('全部')
  const [searchText, setSearchText] = useState('')
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDef | null>(null)
  const [editingTemplate, setEditingTemplate] = useState('')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [customOverrides, setCustomOverrides] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('novelforge-prompt-overrides') || '{}') } catch { return {} }
  })

  const filteredPrompts = PROMPTS.filter(p => {
    if (activeCategory !== '全部' && p.category !== activeCategory) return false
    if (searchText && !p.name.includes(searchText) && !p.description.includes(searchText)) return false
    return true
  })

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => message.success('已复制到剪贴板'))
  }

  const handleEditSave = () => {
    if (!selectedPrompt) return
    const newOverrides = { ...customOverrides, [selectedPrompt.key]: editingTemplate }
    setCustomOverrides(newOverrides)
    localStorage.setItem('novelforge-prompt-overrides', JSON.stringify(newOverrides))
    setEditModalOpen(false)
    message.success('自定义提示词已保存')
  }

  const handleResetOverride = (key: string) => {
    const newOverrides = { ...customOverrides }
    delete newOverrides[key]
    setCustomOverrides(newOverrides)
    localStorage.setItem('novelforge-prompt-overrides', JSON.stringify(newOverrides))
    message.success('已恢复默认提示词')
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: 'var(--color-text-primary)', margin: 0, marginBottom: 4 }}>提示词管理中心</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
            查看、复制和自定义所有 AI 提示词模板 · 共 {PROMPTS.length} 个提示词
          </div>
        </div>
        <Input.Search
          placeholder="搜索提示词..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ width: 240 }}
          allowClear
        />
      </div>

      {/* 分类标签 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => (
          <Tag
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              cursor: 'pointer',
              padding: '4px 12px',
              fontSize: 13,
              background: activeCategory === cat ? 'var(--color-blue-primary)' : 'transparent',
              border: `1px solid ${activeCategory === cat ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
              color: activeCategory === cat ? 'white' : 'var(--color-text-secondary)',
              borderRadius: 20,
            }}
          >
            {cat}
          </Tag>
        ))}
      </div>

      {/* 提示词卡片网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {filteredPrompts.map(prompt => {
          const hasOverride = !!customOverrides[prompt.key]
          const currentTemplate = customOverrides[prompt.key] || prompt.template

          return (
            <div
              key={prompt.key}
              style={{
                background: 'var(--color-bg-card)',
                border: `1px solid ${hasOverride ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
                borderRadius: 10,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {/* 标题行 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text-primary)' }}>
                      {prompt.name}
                    </span>
                    {hasOverride && (
                      <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>已自定义</Tag>
                    )}
                  </div>
                  <Tag style={{
                    fontSize: 10,
                    padding: '0 6px',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--color-text-muted)',
                  }}>
                    {prompt.category}
                  </Tag>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => handleCopy(currentTemplate)}
                    title="复制提示词"
                  />
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setSelectedPrompt(prompt)
                      setEditingTemplate(currentTemplate)
                      setEditModalOpen(true)
                    }}
                    title="自定义提示词"
                  />
                  {hasOverride && (
                    <Button
                      size="small"
                      onClick={() => handleResetOverride(prompt.key)}
                      title="恢复默认"
                      style={{ fontSize: 10 }}
                    >
                      重置
                    </Button>
                  )}
                </div>
              </div>

              {/* 描述 */}
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.7 }}>
                {prompt.description}
              </div>

              {/* 参数列表 */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>输入参数：</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {prompt.params.map(p => (
                    <Tag key={p} style={{
                      fontSize: 10,
                      background: 'rgba(46,134,171,0.1)',
                      border: '1px solid rgba(46,134,171,0.25)',
                      color: 'var(--color-blue-light)',
                      padding: '1px 6px',
                    }}>
                      {p}
                    </Tag>
                  ))}
                </div>
              </div>

              {/* 提示词预览 */}
              <div style={{
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 11,
                color: 'var(--color-text-muted)',
                fontFamily: 'monospace',
                maxHeight: 100,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
              }}>
                {currentTemplate.slice(0, 300)}{currentTemplate.length > 300 ? '...' : ''}
              </div>
            </div>
          )
        })}
      </div>

      {/* 编辑 Modal */}
      <Modal
        title={`自定义提示词：${selectedPrompt?.name}`}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleEditSave}
        okText="保存自定义"
        width={720}
        destroyOnClose
      >
        <div style={{ marginBottom: 12, color: 'var(--color-text-secondary)', fontSize: 12 }}>
          使用 {'{'} 参数名 {'}'} 作为占位符。自定义后，AI 调用将使用您的版本（重置可恢复默认）。
        </div>
        <div style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedPrompt?.params.map(p => (
            <Tag
              key={p}
              style={{ fontSize: 11, cursor: 'pointer', color: 'var(--color-blue-light)' }}
              onClick={() => setEditingTemplate(prev => prev + `{${p.split('（')[0]}}`)}
            >
              + {'{' + p + '}'}
            </Tag>
          ))}
        </div>
        <Input.TextArea
          value={editingTemplate}
          onChange={e => setEditingTemplate(e.target.value)}
          rows={16}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>
    </div>
  )
}
