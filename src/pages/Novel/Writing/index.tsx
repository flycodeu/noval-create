import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Collapse,
  Empty,
  Input,
  message,
  Modal,
  Progress,
  Select,
  Spin,
  Tag,
} from 'antd'
import {
  BulbOutlined,
  CheckOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import type { Chapter } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useTaskStore } from '../../../stores/task.store'

interface Props {
  novelId: number
}

interface AiCheckIssue {
  type: string
  location: string
  suggestion: string
}

interface AiCheckPayload {
  score: number
  issues: AiCheckIssue[]
  overall_feedback: string
}

interface ContinuityPayload {
  plot_progress?: string[]
  character_state_changes?: string[]
  world_state_changes?: string[]
  open_loops?: string[]
  continuity_notes?: string[]
  arc_progress?: string
}

const STATUS_OPTIONS = [
  { value: 'outline', label: '待写' },
  { value: 'writing', label: '写作中' },
  { value: 'draft', label: '草稿' },
  { value: 'reviewing', label: '审核中' },
  { value: 'final', label: '已完成' },
]

const STATUS_COLORS: Record<string, string> = {
  outline: '#5c6378',
  writing: '#2E86AB',
  draft: '#faad14',
  reviewing: '#e67e22',
  final: '#52c41a',
}

function countWords(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  return chinese + english
}

function parseContinuity(raw?: string): ContinuityPayload | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ContinuityPayload
  } catch {
    return null
  }
}

export default function Writing({ novelId }: Props) {
  const {
    chapters,
    currentChapterId,
    currentNovel,
    setChapters,
    setCurrentChapterId,
    updateChapter,
  } = useNovelStore()
  const { streams, clearStream } = useTaskStore()

  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [content, setContent] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [generatingTaskId, setGeneratingTaskId] = useState<number | null>(null)
  const [aiResult, setAiResult] = useState<AiCheckPayload | null>(null)
  const [savingTimer, setSavingTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [hoverChapterId, setHoverChapterId] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ text: string; range: Range } | null>(null)
  const [toolbarPos, setToolbarPos] = useState({ x: 0, y: 0 })
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteReq, setRewriteReq] = useState('')
  const [rewriting, setRewriting] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)

  const refreshChapter = useCallback(async (chapterId: number) => {
    const full = await window.electron.chapter.get(chapterId)
    if (!full) return

    setCurrentChapter(full)
    setContent(full.content || '')
    setWordCount(countWords(full.content || ''))
    updateChapter(chapterId, full)

    if (editorRef.current) {
      editorRef.current.innerHTML = (full.content || '').replace(/\n/g, '<br>')
    }
  }, [updateChapter])

  const loadChapters = useCallback(async () => {
    const list = await window.electron.chapter.list(novelId)
    setChapters(list)

    if (!currentChapterId && list.length > 0) {
      const firstChapter = list[0]
      setCurrentChapterId(firstChapter.id)
      await refreshChapter(firstChapter.id)
    }
  }, [currentChapterId, novelId, refreshChapter, setChapters, setCurrentChapterId])

  useEffect(() => {
    void loadChapters()
  }, [loadChapters])

  useEffect(() => {
    if (!generatingTaskId) return
    const stream = streams[generatingTaskId]
    if (!stream) return

    if (stream.status === 'completed') {
      const chapterId = currentChapter?.id
      setGenerating(false)
      setGeneratingTaskId(null)
      clearStream(stream.taskId)
      void (async () => {
        await loadChapters()
        if (chapterId) {
          await refreshChapter(chapterId)
        }
        message.success('正文生成完成，已自动更新摘要和连续性记忆')
      })()
    } else if (stream.status === 'failed') {
      setGenerating(false)
      setGeneratingTaskId(null)
      clearStream(stream.taskId)
      message.error('生成失败')
    }
  }, [streams, generatingTaskId, currentChapter, clearStream, loadChapters, refreshChapter])

  useEffect(() => () => {
    if (savingTimer) clearTimeout(savingTimer)
  }, [savingTimer])

  const selectChapter = useCallback(async (chapter: Chapter) => {
    setCurrentChapterId(chapter.id)
    await refreshChapter(chapter.id)
    setAiResult(null)
  }, [refreshChapter, setCurrentChapterId])

  const autoSave = useCallback(async (chapterId: number, text: string) => {
    await window.electron.chapter.update(chapterId, {
      content: text,
      wordCount: countWords(text),
    })
    updateChapter(chapterId, {
      content: text,
      wordCount: countWords(text),
    })
  }, [updateChapter])

  const handleContentChange = (event: React.FormEvent<HTMLDivElement>) => {
    const text = event.currentTarget.innerText || ''
    setContent(text)
    setWordCount(countWords(text))

    if (savingTimer) clearTimeout(savingTimer)
    if (!currentChapter) return

    const timer = setTimeout(() => {
      void autoSave(currentChapter.id, text)
    }, 1500)
    setSavingTimer(timer)
  }

  const handleGenerateContent = async () => {
    if (!currentChapter) {
      message.warning('请先选择章节')
      return
    }

    setGenerating(true)
    try {
      const taskId = await window.electron.chapter.generateContent(currentChapter.id)
      setGeneratingTaskId(taskId)
    } catch (error: unknown) {
      setGenerating(false)
      message.error(error instanceof Error ? error.message : '请先配置 AI 模型')
    }
  }

  const handleCancelGenerate = async () => {
    if (!generatingTaskId) return
    await window.electron.task.cancel(generatingTaskId)
    setGenerating(false)
    setGeneratingTaskId(null)
    clearStream(generatingTaskId)
  }

  const handleGenerateSummary = async () => {
    if (!currentChapter) return
    try {
      await window.electron.chapter.generateSummary(currentChapter.id)
      await Promise.all([loadChapters(), refreshChapter(currentChapter.id)])
      message.success('摘要和连续性记忆已更新')
    } catch (error: unknown) {
      message.error(`生成失败：${error instanceof Error ? error.message : ''}`)
    }
  }

  const handleAiCheck = async () => {
    if (!currentChapter) return
    try {
      const result = await window.electron.chapter.aiCheck(currentChapter.id)
      setAiResult(result as AiCheckPayload)
    } catch (error: unknown) {
      message.error(`检测失败：${error instanceof Error ? error.message : ''}`)
    }
  }

  const handleStatusChange = async (status: string) => {
    if (!currentChapter) return
    await window.electron.chapter.update(currentChapter.id, { status: status as Chapter['status'] })
    await Promise.all([loadChapters(), refreshChapter(currentChapter.id)])
  }

  const handleAddChapter = async () => {
    const nextNum = chapters.length > 0 ? Math.max(...chapters.map((chapter) => chapter.chapterNum)) + 1 : 1
    await window.electron.chapter.create(novelId, {
      chapterNum: nextNum,
      title: `第${nextNum}章`,
      status: 'outline',
    })
    await loadChapters()
    message.success('已新建章节')
  }

  const handleDeleteChapter = async (chapterId: number, event: React.MouseEvent) => {
    event.stopPropagation()
    Modal.confirm({
      title: '确认删除该章节？',
      content: '删除后章节内容无法恢复。',
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        await window.electron.chapter.delete(chapterId)
        if (currentChapterId === chapterId) {
          setCurrentChapterId(null)
          setCurrentChapter(null)
          setContent('')
          setWordCount(0)
        }
        await loadChapters()
      },
    })
  }

  const handleMouseUp = () => {
    const browserSelection = window.getSelection()
    if (!browserSelection || browserSelection.toString().trim().length <= 10 || browserSelection.rangeCount === 0) {
      setSelection(null)
      return
    }

    const range = browserSelection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setToolbarPos({ x: rect.left + rect.width / 2, y: rect.top - 40 })
    setSelection({ text: browserSelection.toString(), range })
  }

  const replaceSelectedText = (nextText: string) => {
    if (!selection) return
    const browserSelection = window.getSelection()
    if (!browserSelection) return

    browserSelection.removeAllRanges()
    browserSelection.addRange(selection.range)
    document.execCommand('insertText', false, nextText)
    setSelection(null)
  }

  const handleRewrite = async () => {
    if (!selection) return
    setRewriting(true)
    try {
      const result = await window.electron.ai.rewriteParagraph({
        originalParagraph: selection.text,
        contextBefore: '',
        specificRequirements: rewriteReq,
      })
      replaceSelectedText(result)
      setRewriteOpen(false)
      setRewriteReq('')
    } catch {
      message.error('重写失败')
    } finally {
      setRewriting(false)
    }
  }

  const runQuickRewrite = async (specificRequirements: string) => {
    if (!selection) return
    try {
      const result = await window.electron.ai.rewriteParagraph({
        originalParagraph: selection.text,
        contextBefore: '',
        specificRequirements,
      })
      replaceSelectedText(result)
    } catch {
      message.error('处理失败')
    }
  }

  const getWorldRulesSummary = () => {
    if (!currentNovel?.worldRulesJson) return null

    try {
      const rules = JSON.parse(currentNovel.worldRulesJson) as Record<string, unknown>
      const lines: string[] = []

      if (rules.power_system && typeof rules.power_system === 'object') {
        const powerSystem = rules.power_system as Record<string, unknown>
        if (typeof powerSystem.name === 'string' && powerSystem.name.trim()) {
          lines.push(`力量体系：${powerSystem.name.trim()}`)
        }
      }

      if (typeof rules.social_structure === 'string' && rules.social_structure.trim()) {
        lines.push(`社会结构：${rules.social_structure.trim()}`)
      }

      if (Array.isArray(rules.forbidden_elements) && rules.forbidden_elements.length > 0) {
        lines.push(`禁止元素：${rules.forbidden_elements.slice(0, 3).join('、')}`)
      }

      return lines.length > 0 ? lines : null
    } catch {
      return null
    }
  }

  const continuity = parseContinuity(currentChapter?.continuityStateJson)
  const continuityItems = continuity ? [
    continuity.plot_progress?.length ? `剧情推进：${continuity.plot_progress.join('；')}` : '',
    continuity.character_state_changes?.length ? `人物变化：${continuity.character_state_changes.join('；')}` : '',
    continuity.world_state_changes?.length ? `世界变化：${continuity.world_state_changes.join('；')}` : '',
    continuity.open_loops?.length ? `未回收事项：${continuity.open_loops.join('；')}` : '',
    continuity.continuity_notes?.length ? `承接提示：${continuity.continuity_notes.join('；')}` : '',
    continuity.arc_progress ? `故事弧推进：${continuity.arc_progress}` : '',
  ].filter(Boolean) : []

  const streamContent = generatingTaskId ? streams[generatingTaskId]?.content : ''
  const worldRulesSummary = getWorldRulesSummary()

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div
        style={{
          width: 220,
          borderRight: '1px solid var(--border-color)',
          background: 'var(--color-bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>章节列表</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
            共 {chapters.length} 章
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {chapters.map((chapter) => (
            <div
              key={chapter.id}
              onClick={() => void selectChapter(chapter)}
              onMouseEnter={() => setHoverChapterId(chapter.id)}
              onMouseLeave={() => setHoverChapterId(null)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                background: currentChapterId === chapter.id ? 'rgba(46,134,171,0.15)' : 'transparent',
                borderLeft: currentChapterId === chapter.id ? '3px solid #2E86AB' : '3px solid transparent',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>第{chapter.chapterNum}章</div>
                <div
                  style={{
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {chapter.title || `第${chapter.chapterNum}章`}
                </div>
                <div style={{ fontSize: 11, color: STATUS_COLORS[chapter.status] || '#5c6378', marginTop: 2 }}>
                  {chapter.wordCount} 字
                </div>
              </div>
              {hoverChapterId === chapter.id && (
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                  onClick={(event) => handleDeleteChapter(chapter.id, event)}
                  style={{ padding: '0 2px', height: 20, flexShrink: 0 }}
                />
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-color)' }}>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => void handleAddChapter()}
            style={{ width: '100%' }}
          >
            新建章节
          </Button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {currentChapter ? (
          <>
            <div
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span style={{ fontWeight: 600 }}>
                第{currentChapter.chapterNum}章 {currentChapter.title}
              </span>
              <Select
                value={currentChapter.status}
                onChange={(value) => void handleStatusChange(value)}
                size="small"
                style={{ width: 100 }}
                options={STATUS_OPTIONS}
              />
              <div style={{ flex: 1 }} />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{wordCount} 字</span>
            </div>

            <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              {generating ? (
                <div style={{ padding: 24 }}>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 12, fontSize: 12 }}>
                    AI 正在生成... <Spin size="small" style={{ marginLeft: 8 }} />
                  </div>
                  <div
                    style={{
                      whiteSpace: 'pre-wrap',
                      lineHeight: 2,
                      fontSize: 15,
                      color: 'var(--color-text-primary)',
                      maxWidth: 760,
                    }}
                  >
                    {streamContent}
                    <span className="streaming-cursor" />
                  </div>
                </div>
              ) : (
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={handleContentChange}
                  onMouseUp={handleMouseUp}
                  style={{
                    minHeight: '100%',
                    padding: '24px 32px',
                    outline: 'none',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 2,
                    fontSize: 15,
                    color: 'var(--color-text-primary)',
                    maxWidth: 800,
                    margin: '0 auto',
                  }}
                  dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br>') }}
                />
              )}
            </div>

            <div
              style={{
                padding: '8px 16px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              {generating ? (
                <Button danger icon={<LoadingOutlined />} onClick={() => void handleCancelGenerate()}>
                  取消生成
                </Button>
              ) : (
                <Button type="primary" icon={<RobotOutlined />} onClick={() => void handleGenerateContent()}>
                  AI 生成本章
                </Button>
              )}
              <Button icon={<FileSearchOutlined />} onClick={() => void handleAiCheck()}>
                AI 检测
              </Button>
              <Button icon={<BulbOutlined />} onClick={() => void handleGenerateSummary()}>
                更新摘要
              </Button>
              <Button icon={<CheckOutlined />} onClick={() => void handleStatusChange('final')} style={{ marginLeft: 'auto' }}>
                标记完成
              </Button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Empty description="请先从左侧选择章节" />
          </div>
        )}

        {selection && (
          <div
            style={{
              position: 'fixed',
              left: toolbarPos.x - 90,
              top: toolbarPos.y,
              background: 'var(--color-bg-card)',
              border: '1px solid var(--border-color-hover)',
              borderRadius: 6,
              padding: '4px 8px',
              display: 'flex',
              gap: 4,
              zIndex: 999,
              boxShadow: 'var(--shadow-modal)',
            }}
          >
            <Button size="small" onClick={() => setRewriteOpen(true)}>重写</Button>
            <Button
              size="small"
              onClick={() => void runQuickRewrite('在保留原意的基础上扩充细节，让段落更丰富。')}
            >
              扩写
            </Button>
            <Button
              size="small"
              onClick={() => void runQuickRewrite('压缩段落，保留核心信息，去掉冗余描写。')}
            >
              压缩
            </Button>
          </div>
        )}
      </div>

      <div
        style={{
          width: 300,
          borderLeft: '1px solid var(--border-color)',
          background: 'var(--color-bg-secondary)',
          overflow: 'auto',
          padding: 12,
        }}
      >
        <Collapse
          size="small"
          defaultActiveKey={['outline', 'continuity', 'aicheck']}
          items={[
            {
              key: 'outline',
              label: '本章大纲',
              children: currentChapter?.outline ? (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {currentChapter.outline}
                </div>
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>暂无大纲</div>
              ),
            },
            {
              key: 'continuity',
              label: '连续性记忆',
              children: continuityItems.length > 0 ? (
                <div>
                  {continuityItems.map((item, index) => (
                    <div
                      key={index}
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-secondary)',
                        lineHeight: 1.8,
                        padding: '4px 0',
                        borderBottom: index < continuityItems.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                  还没有连续性记忆，生成正文或点击“更新摘要”后会自动写入。
                </div>
              ),
            },
            {
              key: 'aicheck',
              label: 'AI 检测结果',
              children: aiResult ? (
                <AiCheckResult result={aiResult} />
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>点击底部“AI 检测”查看结果。</div>
              ),
            },
            {
              key: 'worldrules',
              label: '世界规则摘要',
              children: worldRulesSummary ? (
                <div>
                  {worldRulesSummary.map((item, index) => (
                    <div
                      key={index}
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-secondary)',
                        lineHeight: 1.8,
                        padding: '2px 0',
                        borderBottom: index < worldRulesSummary.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                  {currentNovel?.worldRulesJson ? '世界规则暂无结构化数据。' : '尚未配置世界规则。'}
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title="重写段落"
        open={rewriteOpen}
        onCancel={() => setRewriteOpen(false)}
        onOk={() => void handleRewrite()}
        confirmLoading={rewriting}
        okText="开始重写"
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 8 }}>选中文本：</div>
          <div
            style={{
              background: 'var(--color-bg-card)',
              padding: 8,
              borderRadius: 4,
              fontSize: 12,
              maxHeight: 80,
              overflow: 'auto',
            }}
          >
            {selection?.text}
          </div>
        </div>
        <Input.TextArea
          value={rewriteReq}
          onChange={(event) => setRewriteReq(event.target.value)}
          placeholder="改写要求，例如：语气更凌厉、减少心理描写、增加动作细节"
          rows={5}
        />
      </Modal>
    </div>
  )
}

function AiCheckResult({ result }: { result: AiCheckPayload }) {
  const scoreColor = result.score >= 80 ? '#52c41a' : result.score >= 60 ? '#faad14' : '#ff4d4f'

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <Progress
          type="circle"
          percent={result.score}
          size={80}
          strokeColor={scoreColor}
          trailColor="rgba(255,255,255,0.08)"
          format={(percent) => (
            <span style={{ color: scoreColor, fontSize: 18, fontWeight: 700 }}>{percent}</span>
          )}
        />
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, marginTop: 8 }}>
          {result.overall_feedback}
        </div>
      </div>

      {result.issues.map((issue, index) => (
        <div
          key={`${issue.type}-${index}`}
          style={{
            marginBottom: 8,
            padding: '6px 8px',
            background: 'rgba(255,77,79,0.1)',
            borderRadius: 4,
            borderLeft: '2px solid #ff4d4f',
          }}
        >
          <div style={{ fontSize: 11, color: '#ff4d4f' }}>{issue.type}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{issue.location}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {issue.suggestion}
          </div>
        </div>
      ))}
    </div>
  )
}
