import React, { useState } from 'react'
import { Button, Progress, Collapse, Tag, Input, message } from 'antd'
import { BarChartOutlined, LoadingOutlined, SyncOutlined } from '@ant-design/icons'
import { AIScoreResult } from '../../types'
import AIGenerateButton from '../AIGenerateButton'

type Message = { role: 'user' | 'assistant'; content: string }

interface Props {
  /** 调用时获取最新内容 */
  getContent: () => string
  contentType: string
  novelBackground?: string
  genreContext?: string
  modelConfigId?: number
  /** 重新生成后的回调，将新内容（已去除 Markdown）应用到字段 */
  onRegenerate?: (newContent: string) => void
  /** 抽卡次数（传给重生成按钮） */
  drawCount?: number
  /**
   * 自定义重生成消息构建函数。
   * 提供时覆盖默认逻辑；当需要 JSON 结构输出时使用。
   * 若使用此 prop，onRegenerate 会收到原始 AI 输出（未 strip markdown）。
   */
  buildCustomRegenMessages?: (
    content: string,
    result: AIScoreResult,
    extraReqs: string
  ) => Message[]
  /** 使用自定义消息时是否输出 JSON（默认 false，即自动 strip markdown） */
  customIsJson?: boolean
}

const scoreColor = (s: number) => s >= 80 ? '#52c41a' : s >= 60 ? '#faad14' : '#ff4d4f'
const riskColor = (r: string) => r === '高' ? 'error' : r === '中' ? 'warning' : 'success'
const aiRateColor = (r: number) => r > 50 ? '#ff4d4f' : r > 30 ? '#faad14' : '#52c41a'

export default function AIScorePanel({
  getContent,
  contentType,
  novelBackground = '',
  genreContext = '',
  modelConfigId,
  onRegenerate,
  drawCount = 1,
  buildCustomRegenMessages,
  customIsJson = false,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AIScoreResult | null>(null)
  const [extraReqs, setExtraReqs] = useState('')
  const [showRegen, setShowRegen] = useState(false)

  const handleScore = async () => {
    const content = getContent()
    if (!content?.trim()) {
      message.warning('请先填写内容再进行评分')
      return
    }
    setLoading(true)
    try {
      const r = await window.electron.ai.scoreContent({
        contentType,
        content,
        genreContext,
        novelBackground,
        modelConfigId,
      })
      setResult(r)
      setShowRegen(false)
    } catch (e: unknown) {
      message.error(`评分失败：${e instanceof Error ? e.message : '请先配置模型'}`)
    } finally {
      setLoading(false)
    }
  }

  /** 构建「按评分优化」的提示词 */
  const buildRegenMessages = (): Message[] => {
    if (!result) return []
    const content = getContent()

    // 使用自定义消息构建器（当需要 JSON 结构输出时）
    if (buildCustomRegenMessages) {
      return buildCustomRegenMessages(content, result, extraReqs)
    }

    // 找出得分最低的维度，重点改进
    const sorted = [...result.dimensions].sort((a, b) => a.score - b.score)
    const weakDims = sorted.slice(0, 3)

    const dimSuggestions = weakDims
      .filter(d => d.suggestion)
      .map(d => `${d.name}（当前${d.score}分）：${d.suggestion}`)
      .join('\n')

    const topFixes = result.top_fixes
      .map((f, i) => `${i + 1}. ${f}`)
      .join('\n')

    const prompt = `你是专业的中文小说策划师和内容优化专家。请根据AI评分反馈，对以下【${contentType}】进行针对性优化重写。

【当前内容】
${content}

【综合评价】${result.overall_feedback}（综合得分：${result.overall_score}/100，AI味：${result.ai_like_rate}%）

【优先解决的问题】
${topFixes}

【需要重点改进的维度】
${dimSuggestions}
${extraReqs ? `\n【用户追加要求】${extraReqs}` : ''}

优化要求：
- 重点改进评分最低的维度，不是每处都改
- 保留原内容的核心设定和关键信息
- 减少AI写作痕迹（禁止"不禁/不由得/忍不住/此刻"等引导词）
- 增加具体细节，用具体事物代替抽象描述
- 结合${genreContext}题材的特点

格式要求：
- 直接输出纯文本，不要任何解释
- 禁止使用任何 Markdown 格式（**加粗**、## 标题、- 列表、> 引用等）
- 段落之间用空行分隔`

    return [{ role: 'user' as const, content: prompt }]
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border-color)',
      marginTop: 10,
      paddingTop: 6,
    }}>
      {/* 评分触发行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button
          size="small"
          type="text"
          icon={loading ? <LoadingOutlined /> : <BarChartOutlined />}
          loading={loading}
          onClick={handleScore}
          style={{ color: 'var(--color-text-muted)', fontSize: 12, paddingLeft: 0 }}
        >
          AI 评分
        </Button>

        {result && (
          <>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              综合&nbsp;
              <span style={{ color: scoreColor(result.overall_score), fontWeight: 700 }}>
                {result.overall_score}
              </span>
              /100&nbsp;·&nbsp;AI味&nbsp;
              <span style={{ color: aiRateColor(result.ai_like_rate), fontWeight: 600 }}>
                {result.ai_like_rate}%
              </span>
            </span>

            {onRegenerate && (
              <Button
                size="small"
                type="text"
                icon={<SyncOutlined />}
                onClick={() => setShowRegen(v => !v)}
                style={{ color: 'var(--color-blue-light)', fontSize: 12 }}
              >
                按评分优化重生成
              </Button>
            )}
          </>
        )}
      </div>

      {/* 详细评分（可折叠） */}
      {result && (
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 2 }}
          items={[{
            key: 'detail',
            label: (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                查看各维度评分 →
              </span>
            ),
            children: (
              <div style={{ fontSize: 12 }}>
                {result.dimensions.map(d => (
                  <div key={d.name} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{
                        width: 72, flexShrink: 0,
                        color: d.score < 60 ? 'var(--color-error)' : 'var(--color-text-secondary)',
                        fontWeight: d.score < 60 ? 600 : 400,
                      }}>
                        {d.name}
                      </span>
                      <Progress
                        percent={d.score}
                        size="small"
                        strokeColor={scoreColor(d.score)}
                        trailColor="var(--border-color)"
                        style={{ flex: 1, margin: 0 }}
                        format={p => (
                          <span style={{ color: scoreColor(d.score), fontSize: 11, fontWeight: 600 }}>
                            {p}
                          </span>
                        )}
                      />
                    </div>
                    <div style={{ marginLeft: 80, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                      {d.feedback}
                      {d.suggestion && (
                        <span style={{ color: 'var(--color-blue-light)', marginLeft: 6 }}>
                          → {d.suggestion}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {/* 综合评价 + 修改建议 */}
                <div style={{
                  padding: '8px 12px',
                  background: 'var(--color-bg-hover)',
                  borderRadius: 6,
                  marginTop: 4,
                  marginBottom: 6,
                }}>
                  <div style={{ color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: 4 }}>
                    综合评价
                  </div>
                  <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, marginBottom: 8 }}>
                    {result.overall_feedback}
                  </div>
                  <div style={{ color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: 4 }}>
                    优先修改
                  </div>
                  {result.top_fixes.map((fix, i) => (
                    <div key={i} style={{
                      color: 'var(--color-text-secondary)',
                      marginBottom: 4,
                      paddingLeft: 8,
                      borderLeft: `2px solid ${['#ff4d4f', '#faad14', '#2E86AB'][i] || '#5c6378'}`,
                      lineHeight: 1.6,
                    }}>
                      {fix}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <Tag color={riskColor(result.repetition_risk)}>
                    重复风险：{result.repetition_risk}
                  </Tag>
                  <Tag color={result.ai_like_rate > 50 ? 'error' : result.ai_like_rate > 30 ? 'warning' : 'success'}>
                    AI痕迹：{result.ai_like_rate}%
                  </Tag>
                </div>
              </div>
            ),
          }]}
        />
      )}

      {/* 按评分重生成区域 */}
      {result && onRegenerate && showRegen && (
        <div style={{
          marginTop: 8,
          padding: '10px 12px',
          background: 'rgba(46,134,171,0.06)',
          border: '1px solid rgba(46,134,171,0.2)',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8, fontWeight: 600 }}>
            按评分意见重新生成
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
            AI 会结合评分反馈（主要问题 + 各维度改进建议）对原内容进行优化重写，
            生成新版本后可选择应用或放弃。
          </div>
          <Input.TextArea
            value={extraReqs}
            onChange={e => setExtraReqs(e.target.value)}
            placeholder="追加优化要求（可选）：如「保留第一段」「增加细节描写」「风格更简洁」..."
            rows={2}
            style={{ marginBottom: 8, fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <AIGenerateButton
              label="AI 优化重生成"
              buildMessages={buildRegenMessages}
              drawCount={drawCount}
              isJson={!!buildCustomRegenMessages && customIsJson}
              onResult={content => {
                onRegenerate(content)
                setShowRegen(false)
                message.success('优化内容已应用，可继续评分查看效果')
              }}
              modelConfigId={modelConfigId}
              type="primary"
              size="small"
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {drawCount > 1 ? `将生成 ${drawCount} 个版本供选择` : '直接应用到内容'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
