import React, { useEffect, useState } from 'react'
import { Form, Input, Button, Tabs, message, Alert } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { useNovelStore } from '../../../stores/novel.store'

interface Props { novelId: number }

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

export default function WorldRules({ novelId }: Props) {
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [tokenCount, setTokenCount] = useState(0)

  useEffect(() => {
    if (currentNovel?.worldRulesJson) {
      try {
        const rules = JSON.parse(currentNovel.worldRulesJson)
        form.setFieldsValue(rules)
        updateTokenCount(rules)
      } catch {}
    }
  }, [currentNovel, form])

  const updateTokenCount = (values: Record<string, string>) => {
    const text = Object.values(values).filter(Boolean).join(' ')
    setTokenCount(estimateTokens(text))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = form.getFieldsValue()
      await window.electron.novel.update(novelId, { worldRulesJson: JSON.stringify(values) })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      updateTokenCount(values)
      message.success('世界规则已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const tabItems = [
    {
      key: 'basic',
      label: '世界基础',
      children: (
        <>
          <Form.Item name="time_period" label="时代背景">
            <Input placeholder="例如：架空古代、近未来2077年、修仙世界灵气复苏后第500年" />
          </Form.Item>
          <Form.Item name="geography" label="地理概貌">
            <Input.TextArea rows={5} placeholder="世界的地理格局，主要区域划分" />
          </Form.Item>
          <Form.Item name="social_structure" label="社会结构">
            <Input.TextArea rows={5} placeholder="政治体制、阶层划分、权力结构" />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'power',
      label: '力量/科技体系',
      children: (
        <>
          <Form.Item name="power_system_name" label="体系名称">
            <Input placeholder="例如：修仙境界、魔法等级、科技等级" />
          </Form.Item>
          <Form.Item name="power_levels" label="等级划分">
            <Input.TextArea rows={5} placeholder="从低到高列出各个等级，以换行或逗号分隔" />
          </Form.Item>
          <Form.Item name="power_rules" label="体系规则">
            <Input.TextArea rows={5} placeholder="力量的运作规则、限制、获取方式" />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'rules',
      label: '规则与禁忌',
      children: (
        <>
          <Form.Item name="logic_constraints" label="逻辑约束（必须遵守）">
            <Input.TextArea rows={5} placeholder="在这个世界中必须符合的逻辑规律，例如：法术消耗精神力，耗尽会昏迷" />
          </Form.Item>
          <Form.Item name="forbidden_elements" label="禁止元素">
            <Input.TextArea rows={5} placeholder="不应出现的内容，例如：现代科技词汇、枪炮、网络" />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'language',
      label: '语言称谓',
      children: (
        <>
          <Form.Item name="honorifics" label="阶层称谓">
            <Input.TextArea rows={5} placeholder="不同阶层之间如何称呼，例如：陛下、殿下、大人、道友" />
          </Form.Item>
          <Form.Item name="special_terms" label="特殊词汇">
            <Input.TextArea rows={5} placeholder="这个世界特有的词汇，例如：灵根、丹田、法力" />
          </Form.Item>
        </>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: 'var(--color-text-primary)', margin: 0 }}>世界规则</h2>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
          保存规则
        </Button>
      </div>

      {tokenCount > 800 && (
        <Alert
          type="warning"
          message={`当前世界规则预估占用 ${tokenCount} token，较多可能影响上下文空间，建议精简`}
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}
      {tokenCount > 0 && tokenCount <= 800 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 16 }}>
          预估 Token 占用：{tokenCount}（建议控制在 800 以内）
        </div>
      )}

      <Form form={form} layout="vertical" onValuesChange={(_, all) => updateTokenCount(all)}>
        <Tabs items={tabItems} />
      </Form>
    </div>
  )
}
