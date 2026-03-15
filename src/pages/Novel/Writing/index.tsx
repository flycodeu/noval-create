import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  Button, Select, Tag, Collapse, Spin, Empty, message, Tooltip,
  Modal, Input, Progress
} from 'antd'
import {
  RobotOutlined, CheckOutlined, LoadingOutlined,
  SaveOutlined, FileSearchOutlined, BulbOutlined,
  PlusOutlined, DeleteOutlined
} from '@ant-design/icons'
import { Chapter } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useTaskStore } from '../../../stores/task.store'

interface Props { novelId: number }

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

export default function Writing({ novelId }: Props) {
  const { chapters, setChapters, currentChapterId, setCurrentChapterId, currentNovel } = useNovelStore()
  const { streams } = useTaskStore()
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [content, setContent] = useState('')
  const [aiResult, setAiResult] = useState<unknown>(null)
  const [generating, setGenerating] = useState(false)
  const [generatingTaskId, setGeneratingTaskId] = useState<number | null>(null)
  const [savingTimer, setSavingTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [wordCount, setWordCount] = useState(0)
  const [hoverChapterId, setHoverChapterId] = useState<number | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  // 选中文本浮现工具栏
  const [selection, setSelection] = useState<{ text: string; range: Range } | null>(null)
  const [toolbarPos, setToolbarPos] = useState({ x: 0, y: 0 })
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteReq, setRewriteReq] = useState('')
  const [rewriting, setRewriting] = useState(false)

  const loadChapters = useCallback(async () => {
    const list = await window.electron.chapter.list(novelId)
    setChapters(list)
    if (list.length > 0 && !currentChapterId) {
      selectChapter(list[0])
    }
  }, [novelId, setChapters, currentChapterId])

  useEffect(() => { loadChapters() }, [loadChapters])

  // 监听流式输出
  useEffect(() => {
    if (generatingTaskId && streams[generatingTaskId]) {
      const stream = streams[generatingTaskId]
      if (stream.status === 'completed') {
        const generatedContent = stream.content
        setContent(generatedContent)
        if (editorRef.current) {
          editorRef.current.innerHTML = generatedContent.replace(/\n/g, '<br>')
        }
        if (currentChapter) {
          autoSave(currentChapter.id, generatedContent)
        }
        setGenerating(false)
        setGeneratingTaskId(null)
        message.success('正文生成完成')
      } else if (stream.status === 'failed') {
        setGenerating(false)
        setGeneratingTaskId(null)
        message.error('生成失败')
      }
    }
  }, [streams, generatingTaskId])

  const selectChapter = async (chapter: Chapter) => {
    setCurrentChapterId(chapter.id)
    const full = await window.electron.chapter.get(chapter.id)
    setCurrentChapter(full)
    setContent(full?.content || '')
    setWordCount(countWords(full?.content || ''))
    setAiResult(null)
  }

  const countWords = (text: string) => {
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length
    const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
    return chinese + english
  }

  const autoSave = useCallback(async (chapterId: number, text: string) => {
    await window.electron.chapter.update(chapterId, {
      content: text,
      wordCount: countWords(text),
    })
  }, [])

  const handleContentChange = (e: React.FormEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText || ''
    setContent(text)
    setWordCount(countWords(text))

    if (savingTimer) clearTimeout(savingTimer)
    if (currentChapter) {
      const timer = setTimeout(() => {
        autoSave(currentChapter.id, text)
      }, 1500)
      setSavingTimer(timer)
    }
  }

  const handleGenerateContent = async () => {
    if (!currentChapter) { message.warning('请先选择章节'); return }
    setGenerating(true)
    try {
      const taskId = await window.electron.chapter.generateContent(currentChapter.id)
      setGeneratingTaskId(taskId)
    } catch (e: unknown) {
      message.error(`${e instanceof Error ? e.message : '请先配置 AI 模型'}`)
      setGenerating(false)
    }
  }

  const handleCancelGenerate = async () => {
    if (generatingTaskId) {
      await window.electron.task.cancel(generatingTaskId)
      setGenerating(false)
      setGeneratingTaskId(null)
    }
  }

  const handleGenerateSummary = async () => {
    if (!currentChapter) return
    try {
      await window.electron.chapter.generateSummary(currentChapter.id)
      message.success('摘要已生成')
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : ''}`)
    }
  }

  const handleAiCheck = async () => {
    if (!currentChapter) return
    try {
      const result = await window.electron.chapter.aiCheck(currentChapter.id)
      setAiResult(result)
    } catch (e: unknown) {
      message.error(`检测失败：${e instanceof Error ? e.message : ''}`)
    }
  }

  const handleStatusChange = async (status: string) => {
    if (!currentChapter) return
    await window.electron.chapter.update(currentChapter.id, { status })
    setCurrentChapter({ ...currentChapter, status: status as Chapter['status'] })
  }

  const handleAddChapter = async () => {
    const nextNum = chapters.length > 0 ? Math.max(...chapters.map(c => c.chapterNum)) + 1 : 1
    await window.electron.chapter.create(novelId, {
      chapterNum: nextNum,
      title: `第${nextNum}章`,
      status: 'outline',
    })
    await loadChapters()
    message.success('已新建章节')
  }

  const handleDeleteChapter = async (chapterId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    Modal.confirm({
      title: '确认删除该章节？',
      content: '删除后章节内容将无法恢复',
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        await window.electron.chapter.delete(chapterId)
        if (currentChapterId === chapterId) {
          setCurrentChapterId(undefined as unknown as number)
          setCurrentChapter(null)
        }
        await loadChapters()
      },
    })
  }

  // 文本选中处理
  const handleMouseUp = () => {
    const sel = window.getSelection()
    if (sel && sel.toString().trim().length > 10) {
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setToolbarPos({ x: rect.left + rect.width / 2, y: rect.top - 40 })
      setSelection({ text: sel.toString(), range })
    } else {
      setSelection(null)
    }
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
      const sel = window.getSelection()
      if (sel && selection.range) {
        sel.removeAllRanges()
        sel.addRange(selection.range)
        document.execCommand('insertText', false, result)
      }
      setRewriteOpen(false)
      setSelection(null)
    } catch {
      message.error('重写失败')
    } finally {
      setRewriting(false)
    }
  }

  // 提取世界规则摘要
  const getWorldRulesSummary = () => {
    if (!currentNovel?.worldRulesJson) return null
    try {
      const rules = JSON.parse(currentNovel.worldRulesJson)
      const items: string[] = []
      if (rules.power_system?.name) items.push(`力量体系：${rules.power_system.name}`)
      if (rules.social_structure) items.push(`社会结构：${rules.social_structure}`)
      if (rules.forbidden_elements?.length) items.push(`禁止元素：${rules.forbidden_elements.slice(0, 3).join('、')}`)
      if (rules.unique_features?.length) items.push(`特色元素：${rules.unique_features.slice(0, 3).join('、')}`)
      return items.length > 0 ? items : null
    } catch {
      return null
    }
  }

  const worldRulesSummary = getWorldRulesSummary()
  const streamContent = generatingTaskId ? streams[generatingTaskId]?.content : null

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左栏：章节列表 */}
      <div style={{
        width: 200,
        borderRight: '1px solid var(--border-color)',
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>章节列表</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
            共 {chapters.length} 章 · {(chapters.reduce((s, c) => s + c.wordCount, 0) / 10000).toFixed(1)} 万字
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {chapters.map(ch => (
            <div
              key={ch.id}
              onClick={() => selectChapter(ch)}
              onMouseEnter={() => setHoverChapterId(ch.id)}
              onMouseLeave={() => setHoverChapterId(null)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                background: currentChapterId === ch.id ? 'rgba(46,134,171,0.15)' : 'transparent',
                borderLeft: currentChapterId === ch.id ? '3px solid #2E86AB' : '3px solid transparent',
                transition: 'background var(--transition-fast)',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>第{ch.chapterNum}章</div>
                <div style={{
                  fontSize: 13,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {ch.title || `第${ch.chapterNum}章`}
                </div>
                <div style={{ fontSize: 11, color: STATUS_COLORS[ch.status] || '#5c6378', marginTop: 2 }}>
                  {ch.wordCount} 字
                </div>
              </div>
              {hoverChapterId === ch.id && (
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                  onClick={e => handleDeleteChapter(ch.id, e)}
                  style={{ padding: '0 2px', height: 20, flexShrink: 0 }}
                />
              )}
            </div>
          ))}
        </div>

        {/* 新建章节按钮 */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-color)' }}>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={handleAddChapter}
            style={{ width: '100%' }}
          >
            新建章节
          </Button>
        </div>
      </div>

      {/* 中栏：编辑器 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {currentChapter ? (
          <>
            {/* 顶部工具栏 */}
            <div style={{
              padding: '8px 16px',
              borderBottom: '1px solid var(--border-color)',
            }}>
              <span style={{ fontWeight: 600 }}>
                第{currentChapter.chapterNum}章 {currentChapter.title}
              </span>
              <Select
                value={currentChapter.status}
                onChange={handleStatusChange}
                size="small"
                style={{ width: 100 }}
                options={STATUS_OPTIONS}
              />
              <div style={{ flex: 1 }} />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                {wordCount} 字
              </span>
            </div>

            {/* 编辑区 */}
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

            {/* 底部操作栏 */}
            <div style={{
              padding: '8px 16px',
              borderTop: '1px solid var(--border-color)',
            }}>
              {generating ? (
                <Button danger icon={<LoadingOutlined />} onClick={handleCancelGenerate}>
                  取消生成
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  onClick={handleGenerateContent}
                >
                  AI 生成本章
                </Button>
              )}
              <Button icon={<FileSearchOutlined />} onClick={handleAiCheck}>AI 检测</Button>
              <Button icon={<BulbOutlined />} onClick={handleGenerateSummary}>生成摘要</Button>
              <Button
                icon={<CheckOutlined />}
                onClick={() => handleStatusChange('final')}
                style={{ marginLeft: 'auto' }}
              >
                标记完成
              </Button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Empty description="请从左侧选择章节" />
          </div>
        )}

        {/* 选中文本工具栏 */}
        {selection && (
          <div style={{
            position: 'fixed',
            left: toolbarPos.x - 80,
            top: toolbarPos.y,
            background: 'var(--color-bg-card)',
            border: '1px solid var(--border-color-hover)',
            borderRadius: 6,
            padding: '4px 8px',
            display: 'flex',
            gap: 4,
            zIndex: 999,
            boxShadow: 'var(--shadow-modal)',
          }}>
            <Button size="small" onClick={() => setRewriteOpen(true)}>重写</Button>
            <Button size="small" onClick={() => {
              window.electron.ai.rewriteParagraph({
                originalParagraph: selection.text,
                contextBefore: '',
                specificRequirements: '在保留原意的基础上扩充内容，增加细节描写，使段落更丰富',
              }).then(result => {
                const sel = window.getSelection()
                if (sel) {
                  sel.removeAllRanges()
                  sel.addRange(selection.range)
                  document.execCommand('insertText', false, result)
                }
                setSelection(null)
              })
            }}>扩写</Button>
            <Button size="small" onClick={() => {
              window.electron.ai.rewriteParagraph({
                originalParagraph: selection.text,
                contextBefore: '',
                specificRequirements: '压缩段落，保留核心内容，去掉冗余描写，使文字更精炼',
              }).then(result => {
                const sel = window.getSelection()
                if (sel) {
                  sel.removeAllRanges()
                  sel.addRange(selection.range)
                  document.execCommand('insertText', false, result)
                }
                setSelection(null)
              })
            }}>压缩</Button>
          </div>
        )}
      </div>

      {/* 右栏：参考信息 */}
      <div style={{
        width: 280,
        borderLeft: '1px solid var(--border-color)',
        background: 'var(--color-bg-secondary)',
        overflow: 'auto',
        padding: 12,
      }}>
        <Collapse
          size="small"
          defaultActiveKey={['outline', 'aicheck']}
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
              key: 'aicheck',
              label: 'AI 检测结果',
              children: aiResult ? (
                <AiCheckResult result={aiResult as { score: number; issues: { type: string; location: string; suggestion: string }[]; overall_feedback: string }} />
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>点击底部「AI 检测」查看结果</div>
              ),
            },
            {
              key: 'worldrules',
              label: '世界规则摘要',
              children: worldRulesSummary ? (
                <div>
                  {worldRulesSummary.map((item, i) => (
                    <div key={i} style={{
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.8,
                      padding: '2px 0',
                      borderBottom: i < worldRulesSummary.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    }}>
                      {item}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                  {currentNovel?.worldRulesJson ? '世界规则暂无结构化数据' : '尚未配置世界规则'}
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* 重写对话框 */}
      <Modal
        title="重写段落"
        open={rewriteOpen}
        onCancel={() => setRewriteOpen(false)}
        onOk={handleRewrite}
        confirmLoading={rewriting}
        okText="开始重写"
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 8 }}>选中文本：</div>
          <div style={{
            background: 'var(--color-bg-card)',
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            maxHeight: 80,
            overflow: 'auto',
          }}>
            {selection?.text}
          </div>
        </div>
        <Input.TextArea
          value={rewriteReq}
          onChange={e => setRewriteReq(e.target.value)}
          placeholder="改写要求（可选）：例如「语气更凌厉」「减少心理描写」"
          rows={5}
        />
      </Modal>
    </div>
  )
}

function AiCheckResult({ result }: {
  result: { score: number; issues: { type: string; location: string; suggestion: string }[]; overall_feedback: string }
}) {
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
          format={p => (
            <span style={{ color: scoreColor, fontSize: 18, fontWeight: 700 }}>{p}</span>
          )}
        />
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, marginTop: 8 }}>
          {result.overall_feedback}
        </div>
      </div>
      {result.issues.map((issue, i) => (
        <div key={i} style={{
          marginBottom: 8,
          padding: '6px 8px',
          background: 'rgba(255,77,79,0.1)',
          borderRadius: 4,
          borderLeft: '2px solid #ff4d4f',
        }}>
          <div style={{ fontSize: 11, color: '#ff4d4f' }}>{issue.type}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>「{issue.location}」</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>→ {issue.suggestion}</div>
        </div>
      ))}
    </div>
  )
}
