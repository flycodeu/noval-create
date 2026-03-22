import React, { useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Spin, Tag, message } from 'antd'
import { CopyOutlined, EditOutlined } from '@ant-design/icons'
import {
  PROMPT_CATALOG as BASE_PROMPT_CATALOG,
  PROMPT_CATEGORIES,
  buildChapterDraftPrompt,
  buildChapterReviewPrompt,
  buildChapterRewritePrompt,
  buildScenePlanPrompt,
  buildTimelineEventsPrompt,
  regenerateCharacterPrompt,
  type PromptCatalogEntry,
} from '../../shared/prompt-library'

function normalizePromptText(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
}

function looksLikePromptSource(text: string): boolean {
  return /renderPrompt\s*\(|sectionLines?\s*\(|PROMPT_CATALOG|=>\s*renderPrompt/.test(text)
}

function sanitizePromptText(text: string, fallback?: string): string {
  const normalized = normalizePromptText(text || '')
  if (!normalized) return normalizePromptText(fallback || '')

  if (fallback && looksLikePromptSource(normalized)) {
    const fallbackText = normalizePromptText(fallback)
    if (!looksLikePromptSource(fallbackText)) return fallbackText
  }

  return normalized
}

function placeholder(key: string): string {
  return `{${key}}`
}

const EXTRA_RUNTIME_PROMPTS: PromptCatalogEntry[] = [
  {
    key: 'regenerateCharacter',
    name: '人物重生',
    description: '在保留角色名和角色定位的前提下，重做人物档案，修复人设空洞和 AI 味。',
    category: '人物系统',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'novelSynopsis', label: '小说背景' },
      { key: 'genre', label: '题材' },
      { key: 'worldSummary', label: '世界规则摘要' },
      { key: 'storyCore', label: '故事核心' },
      { key: 'lockedName', label: '锁定姓名' },
      { key: 'lockedRoleType', label: '锁定角色类型' },
      { key: 'currentProfile', label: '当前档案' },
      { key: 'relatedCharacters', label: '关联人物' },
      { key: 'relationSummary', label: '关系摘要' },
    ],
    template: regenerateCharacterPrompt({
      novelTitle: placeholder('novelTitle'),
      novelSynopsis: placeholder('novelSynopsis'),
      genre: placeholder('genre'),
      worldSummary: placeholder('worldSummary'),
      storyCore: placeholder('storyCore'),
      protagonistRule: placeholder('protagonistRule'),
      lockedName: placeholder('lockedName'),
      lockedRoleType: placeholder('lockedRoleType'),
      currentProfile: placeholder('currentProfile'),
      relatedCharacters: placeholder('relatedCharacters'),
      relationSummary: placeholder('relationSummary'),
      speciesSummary: placeholder('speciesSummary'),
      factionSummary: placeholder('factionSummary'),
      ecologySummary: placeholder('ecologySummary'),
      writingConstraints: placeholder('writingConstraints'),
    }),
  },
  {
    key: 'timelineEvents',
    name: '时间轴事件生成',
    description: '批量生成时间轴事件，明确先后顺序、参与人物、物品和未回收线程。',
    category: '大纲规划',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'genre', label: '题材' },
      { key: 'background', label: '背景补充' },
      { key: 'storyGoal', label: '故事目标' },
      { key: 'coreConflict', label: '核心冲突' },
      { key: 'mainPlot', label: '主线剧情' },
      { key: 'subPlots', label: '支线剧情' },
      { key: 'ending', label: '结局方向' },
      { key: 'worldRulesSummary', label: '世界规则摘要' },
      { key: 'timelineRules', label: '时间制度' },
      { key: 'arcSummary', label: '故事弧' },
      { key: 'characterSummary', label: '人物摘要' },
      { key: 'locationSummary', label: '地点摘要' },
      { key: 'itemSummary', label: '物品摘要' },
      { key: 'existingEvents', label: '已有事件' },
      { key: 'count', label: '数量' },
    ],
    template: buildTimelineEventsPrompt({
      novelTitle: placeholder('novelTitle'),
      genre: placeholder('genre'),
      background: placeholder('background'),
      storyGoal: placeholder('storyGoal'),
      coreConflict: placeholder('coreConflict'),
      mainPlot: placeholder('mainPlot'),
      subPlots: placeholder('subPlots'),
      ending: placeholder('ending'),
      worldRulesSummary: placeholder('worldRulesSummary'),
      timelineRules: placeholder('timelineRules'),
      arcSummary: placeholder('arcSummary'),
      characterSummary: placeholder('characterSummary'),
      locationSummary: placeholder('locationSummary'),
      itemSummary: placeholder('itemSummary'),
      existingEvents: placeholder('existingEvents'),
      count: Number.NaN,
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('count')),
  },
  {
    key: 'scenePlan',
    name: '章节拆场景',
    description: '先拆出场景链和必须覆盖项，再进入正文初稿生成。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'plotPoints', label: '章节大纲' },
      { key: 'emotionTone', label: '情绪基调' },
      { key: 'targetWords', label: '目标字数' },
    ],
    template: buildScenePlanPrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      plotPoints: placeholder('plotPoints'),
      emotionTone: placeholder('emotionTone'),
      targetWords: Number.NaN,
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      itemSummary: placeholder('itemSummary'),
      previousSummaries: placeholder('previousSummaries'),
      lastChapterEnding: placeholder('lastChapterEnding'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      continuityNotes: placeholder('continuityNotes'),
      timelineSummary: placeholder('timelineSummary'),
      timelineOpenThreads: placeholder('timelineOpenThreads'),
      longTermMemory: placeholder('longTermMemory'),
      consistencyNotes: placeholder('consistencyNotes'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')).replace('NaN', placeholder('targetWords')),
  },
  {
    key: 'chapterDraft',
    name: '章节初稿',
    description: '按场景计划生成第一版初稿，重点先把信息、动作、承接写清。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'scenePlan', label: '场景计划' },
      { key: 'targetWords', label: '目标字数' },
    ],
    template: buildChapterDraftPrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      emotionTone: placeholder('emotionTone'),
      targetWords: Number.NaN,
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      itemSummary: placeholder('itemSummary'),
      previousSummaries: placeholder('previousSummaries'),
      lastChapterEnding: placeholder('lastChapterEnding'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      continuityNotes: placeholder('continuityNotes'),
      timelineSummary: placeholder('timelineSummary'),
      timelineOpenThreads: placeholder('timelineOpenThreads'),
      longTermMemory: placeholder('longTermMemory'),
      consistencyNotes: placeholder('consistencyNotes'),
      scenePlan: placeholder('scenePlan'),
      draftContent: '',
      reviewNotes: '',
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')).replace('NaN', placeholder('targetWords')),
  },
  {
    key: 'chapterReview',
    name: '章节审校',
    description: '自动审校上下文、因果、语言和 AI 味，输出真正可执行的修订建议。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'scenePlan', label: '场景计划' },
      { key: 'draftContent', label: '章节初稿' },
    ],
    template: buildChapterReviewPrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      itemSummary: placeholder('itemSummary'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      timelineSummary: placeholder('timelineSummary'),
      longTermMemory: placeholder('longTermMemory'),
      consistencyNotes: placeholder('consistencyNotes'),
      scenePlan: placeholder('scenePlan'),
      draftContent: placeholder('draftContent'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')),
  },
  {
    key: 'chapterRewrite',
    name: '章节定稿',
    description: '根据审校意见重写成可入库版本，重点修正上下文断裂、常识错配和 AI 味。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'scenePlan', label: '场景计划' },
      { key: 'draftContent', label: '章节初稿' },
      { key: 'reviewNotes', label: '审校意见' },
    ],
    template: buildChapterRewritePrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      emotionTone: placeholder('emotionTone'),
      targetWords: Number.NaN,
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      itemSummary: placeholder('itemSummary'),
      previousSummaries: placeholder('previousSummaries'),
      lastChapterEnding: placeholder('lastChapterEnding'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      continuityNotes: placeholder('continuityNotes'),
      timelineSummary: placeholder('timelineSummary'),
      timelineOpenThreads: placeholder('timelineOpenThreads'),
      longTermMemory: placeholder('longTermMemory'),
      consistencyNotes: placeholder('consistencyNotes'),
      scenePlan: placeholder('scenePlan'),
      draftContent: placeholder('draftContent'),
      reviewNotes: placeholder('reviewNotes'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')).replace('NaN', placeholder('targetWords')),
  },
]

const PROMPT_CATALOG = [...BASE_PROMPT_CATALOG, ...EXTRA_RUNTIME_PROMPTS]

export default function PromptManager() {
  const [activeCategory, setActiveCategory] = useState('全部')
  const [searchText, setSearchText] = useState('')
  const [selectedPrompt, setSelectedPrompt] = useState<PromptCatalogEntry | null>(null)
  const [editingTemplate, setEditingTemplate] = useState('')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [customOverrides, setCustomOverrides] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await window.electron.prompt.list()
        if (!alive) return
        setCustomOverrides(Object.fromEntries(rows.map((row) => [row.key, normalizePromptText(row.content)])))
      } catch (error) {
        if (alive) {
          message.error(error instanceof Error ? error.message : '加载提示词失败')
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const filteredPrompts = useMemo(() => {
    return PROMPT_CATALOG.filter((prompt) => {
      if (activeCategory !== '全部' && prompt.category !== activeCategory) return false
      if (!searchText) return true
      return prompt.name.includes(searchText) || prompt.description.includes(searchText) || prompt.key.includes(searchText)
    })
  }, [activeCategory, searchText])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(sanitizePromptText(text)).then(() => message.success('已复制到剪贴板'))
  }

  const handleEditSave = async () => {
    if (!selectedPrompt) return
    const normalized = normalizePromptText(editingTemplate)
    await window.electron.prompt.save(selectedPrompt.key, normalized)
    setCustomOverrides((prev) => ({ ...prev, [selectedPrompt.key]: normalized }))
    setEditModalOpen(false)
    message.success('运行时提示词已保存')
  }

  const handleResetOverride = async (key: string) => {
    await window.electron.prompt.delete(key)
    setCustomOverrides((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    message.success('已恢复默认提示词')
  }

  if (loading) {
    return (
      <div style={{ padding: 24, height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spin />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: 'var(--color-text-primary)', margin: 0, marginBottom: 4 }}>提示词管理中心</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
            这里保存的修改会直接作用到运行时生成链路，不再只是本地参考。
          </div>
        </div>
        <Input.Search
          placeholder="搜索提示词..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {PROMPT_CATEGORIES.map((category) => (
          <Tag
            key={category}
            onClick={() => setActiveCategory(category)}
            style={{
              cursor: 'pointer',
              padding: '4px 12px',
              fontSize: 13,
              background: activeCategory === category ? 'var(--color-blue-primary)' : 'transparent',
              border: `1px solid ${activeCategory === category ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
              color: activeCategory === category ? 'white' : 'var(--color-text-secondary)',
              borderRadius: 20,
            }}
          >
            {category}
          </Tag>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {filteredPrompts.map((prompt) => {
          const hasOverride = Boolean(customOverrides[prompt.key])
          const currentTemplate = sanitizePromptText(customOverrides[prompt.key] || prompt.template, prompt.template)

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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text-primary)' }}>
                      {prompt.name}
                    </span>
                    {hasOverride ? (
                      <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>
                        运行中
                      </Tag>
                    ) : null}
                  </div>
                  <Tag
                    style={{
                      fontSize: 10,
                      padding: '0 6px',
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {prompt.category}
                  </Tag>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopy(currentTemplate)} />
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setSelectedPrompt(prompt)
                      setEditingTemplate(currentTemplate)
                      setEditModalOpen(true)
                    }}
                  />
                  {hasOverride ? (
                    <Button size="small" onClick={() => void handleResetOverride(prompt.key)} style={{ fontSize: 10 }}>
                      重置
                    </Button>
                  ) : null}
                </div>
              </div>

              <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.7 }}>
                {prompt.description}
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>输入参数：</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {prompt.params.map((param) => (
                    <Tag
                      key={param.key}
                      style={{
                        fontSize: 10,
                        background: 'rgba(46,134,171,0.1)',
                        border: '1px solid rgba(46,134,171,0.25)',
                        color: 'var(--color-blue-light)',
                        padding: '1px 6px',
                      }}
                    >
                      {param.key}（{param.label}）
                    </Tag>
                  ))}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--color-bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  fontFamily: 'monospace',
                  maxHeight: 120,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                }}
              >
                {currentTemplate}
              </div>
            </div>
          )
        })}
      </div>

      <Modal
        title={`编辑运行时提示词：${selectedPrompt?.name || ''}`}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={() => void handleEditSave()}
        okText="保存并生效"
        width={760}
        destroyOnHidden
      >
        <div style={{ marginBottom: 12, color: 'var(--color-text-secondary)', fontSize: 12 }}>
          保存后会直接影响后端运行时 prompt。使用 `{`参数名`}` 可以引用上下文字段。
        </div>
        <div style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedPrompt?.params.map((param) => (
            <Tag
              key={param.key}
              style={{ fontSize: 11, cursor: 'pointer', color: 'var(--color-blue-light)' }}
              onClick={() => setEditingTemplate((prev) => `${prev}{${param.key}}`)}
            >
              + {`{${param.key}}`}
            </Tag>
          ))}
        </div>
        <Input.TextArea
          value={editingTemplate}
          onChange={(e) => setEditingTemplate(e.target.value)}
          rows={18}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>
    </div>
  )
}
