import React, { useEffect, useState, useCallback } from 'react'
import {
  Form, Input, Button, Collapse, Select, Slider, message, Row, Col,
  Popover, Radio, Badge, Alert, Tooltip
} from 'antd'
import {
  SaveOutlined, SettingOutlined, PlusOutlined, DeleteOutlined,
  RobotOutlined, BulbOutlined
} from '@ant-design/icons'
import { useNovelStore } from '../../../stores/novel.store'
import { useAIDraftStore } from '../../../stores/aiDraft.store'
import AIGenerateButton from '../../../components/AIGenerateButton'
import AIScorePanel from '../../../components/AIScorePanel'
import { parseSections } from '../../../utils/text'
import type { AIScoreResult } from '../../../types'

interface Props { novelId: number }

interface SubPlot {
  name: string
  characters: string
  conflict: string
  mainlineLink: string
  endChapter: string
}

// AdvancedAI 配置（页面级状态）
interface AIConfig {
  drawCount: 1 | 2 | 3
  requirements: string
}

export default function CoreSettings({ novelId }: Props) {
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { saveDraft, getDraft, clearByPrefix } = useAIDraftStore()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [subPlots, setSubPlots] = useState<SubPlot[]>([])
  const [aiConfig, setAIConfig] = useState<AIConfig>({ drawCount: 1, requirements: '' })
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 检查是否有待填充的草稿
  const draftPrefix = `novel:${novelId}:coresettings`
  const hasDraft = useAIDraftStore(s => Object.keys(s.drafts).some(k => k.startsWith(draftPrefix)))

  const genreContext = currentNovel?.genreName || '未知题材'
  const novelBackground = currentNovel?.expandedBackground || currentNovel?.synopsis || ''

  useEffect(() => {
    if (currentNovel?.settingsJson) {
      try {
        const settings = JSON.parse(currentNovel.settingsJson)
        form.setFieldsValue(settings)
        if (settings.sub_plots_list) setSubPlots(settings.sub_plots_list)
      } catch {}
    }
  }, [currentNovel, form])

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = form.getFieldsValue()
      const data = { ...values, sub_plots_list: subPlots }
      await window.electron.novel.update(novelId, { settingsJson: JSON.stringify(data) })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      clearByPrefix(draftPrefix)
      message.success('已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  // AI扩展通用处理：填入字段并保存草稿
  const applyAndSaveDraft = (fieldName: string, value: string, label: string) => {
    form.setFieldValue(fieldName, value)
    saveDraft(`${draftPrefix}:${fieldName}`, value, label)
  }

  // 为各字段构建提示词消息
  const buildExpandMessages = useCallback((fieldName: string, label: string) => {
    const current = form.getFieldValue(fieldName) || ''
    const prompt = `你是专业的中文小说策划师。请对【${label}】进行专业扩充完善。

【小说背景】${novelBackground}
【题材】${genreContext}
【现有内容】${current || '（暂无，请根据背景生成合适内容）'}
${aiConfig.requirements ? `【额外要求】${aiConfig.requirements}` : ''}

扩充原则：
- 保留原有思路，在其基础上深化，不偏离主题
- 增加具体性：用细节代替泛泛而谈
- 独特性：避免老套路，有差异化创意
- 语言简洁有力，不写冗余废话

输出格式（严格遵守）：
- 直接输出纯文本内容，内容连贯，不要任何前言和解释
- 绝对禁止 **加粗**、## 标题、- 列表、> 引用等任何 Markdown 格式
- 禁止使用「字段名：」「**名称：**」等标签格式开头
- 段落间用空行分隔`

    return [{ role: 'user' as const, content: prompt }]
  }, [form, novelBackground, genreContext, aiConfig.requirements])

  // 支线 AI 完善
  const buildSubplotMessages = (index: number) => {
    const sub = subPlots[index]
    const mainPlot = form.getFieldValue('main_plot') || ''
    const prompt = `为小说完善一条支线剧情设定。

【主线概述】${mainPlot}
【题材】${genreContext}
【故事背景】${novelBackground}
【支线基础信息】
- 名称：${sub.name || '（未命名）'}
- 涉及人物：${sub.characters}
- 核心矛盾：${sub.conflict}
- 与主线关联：${sub.mainlineLink}
- 预计收束章节：第${sub.endChapter || 'X'}章
${aiConfig.requirements ? `【额外要求】${aiConfig.requirements}` : ''}

请生成完整支线设定：引爆点、发展节点（3~5个）、与主线交织方式、收束方式、角色成长。
避免套路，人物行为有动机，与主线形成对照或呼应。
直接输出完整支线设定，不要任何解释。`

    return [{ role: 'user' as const, content: prompt }]
  }

  const addSubPlot = () => {
    setSubPlots(prev => [...prev, { name: '', characters: '', conflict: '', mainlineLink: '', endChapter: '' }])
  }

  const updateSubPlot = (index: number, field: keyof SubPlot, value: string) => {
    setSubPlots(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const removeSubPlot = (index: number) => {
    setSubPlots(prev => prev.filter((_, i) => i !== index))
  }

  // 高级设置 Popover 内容
  const advancedSettingsContent = (
    <div style={{ width: 280 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          抽卡次数（生成 N 个版本供选择）
        </div>
        <Radio.Group
          value={aiConfig.drawCount}
          onChange={e => setAIConfig(c => ({ ...c, drawCount: e.target.value }))}
          size="small"
        >
          <Radio.Button value={1}>1 次</Radio.Button>
          <Radio.Button value={2}>2 次</Radio.Button>
          <Radio.Button value={3}>3 次</Radio.Button>
        </Radio.Group>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          全局生成要求（可选）
        </div>
        <Input.TextArea
          value={aiConfig.requirements}
          onChange={e => setAIConfig(c => ({ ...c, requirements: e.target.value }))}
          placeholder="例如：风格更黑暗、避免主角开挂、增加反转..."
          rows={3}
          style={{ fontSize: 12 }}
        />
      </div>
    </div>
  )

  const collapseItems = [
    {
      key: 'core',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
          <span style={{ fontWeight: 600 }}>故事核心</span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            各字段单独生成，内容独立完整
          </span>
        </div>
      ),
      children: (
        <>
          <Form.Item
            name="story_goal"
            label={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                故事核心目标
                <AIGenerateButton
                  label="AI"
                  size="small"
                  type="text"
                  buildMessages={() => buildExpandMessages('story_goal', '故事核心目标')}
                  drawCount={aiConfig.drawCount}
                  onResult={v => applyAndSaveDraft('story_goal', v, '故事核心目标')}
                />
              </span>
            }
          >
            <Input.TextArea rows={5} placeholder="主角最终要实现什么，故事的终极意义是什么" />
          </Form.Item>
          <Form.Item
            name="core_conflict"
            label={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                核心冲突
                <AIGenerateButton
                  label="AI"
                  size="small"
                  type="text"
                  buildMessages={() => buildExpandMessages('core_conflict', '核心冲突')}
                  drawCount={aiConfig.drawCount}
                  onResult={v => applyAndSaveDraft('core_conflict', v, '核心冲突')}
                />
              </span>
            }
          >
            <Input.TextArea rows={5} placeholder="推动整个故事前进的核心矛盾" />
          </Form.Item>
          <AIScorePanel
            getContent={() => {
              const v = form.getFieldsValue()
              return [v.story_goal, v.core_conflict].filter(Boolean).join('\n\n')
            }}
            contentType="故事核心"
            novelBackground={novelBackground}
            genreContext={genreContext}
            drawCount={aiConfig.drawCount}
            customIsJson={false}
            buildCustomRegenMessages={(content, result, extraReqs) => {
              const sorted = [...result.dimensions].sort((a, b) => a.score - b.score)
              const dimSuggestions = sorted.slice(0, 3)
                .filter(d => d.suggestion)
                .map(d => `${d.name}（${d.score}分）：${d.suggestion}`)
                .join('\n')
              const topFixes = result.top_fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')
              return [{
                role: 'user' as const,
                content: `请根据AI评分反馈，分别优化「故事核心目标」和「核心冲突」两个字段。

【当前内容】
${content}

【评分问题】${topFixes}
【改进方向】${dimSuggestions}
${extraReqs ? `【追加要求】${extraReqs}` : ''}

优化要求：
- 两个字段内容独立完整，主题聚焦，不拆分同一句话
- 禁止使用任何 Markdown 格式（** 加粗、## 标题、- 列表等）
- 直接输出纯文本，段落用空行分隔

严格按照以下格式输出（保留标记行，不要增删）：

【故事核心目标】
此处输出优化后的「故事核心目标」内容

【核心冲突】
此处输出优化后的「核心冲突」内容`,
              }]
            }}
            onRegenerate={v => {
              // 用标记解析，每个字段内容独立完整
              const sections = parseSections(v, '故事核心目标', '核心冲突')
              if (sections['故事核心目标']) {
                applyAndSaveDraft('story_goal', sections['故事核心目标'], '故事核心目标（优化版）')
              }
              if (sections['核心冲突']) {
                applyAndSaveDraft('core_conflict', sections['核心冲突'], '核心冲突（优化版）')
              }
              if (!sections['故事核心目标'] && !sections['核心冲突']) {
                // 回退：整体放入 story_goal
                applyAndSaveDraft('story_goal', v, '故事核心（优化版）')
              }
            }}
          />
        </>
      ),
    },
    {
      key: 'plot',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
          <span style={{ fontWeight: 600 }}>主线剧情</span>
          <AIGenerateButton
            label="AI 扩展"
            drawCount={aiConfig.drawCount}
            buildMessages={() => buildExpandMessages('main_plot', '主线剧情概述')}
            onResult={v => applyAndSaveDraft('main_plot', v, '主线剧情')}
          />
        </div>
      ),
      children: (
        <>
          <Form.Item name="main_plot" label="主线概述">
            <Input.TextArea rows={6} placeholder="描述故事主线的走向和关键事件" />
          </Form.Item>
          <AIScorePanel
            getContent={() => form.getFieldValue('main_plot') || ''}
            contentType="主线剧情"
            novelBackground={novelBackground}
            genreContext={genreContext}
            drawCount={aiConfig.drawCount}
            onRegenerate={v => applyAndSaveDraft('main_plot', v, '主线剧情（优化版）')}
          />
        </>
      ),
    },
    {
      key: 'subplot',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
          <span style={{ fontWeight: 600 }}>支线剧情 <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 12 }}>({subPlots.length}条)</span></span>
          <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
            <AIGenerateButton
              label="AI 生成支线"
              drawCount={aiConfig.drawCount}
              buildMessages={() => {
                const mainPlot = form.getFieldValue('main_plot') || ''
                const prompt = `为小说生成一条新的支线剧情框架。

【主线概述】${mainPlot}
【题材】${genreContext}
【背景】${novelBackground}
${aiConfig.requirements ? `【要求】${aiConfig.requirements}` : ''}
已有支线数量：${subPlots.length}条

请设计一条与主线形成对照的支线，输出JSON：
{"name":"支线名称","characters":"涉及人物（角色名，逗号分隔）","conflict":"核心矛盾（30字内）","mainlineLink":"与主线的关联方式（20字内）","endChapter":"预计收束章节（数字）"}`
                return [{ role: 'user' as const, content: prompt }]
              }}
              onResult={v => {
                try {
                  const parsed = JSON.parse(v.replace(/```json|```/g, '').trim())
                  setSubPlots(prev => [...prev, {
                    name: parsed.name || '',
                    characters: parsed.characters || '',
                    conflict: parsed.conflict || '',
                    mainlineLink: parsed.mainlineLink || '',
                    endChapter: String(parsed.endChapter || ''),
                  }])
                  message.success('支线框架已添加，可以继续AI完善')
                } catch {
                  message.error('AI 返回格式异常，请重试')
                }
              }}
            />
            <Button size="small" icon={<PlusOutlined />} onClick={e => { e.stopPropagation(); addSubPlot() }}>
              手动添加
            </Button>
          </div>
        </div>
      ),
      children: (
        <div>
          {subPlots.length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
              暂无支线，点击「AI 生成支线」或「手动添加」
            </div>
          ) : (
            subPlots.map((sub, index) => (
              <div
                key={index}
                style={{
                  background: 'var(--color-bg-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '12px',
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>
                    支线 {index + 1}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <AIGenerateButton
                      label="AI 完善"
                      size="small"
                      type="text"
                      drawCount={aiConfig.drawCount}
                      buildMessages={() => buildSubplotMessages(index)}
                      onResult={v => {
                        updateSubPlot(index, 'conflict', v)
                        saveDraft(`${draftPrefix}:subplot:${index}`, v, `支线${index + 1}完善内容`)
                        message.success('AI完善内容已填入「核心矛盾」字段，可继续手动调整')
                      }}
                    />
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeSubPlot(index)}
                    />
                  </div>
                </div>
                <Row gutter={12}>
                  <Col span={12}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 3 }}>支线名称</div>
                      <Input
                        size="small"
                        value={sub.name}
                        onChange={e => updateSubPlot(index, 'name', e.target.value)}
                        placeholder="例如：师门情仇、商战暗线"
                      />
                    </div>
                  </Col>
                  <Col span={12}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 3 }}>涉及人物</div>
                      <Input
                        size="small"
                        value={sub.characters}
                        onChange={e => updateSubPlot(index, 'characters', e.target.value)}
                        placeholder="角色名，逗号分隔"
                      />
                    </div>
                  </Col>
                  <Col span={24}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 3 }}>核心矛盾</div>
                      <Input.TextArea
                        size="small"
                        rows={4}
                        value={sub.conflict}
                        onChange={e => updateSubPlot(index, 'conflict', e.target.value)}
                        placeholder="这条支线的核心矛盾和目的"
                      />
                    </div>
                  </Col>
                  <Col span={16}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 3 }}>与主线关联</div>
                      <Input
                        size="small"
                        value={sub.mainlineLink}
                        onChange={e => updateSubPlot(index, 'mainlineLink', e.target.value)}
                        placeholder="如何与主线产生交集或呼应"
                      />
                    </div>
                  </Col>
                  <Col span={8}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 3 }}>预计收束章节</div>
                      <Input
                        size="small"
                        value={sub.endChapter}
                        onChange={e => updateSubPlot(index, 'endChapter', e.target.value)}
                        placeholder="第X章"
                      />
                    </div>
                  </Col>
                </Row>
                <AIScorePanel
                  getContent={() => [sub.name, sub.conflict, sub.mainlineLink].filter(Boolean).join('\n\n')}
                  contentType={`支线剧情（${sub.name || '未命名'}）`}
                  novelBackground={novelBackground}
                  genreContext={genreContext}
                  drawCount={aiConfig.drawCount}
                  onRegenerate={v => {
                    updateSubPlot(index, 'conflict', v)
                    saveDraft(`${draftPrefix}:subplot:${index}:optimized`, v, `支线${index + 1}优化内容`)
                    message.info('优化内容已填入「核心矛盾」字段')
                  }}
                />
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      key: 'rhythm',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
          <span style={{ fontWeight: 600 }}>叙事节奏</span>
          <Tooltip title="三段比例建议合计100%，可以不严格">
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>比例参考</span>
          </Tooltip>
        </div>
      ),
      children: (
        <div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 16 }}>
            三段节奏比例（仅为参考，合计约100%）
          </div>
          <Row gutter={24}>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>前期铺垫</div>
              <Form.Item name="rhythm_setup" initialValue={30} noStyle>
                <Slider min={10} max={60} step={5} marks={{ 10: '10%', 30: '30%', 60: '60%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>中期冲突</div>
              <Form.Item name="rhythm_conflict" initialValue={50} noStyle>
                <Slider min={20} max={70} step={5} marks={{ 20: '20%', 50: '50%', 70: '70%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>后期收束</div>
              <Form.Item name="rhythm_ending" initialValue={20} noStyle>
                <Slider min={5} max={40} step={5} marks={{ 5: '5%', 20: '20%', 40: '40%' }} />
              </Form.Item>
            </Col>
          </Row>
        </div>
      ),
    },
    {
      key: 'ending',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
          <span style={{ fontWeight: 600 }}>结局设定</span>
          <AIGenerateButton
            label="AI 扩展"
            drawCount={aiConfig.drawCount}
            buildMessages={() => buildExpandMessages('ending', '结局内容')}
            onResult={v => applyAndSaveDraft('ending', v, '结局设定')}
          />
        </div>
      ),
      children: (
        <>
          <Form.Item name="ending_type" label="结局类型">
            <Select options={[
              { value: 'HE', label: '圆满结局（HE）' },
              { value: 'BE', label: '悲剧结局（BE）' },
              { value: 'open', label: '开放式结局' },
              { value: 'multi', label: '多结局' },
              { value: 'HE_BE', label: '主CP圆满，部分角色悲剧' },
            ]} />
          </Form.Item>
          <Form.Item
            name="ending"
            label={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                结局内容
                <AIGenerateButton
                  label="AI"
                  size="small"
                  type="text"
                  buildMessages={() => buildExpandMessages('ending', '故事结局内容')}
                  drawCount={aiConfig.drawCount}
                  onResult={v => applyAndSaveDraft('ending', v, '结局内容')}
                />
              </span>
            }
          >
            <Input.TextArea rows={5} placeholder="故事如何结束，主要矛盾如何收束" />
          </Form.Item>
          <AIScorePanel
            getContent={() => form.getFieldValue('ending') || ''}
            contentType="结局设定"
            novelBackground={novelBackground}
            genreContext={genreContext}
            drawCount={aiConfig.drawCount}
            onRegenerate={v => applyAndSaveDraft('ending', v, '结局设定（优化版）')}
          />
        </>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: 'var(--color-text-primary)', margin: 0 }}>核心设定</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* 高级设置 */}
          <Popover
            title={<span style={{ fontSize: 13 }}>AI 高级设置</span>}
            content={advancedSettingsContent}
            trigger="click"
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            placement="bottomRight"
          >
            <Badge dot={aiConfig.drawCount > 1 || !!aiConfig.requirements} color="var(--color-blue-primary)">
              <Button icon={<SettingOutlined />} size="small">
                高级设置{aiConfig.drawCount > 1 ? ` (抽卡×${aiConfig.drawCount})` : ''}
              </Button>
            </Badge>
          </Popover>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
            保存设定
          </Button>
        </div>
      </div>

      {/* 有未保存草稿提示 */}
      {hasDraft && (
        <Alert
          type="info"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message="有 AI 生成的内容已填入表单，记得点击「保存设定」"
          action={
            <Button size="small" onClick={() => clearByPrefix(draftPrefix)}>
              清除草稿
            </Button>
          }
        />
      )}

      <Form form={form} layout="vertical">
        <Collapse
          items={collapseItems}
          defaultActiveKey={['core', 'plot', 'subplot', 'rhythm', 'ending']}
          style={{ background: 'transparent' }}
        />
      </Form>
    </div>
  )
}
