import React, { useState } from 'react'
import { Button, Progress, Collapse, Tag, Input, message } from 'antd'
import { BarChartOutlined, LoadingOutlined, SyncOutlined } from '@ant-design/icons'
import { AIScoreResult } from '../../types'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import AIGenerateButton from '../AIGenerateButton'

type Message = { role: 'user' | 'assistant'; content: string }
type RunGenerationInput = {
  messages: Message[]
  count: number
  modelConfigId?: number
  novelId?: number
}

interface Props {
  /** 调用时获取最新内容 */
  getContent: () => string
  contentType: string
  novelBackground?: string
  genreContext?: string
  modelConfigId?: number
  novelId?: number
  disabled?: boolean
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
  /** 自定义生成执行器，优先于默认 ai.runPrompt */
  customRunGeneration?: (input: RunGenerationInput) => Promise<string[]>
}

const scoreColor = (s: number) => s >= 80 ? '#52c41a' : s >= 60 ? '#faad14' : '#ff4d4f'
const riskColor = (r: string) => r === '高' ? 'error' : r === '中' ? 'warning' : 'success'
const aiRateColor = (r: number) => r > 50 ? '#ff4d4f' : r > 30 ? '#faad14' : '#52c41a'
type LanguageDriftKey = 'abstractTokenDensity' | 'sentencePatternRepeatRate' | 'endingSummaryRate' | 'ornamentOverloadRate' | 'nonHumanCollocationRate'

const languageDriftLabels: Array<{ key: LanguageDriftKey; label: string }> = [
  { key: 'abstractTokenDensity', label: '抽象词密度' },
  { key: 'sentencePatternRepeatRate', label: '句式重复率' },
  { key: 'endingSummaryRate', label: '段尾升华率' },
  { key: 'ornamentOverloadRate', label: '华丽词堆砌率' },
  { key: 'nonHumanCollocationRate', label: '非人类搭配率' },
]

export default function AIScorePanel({
  getContent,
  contentType,
  novelBackground = '',
  genreContext = '',
  modelConfigId,
  novelId,
  disabled = false,
  onRegenerate,
  drawCount = 1,
  buildCustomRegenMessages,
  customIsJson = false,
  customRunGeneration,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AIScoreResult | null>(null)
  const [extraReqs, setExtraReqs] = useState('')
  const [showRegen, setShowRegen] = useState(false)

  const handleScore = async () => {
    if (disabled) return
    const content = getContent()
    if (!content?.trim()) {
      message.warning(getUserFacingMessage('aiScore.contentRequired'))
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
      message.error(getUserFacingMessage('aiScore.failed', {
        detail: e instanceof Error ? e.message : getUserFacingMessage('writing.configureModelFirst'),
      }))
    } finally {
      setLoading(false)
    }
  }

  /** 构建「按评分优化」的提示词 */
  const buildRegenMessages = (): Message[] => {
    if (!result) return []
    const content = getContent()

    if (buildCustomRegenMessages) {
      return buildCustomRegenMessages(content, result, extraReqs)
    }

    const sorted = [...result.dimensions].sort((a, b) => a.score - b.score)
    const weakDims = sorted.slice(0, 3)

    const dimSuggestions = weakDims
      .filter((dimension) => dimension.suggestion)
      .map((dimension) => dimension.name + '（当前 ' + dimension.score + ' 分）：' + dimension.suggestion)
      .join('\n')

    const topFixes = result.top_fixes
      .slice(0, 3)
      .map((fix, index) => (index + 1) + '. ' + fix)
      .join('\n')

    const prompt = [
      '你在返修一段小说相关内容。请只处理最影响成稿质量的那几处，不要整段推翻重写。',
      '',
      '【内容类型】' + contentType,
      '【当前内容】',
      content,
      '',
      '【综合判断】' + result.overall_feedback + '（综合 ' + result.overall_score + '/100，AI 味 ' + result.ai_like_rate + '%）',
      '',
      '【优先处理的问题】',
      topFixes || '1. 先修逻辑和语言里最明显的问题。',
      '',
      '【需要重点补强的维度】',
      dimSuggestions || '优先修因果、指代、搭配和表达自然度。',
      extraReqs ? '' : '',
      extraReqs ? '【用户追加要求】' + extraReqs : '',
      extraReqs ? '' : '',
      '返修原则：',
      '- 只修分数最低的 2 到 3 个维度，不要把每一句都改掉',
      '- 保留原内容里已经成立的设定、事件和关键信息',
      '- 先修逻辑、指代、因果、搭配，再修语气和文气',
      '- 少用模板连接词、空泛总结句和假深刻表达',
      '- 多用具体事实、动作、关系和代价代替抽象判断',
      '- 贴近' + (genreContext || '当前题材') + '常见写法，但不要模仿具体作者',
      '',
      '输出要求：',
      '- 直接输出返修后的纯文本，不要解释',
      '- 不要使用 Markdown',
      '- 段落之间空一行',
    ].filter(Boolean).join('\n')

    return [{ role: 'user' as const, content: prompt }]
  }


  return (
    <div style={{
      borderTop: '1px solid var(--border-default)',
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
          disabled={disabled}
          style={{ color: 'var(--text-muted)', fontSize: 12, paddingLeft: 0 }}
        >
          AI 检测
        </Button>

        {result && (
          <>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              综合&nbsp;
              <span style={{ color: scoreColor(result.overall_score), fontWeight: 700 }}>
                {result.overall_score}
              </span>
              /100&nbsp;·&nbsp;AI 味&nbsp;
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
                disabled={disabled}
                style={{ color: 'var(--color-blue-light)', fontSize: 12 }}
              >
                按检测结果修复
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
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
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
                        color: d.score < 60 ? 'var(--danger)' : 'var(--text-secondary)',
                        fontWeight: d.score < 60 ? 600 : 400,
                      }}>
                        {d.name}
                      </span>
                      <Progress
                        percent={d.score}
                        size="small"
                        strokeColor={scoreColor(d.score)}
                        trailColor="var(--border-default)"
                        style={{ flex: 1, margin: 0 }}
                        format={p => (
                          <span style={{ color: scoreColor(d.score), fontSize: 11, fontWeight: 600 }}>
                            {p}
                          </span>
                        )}
                      />
                    </div>
                    <div style={{ marginLeft: 80, color: 'var(--text-muted)', lineHeight: 1.6 }}>
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
                  background: 'var(--bg-hover)',
                  borderRadius: 6,
                  marginTop: 4,
                  marginBottom: 6,
                }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>
                    综合评价
                  </div>
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 8 }}>
                    {result.overall_feedback}
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>
                    优先修改
                  </div>
                  {result.top_fixes.map((fix, i) => (
                    <div key={i} style={{
                      color: 'var(--text-secondary)',
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
                    AI 味：{result.ai_like_rate}%
                  </Tag>
                </div>

                {result.language_drift_metrics && (
                  <div style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border-default)',
                    display: 'grid',
                    gap: 6,
                  }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      AI 味分解
                    </div>
                    {[...languageDriftLabels]
                      .map((item) => ({
                        ...item,
                        value: result.language_drift_metrics?.[item.key] ?? 0,
                      }))
                      .sort((left, right) => right.value - left.value)
                      .map((item) => (
                        <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 90, color: 'var(--text-secondary)' }}>{item.label}</span>
                          <Progress
                            percent={item.value}
                            size="small"
                            showInfo={false}
                            strokeColor="#fa8c16"
                            trailColor="var(--border-default)"
                            style={{ flex: 1, margin: 0 }}
                          />
                          <span style={{ width: 38, textAlign: 'right', color: '#fa8c16', fontWeight: 600 }}>
                            {item.value}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ),
          }]}
        />
      )}

      {/* 按检测结果修复区域 */}
      {result && onRegenerate && showRegen && (
        <div style={{
          marginTop: 8,
          padding: '10px 12px',
          background: 'rgba(46,134,171,0.06)',
          border: '1px solid rgba(46,134,171,0.2)',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
            按检测结果修复
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
            AI 会结合检测反馈（主要问题 + 各维度改进建议）对原内容进行局部修复，
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
              label="AI 修复·按检测改写"
              intent="repair"
              buildMessages={buildRegenMessages}
              runGeneration={customRunGeneration}
              drawCount={drawCount}
              isJson={!!buildCustomRegenMessages && customIsJson}
              disabled={disabled}
              onResult={content => {
                onRegenerate(content)
                setShowRegen(false)
                message.success(getUserFacingMessage('aiScore.optimizedApplied'))
              }}
              modelConfigId={modelConfigId}
              novelId={novelId}
              type="primary"
              size="small"
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {drawCount > 1 ? `将生成 ${drawCount} 个版本供选择` : '直接应用到内容'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
