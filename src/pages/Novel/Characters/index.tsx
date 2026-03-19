import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  DeleteOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import type { Character, CharacterRelation, StoryItem } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getCharacterBatchPreset } from '../../../shared/creation-tools'
import {
  getFactionNameOptions,
  getPowerSystemNameOptions,
  getSpeciesNameOptions,
  parseWorldRulesJson,
} from '../../../shared/genre-system'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceTip,
} from '../components/WorkspaceShell'

interface Props {
  novelId: number
}

interface CharacterFormValues {
  roleType: 'protagonist' | 'major' | 'minor' | 'antagonist' | 'supporting'
  entityType?: string
  species?: string
  fullName: string
  gender?: string
  age?: number
  occupation?: string
  rankLevel?: string
  socialIdentity?: string
  background?: string
  campFactions: string[]
  powerSystems: string[]
  contextHooks: string[]
  goals?: string
  firstImpression?: string
  innerConflict?: string
  relationshipTension?: string
  resonancePoint?: string
  characterArc?: string
  appearance?: string
}

interface CharacterBatchFormValues {
  majorCount: number
  minorCount: number
  antagonistCount: number
  supportingCount: number
  genderRatio?: string
  preferredSpecies: string[]
  factionBias: string[]
  helperRoles: string[]
  batchSize: number
  specialRequirements?: string
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
        .map((item) => (typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : Number.NaN))
        .filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

function parseAppearance(raw?: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && typeof parsed.description === 'string'
      ? parsed.description
      : ''
  } catch {
    return ''
  }
}

function toFormValues(character: Character): CharacterFormValues {
  return {
    roleType: character.roleType,
    entityType: character.entityType || '',
    species: character.species || '',
    fullName: character.fullName,
    gender: character.gender || '',
    age: character.age,
    occupation: character.occupation || '',
    rankLevel: character.rankLevel || '',
    socialIdentity: character.socialIdentity || '',
    background: character.background || '',
    campFactions: parseStringArray(character.campFactionIdsJson),
    powerSystems: parseStringArray(character.powerSystemRefsJson),
    contextHooks: parseStringArray(character.contextHooksJson),
    goals: character.goals || '',
    firstImpression: character.firstImpression || '',
    innerConflict: character.innerConflict || '',
    relationshipTension: character.relationshipTension || '',
    resonancePoint: character.resonancePoint || '',
    characterArc: character.characterArc || '',
    appearance: parseAppearance(character.appearanceJson),
  }
}

function serialize(values: CharacterFormValues): Partial<Character> {
  return {
    roleType: values.roleType,
    entityType: values.entityType?.trim() || '',
    species: values.species?.trim() || '',
    fullName: values.fullName.trim(),
    gender: values.gender?.trim() || '',
    age: values.age,
    occupation: values.occupation?.trim() || '',
    rankLevel: values.rankLevel?.trim() || '',
    socialIdentity: values.socialIdentity?.trim() || '',
    background: values.background?.trim() || '',
    campFactionIdsJson: JSON.stringify(values.campFactions || []),
    powerSystemRefsJson: JSON.stringify(values.powerSystems || []),
    contextHooksJson: JSON.stringify(values.contextHooks || []),
    goals: values.goals?.trim() || '',
    firstImpression: values.firstImpression?.trim() || '',
    innerConflict: values.innerConflict?.trim() || '',
    relationshipTension: values.relationshipTension?.trim() || '',
    resonancePoint: values.resonancePoint?.trim() || '',
    characterArc: values.characterArc?.trim() || '',
    appearanceJson: JSON.stringify({ description: values.appearance?.trim() || '' }),
  }
}

const ROLE_META: Record<Character['roleType'], { label: string; color: string }> = {
  protagonist: { label: '主角', color: 'gold' },
  major: { label: '主要人物', color: 'blue' },
  minor: { label: '次要人物', color: 'default' },
  antagonist: { label: '反派', color: 'red' },
  supporting: { label: '功能角色', color: 'purple' },
}

const ROLE_OPTIONS = [
  { value: 'protagonist', label: '主角' },
  { value: 'major', label: '主要人物' },
  { value: 'antagonist', label: '反派' },
  { value: 'supporting', label: '功能角色' },
  { value: 'minor', label: '次要人物' },
] as const

const ENTITY_TYPE_OPTIONS = [
  { value: 'human', label: '人类' },
  { value: 'undead', label: '丧尸 / 亡灵' },
  { value: 'beast', label: '兽类 / 灵兽' },
  { value: 'immortal', label: '仙 / 神性存在' },
  { value: 'nonhuman', label: '非人智慧体' },
]

export default function CharactersPage({ novelId }: Props) {
  const { currentNovel, setCharacters } = useNovelStore()
  const [form] = Form.useForm<CharacterFormValues>()
  const [batchForm] = Form.useForm<CharacterBatchFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [characters, setCharacterRows] = useState<Character[]>([])
  const [relations, setRelations] = useState<CharacterRelation[]>([])
  const [items, setItems] = useState<StoryItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [speciesFilter, setSpeciesFilter] = useState<string>('all')

  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )

  const speciesOptions = useMemo(() => getSpeciesNameOptions(worldRules), [worldRules])
  const factionOptions = useMemo(() => getFactionNameOptions(worldRules), [worldRules])
  const powerSystemOptions = useMemo(() => getPowerSystemNameOptions(worldRules), [worldRules])
  const batchPreset = useMemo(
    () => getCharacterBatchPreset(currentNovel?.genreName, speciesOptions),
    [currentNovel?.genreName, speciesOptions],
  )

  const loadData = useCallback(async (preferredId?: number | null) => {
    setLoading(true)
    try {
      const [characterList, relationList, itemList] = await Promise.all([
        window.electron.character.list(novelId),
        window.electron.character.getRelations(novelId),
        window.electron.item.list(novelId),
      ])

      setCharacters(characterList)
      setCharacterRows(characterList)
      setRelations(relationList)
      setItems(itemList)

      const nextSelectedId = preferredId ?? characterList[0]?.id ?? null
      const selected = characterList.find((item) => item.id === nextSelectedId)

      if (selected) {
        setSelectedId(selected.id)
        setCreating(false)
        form.setFieldsValue(toFormValues(selected))
      } else {
        setSelectedId(null)
        setCreating(false)
        form.resetFields()
      }
    } finally {
      setLoading(false)
    }
  }, [form, novelId, setCharacters])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    batchForm.setFieldsValue({
      majorCount: batchPreset.majorCount,
      minorCount: batchPreset.minorCount,
      antagonistCount: batchPreset.antagonistCount,
      supportingCount: batchPreset.supportingCount,
      genderRatio: batchPreset.genderRatio,
      preferredSpecies: batchPreset.preferredSpecies,
      helperRoles: batchPreset.helperRoles,
      factionBias: factionOptions.slice(0, 3),
      batchSize: 6,
      specialRequirements: '',
    })
  }, [batchForm, batchPreset, factionOptions])

  const allSpecies = useMemo(() => Array.from(new Set([
    ...speciesOptions,
    ...batchPreset.preferredSpecies,
    ...characters.map((item) => item.species || '').filter(Boolean),
  ])), [batchPreset.preferredSpecies, characters, speciesOptions])

  const filteredCharacters = useMemo(() => characters.filter((character) => {
    if (roleFilter !== 'all' && character.roleType !== roleFilter) return false
    if (speciesFilter !== 'all' && character.species !== speciesFilter) return false
    return true
  }), [characters, roleFilter, speciesFilter])

  const selectedCharacter = characters.find((item) => item.id === selectedId) || null
  const relatedItems = selectedCharacter
    ? items.filter((item) => (
      item.itemKind === 'instance'
      && (item.ownerCharacterId === selectedCharacter.id || parseNumberArray(item.linkedCharacterIdsJson).includes(selectedCharacter.id))
    ))
    : []
  const relatedRelations = selectedCharacter
    ? relations.filter((item) => item.charAId === selectedCharacter.id || item.charBId === selectedCharacter.id)
    : []

  const selectedEntityLabel = selectedCharacter?.entityType
    ? ENTITY_TYPE_OPTIONS.find((item) => item.value === selectedCharacter.entityType)?.label || selectedCharacter.entityType
    : '未设定'

  const ecologyPreview = worldRules.characterEcology.slots.slice(0, 4)
  const recommendedBatchCount = batchPreset.majorCount
    + batchPreset.antagonistCount
    + batchPreset.supportingCount
    + batchPreset.minorCount
  const selectedRoleMeta = selectedCharacter ? ROLE_META[selectedCharacter.roleType] : null
  const selectedFactionNames = selectedCharacter ? parseStringArray(selectedCharacter.campFactionIdsJson) : []
  const selectedPowerSystemNames = selectedCharacter ? parseStringArray(selectedCharacter.powerSystemRefsJson) : []
  const selectedContextBindingCount = selectedFactionNames.length + selectedPowerSystemNames.length
  const selectedCharacterLead = selectedCharacter
    ? selectedCharacter.innerConflict || selectedCharacter.goals || selectedCharacter.firstImpression || selectedCharacter.background || '先补这个角色眼下最强的目标和拉扯。'
    : creating
      ? '新人物先定身份、当前目标和与主线的挂点，后面再补细节。'
      : '左侧选人后，这里会显示能直接服务写作的人物档案。'
  const rosterNextLabel = selectedCharacter
    ? '继续细修当前人物'
    : creating
      ? '先把骨架补齐'
      : filteredCharacters.length > 0
        ? '先选中一个角色'
        : '先铺第一版人物网'
  const recommendedNextAction = selectedCharacter
    ? selectedCharacter.goals?.trim()
      ? '右侧继续补关系张力和后续弧光，让这个人真正挂到主线上。'
      : '先把当前目标和内在拉扯写清，再扩展关系链。'
    : creating
      ? '先定身份、当前目标和与主线的挂点。'
      : filteredCharacters.length > 0
        ? '先在左侧选中一个角色，再补可写档案。'
        : '先批量生成一版人物网络，再逐个细修。'
  const editorTagValues = [
    selectedRoleMeta?.label,
    selectedEntityLabel !== '未设定' ? selectedEntityLabel : '',
    selectedCharacter?.species || '',
    selectedCharacter?.occupation || '',
    selectedFactionNames[0] || '',
  ].filter(Boolean)


  const handleSelect = (character: Character) => {
    setSelectedId(character.id)
    setCreating(false)
    form.setFieldsValue(toFormValues(character))
  }

  const handleNew = () => {
    setCreating(true)
    setSelectedId(null)
    form.setFieldsValue({
      roleType: 'major',
      entityType: '',
      species: '',
      fullName: '',
      gender: '',
      age: undefined,
      occupation: '',
      rankLevel: '',
      socialIdentity: '',
      background: '',
      campFactions: [],
      powerSystems: [],
      contextHooks: [],
      goals: '',
      firstImpression: '',
      innerConflict: '',
      relationshipTension: '',
      resonancePoint: '',
      characterArc: '',
      appearance: '',
    })
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (selectedCharacter?.id) {
        await window.electron.character.update(selectedCharacter.id, serialize(values))
        await loadData(selectedCharacter.id)
      } else {
        const nextId = await window.electron.character.create(novelId, serialize(values))
        await loadData(nextId)
      }
      setCreating(false)
      message.success('人物档案已保存。')
    } catch (error) {
      console.error(error)
      message.error('保存失败，请稍后再试。')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedCharacter?.id) return
    Modal.confirm({
      title: `删除「${selectedCharacter.fullName}」？`,
      content: '删除人物后，不会自动回收时间轴和物品里的文字描述，请确认这不是仍在使用的角色。',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electron.character.delete(selectedCharacter.id)
        await loadData()
        message.success('人物已删除。')
      },
    })
  }

  const handleGenerateProtagonist = async () => {
    setGenerating(true)
    try {
      await window.electron.character.generateProtagonist(novelId, {})
      await loadData()
      message.success('主角首版已生成。')
    } catch (error) {
      console.error(error)
      message.error('主角生成失败。')
    } finally {
      setGenerating(false)
    }
  }

  const handleBatchGenerate = async () => {
    const values = batchForm.getFieldsValue()
    setGenerating(true)
    try {
      await window.electron.character.batchGenerate(novelId, values)
      setBatchOpen(false)
      await loadData()
      message.success('人物首轮批量生成完成。')
    } catch (error) {
      console.error(error)
      message.error('批量生成失败。')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateRelations = async () => {
    setGenerating(true)
    try {
      await window.electron.character.generateRelations(novelId)
      await loadData(selectedId)
      message.success('人物关系已补齐首版。')
    } catch (error) {
      console.error(error)
      message.error('关系生成失败。')
    } finally {
      setGenerating(false)
    }
  }

  const handleClear = async () => {
    Modal.confirm({
      title: '清空人物系统？',
      content: '会删除当前小说下全部人物档案与关系数据，此操作不可撤销。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        await window.electron.character.clear(novelId)
        form.resetFields()
        setSelectedId(null)
        setCreating(false)
        await loadData(null)
        message.success('人物系统已清空')
      },
    })
  }

  return (
    <WorkspacePage
      className="novel-characters-page"
      layout="wide"
      eyebrow="人物系统"
      title="人物系统"
      description="先定清人物配额、实体类型和种族口径，再让角色自动继承题材、势力、地图和物品上下文。这里留下来的字段，只保留后续写作会反复回查的那部分。"
      actions={(
        <div className="novel-characters__hero-actions">
          <div className="novel-characters__hero-actions-group novel-characters__hero-actions-group--primary">
            <Button type="primary" icon={<TeamOutlined />} loading={generating} onClick={() => setBatchOpen(true)}>
              AI 批量生成
            </Button>
            <Button icon={<RobotOutlined />} loading={generating} onClick={handleGenerateProtagonist}>
              AI 补主角
            </Button>
            <Button icon={<ApartmentOutlined />} loading={generating} onClick={handleGenerateRelations}>
              AI 生成关系
            </Button>
          </div>
          <div className="novel-characters__hero-actions-group">
            <Button icon={<UserAddOutlined />} onClick={handleNew}>
              新建人物
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => loadData()}>
              刷新
            </Button>
            <Button danger icon={<DeleteOutlined />} loading={generating} onClick={() => void handleClear()}>
              清空人物
            </Button>
          </div>
        </div>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '人物生态位', value: `${worldRules.characterEcology.slots.length} 个推荐槽位` },
            { label: '势力 / 体系', value: `${factionOptions.length} 个势力 / ${powerSystemOptions.length} 套体系` },
            {
              label: '当前焦点',
              value: selectedCharacter
                ? `${selectedCharacter.fullName} · ${selectedEntityLabel}`
                : '先选一个角色，或批量生成一版人物网',
            },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric
            label="总人物数"
            value={characters.length}
            tone="warm"
            hint={`${filteredCharacters.length} 人符合当前筛选`}
          />
          <WorkspaceMetric
            label="已识别种族"
            value={allSpecies.length}
            hint="来自世界规则与现有人物"
          />
          <WorkspaceMetric
            label="已识别势力"
            value={factionOptions.length}
            tone="cool"
            hint="批量生成时会作为阵营偏好"
          />
          <WorkspaceMetric
            label="推荐首轮配额"
            value={recommendedBatchCount}
            hint="按当前题材预设的人物网络规模"
          />
        </>
      )}
      aside={(
        <>

          <WorkspacePanel title="当前题材的人物生态" description={worldRules.characterEcology.overview}>
            <div className="novel-note-list">
              {ecologyPreview.map((slot) => (
                <div key={slot.id} className="novel-note-list__item">
                  <div className="novel-kicker">{slot.label}</div>
                  <div>{slot.contextLink || slot.narrativeFunction || '这一槽位建议和主线冲突直接关联。'}</div>
                </div>
              ))}
            </div>
          </WorkspacePanel>
        </>
      )}
    >
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          title="人物列表"
          description="左侧先完成筛选和选人，右侧再把真正会进入剧情的人物档案补扎实。"
          extra={(
            <div className="novel-filter-bar">
              <div className="novel-filter-bar__row">
                <Select
                  value={roleFilter}
                  options={[{ value: 'all', label: '全部角色' }, ...ROLE_OPTIONS]}
                  onChange={setRoleFilter}
                />
                <Select
                  value={speciesFilter}
                  options={[
                    { value: 'all', label: '全部种族' },
                    ...allSpecies.map((item) => ({ value: item, label: item })),
                  ]}
                  onChange={setSpeciesFilter}
                />
              </div>
              <div className="novel-filter-bar__summary">
                当前筛出 {filteredCharacters.length} 人。先让主角、反派和功能位形成可写关系链，再补次要人物。
              </div>
            </div>
          )}
        >
          <div className="novel-characters__roster-summary">
            <div className="novel-characters__roster-card">
              <span>当前列表</span>
              <strong>{filteredCharacters.length} 人</strong>
              <small>筛选只负责聚焦，不改变原始人物网络。</small>
            </div>
            <div className="novel-characters__roster-card">
              <span>当前焦点</span>
              <strong>{selectedCharacter ? selectedCharacter.fullName : creating ? '新建人物' : '未选中人物'}</strong>
              <small>{selectedCharacter ? '右侧继续补目标、关系和弧光。' : '先选一个角色，或新建一位。'}</small>
            </div>
            <div className="novel-characters__roster-card novel-characters__roster-card--accent">
              <span>下一步</span>
              <strong>{rosterNextLabel}</strong>
              <small>{recommendedNextAction}</small>
            </div>
          </div>

          {loading ? (
            <div className="novel-empty"><Spin /></div>
          ) : filteredCharacters.length === 0 ? (
            <div className="novel-empty">
              当前筛选下还没有人物。可以放宽筛选，或直接用上方「批量生成」先铺出第一版人物网络。
            </div>
          ) : (
            <div className="novel-grid">
              {filteredCharacters.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  className={`novel-list-card ${selectedId === character.id ? 'novel-list-card--active' : ''}`}
                  onClick={() => handleSelect(character)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className="novel-list-card__title">{character.fullName}</div>
                  <div className="novel-list-card__meta">
                    <Tag color={ROLE_META[character.roleType].color}>{ROLE_META[character.roleType].label}</Tag>
                    {character.species ? <Tag>{character.species}</Tag> : null}
                    {character.rankLevel ? <Tag color="blue">{character.rankLevel}</Tag> : null}
                  </div>
                  <div className="novel-list-card__desc">
                    {character.innerConflict || character.goals || character.firstImpression || character.background || '这个角色还没有补出核心矛盾。'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel
          title={selectedCharacter ? `编辑：${selectedCharacter.fullName}` : creating ? '新建人物' : '人物档案'}
          description="先写清身份和当前动机，再补人物与主线、势力和关系网的绑定。右侧只保留后续写戏会反复调用的字段。"
          extra={(
            <Space>
              {selectedCharacter ? (
                <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
                  删除
                </Button>
              ) : null}
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                保存
              </Button>
            </Space>
          )}
        >
          {!selectedCharacter && !creating && !loading ? (
            <div className="novel-empty">
              左侧选中一个人物后，这里会显示它的写作档案。也可以直接新建，从身份与动机开始补。
            </div>
          ) : (
            <>
              <div className="novel-characters__editor-intro">
                <div className="novel-characters__editor-intro-copy">
                  <div className="novel-kicker">{selectedCharacter ? '当前人物' : '新建档案'}</div>
                  <strong>{selectedCharacter ? selectedCharacter.fullName : '从身份与动机开始补'}</strong>
                  <span>{selectedCharacterLead}</span>
                  {editorTagValues.length > 0 ? (
                    <div className="novel-characters__editor-tags">
                      {editorTagValues.map((item) => (
                        <Tag key={item} bordered={false}>
                          {item}
                        </Tag>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="novel-characters__editor-stats">
                  <div>
                    <label>角色定位</label>
                    <strong>{selectedRoleMeta?.label || '待定'}</strong>
                  </div>
                  <div>
                    <label>关系挂点</label>
                    <strong>{selectedCharacter ? relatedRelations.length : 0}</strong>
                  </div>
                  <div>
                    <label>阵营 / 体系</label>
                    <strong>{selectedCharacter ? selectedContextBindingCount : 0}</strong>
                  </div>
                </div>
              </div>

              <Form form={form} layout="vertical">
                <div className="novel-form-section">
                  <div className="novel-form-section__header">
                    <div className="novel-form-section__title">角色身份</div>
                    <div className="novel-form-section__desc">先确定他是什么角色、属于哪类存在、在世界里站在哪个位置。</div>
                  </div>
                  <div className="novel-grid novel-grid--3">
                    <Form.Item name="roleType" label="角色类型" rules={[{ required: true, message: '请选择角色类型' }]}>
                      <Select options={ROLE_OPTIONS as unknown as Array<{ value: CharacterFormValues['roleType']; label: string }>} />
                    </Form.Item>
                    <Form.Item name="entityType" label="实体类型">
                      <Select allowClear options={ENTITY_TYPE_OPTIONS} />
                    </Form.Item>
                    <Form.Item name="species" label="种族 / 物种">
                      <Select
                        showSearch
                        allowClear
                        options={allSpecies.map((item) => ({ value: item, label: item }))}
                      />
                    </Form.Item>
                  </div>
                  <div className="novel-grid novel-grid--3">
                    <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                      <Input placeholder="尽量写正常、可读的人名，不要堆设定词。" />
                    </Form.Item>
                    <Form.Item name="gender" label="性别">
                      <Input placeholder="例如：男 / 女 / 不限" />
                    </Form.Item>
                    <Form.Item name="age" label="年龄">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </div>
                  <div className="novel-grid novel-grid--3">
                    <Form.Item name="occupation" label="职业 / 身份">
                      <Input placeholder="例如：外勤调查员、宗门执事、基地医生" />
                    </Form.Item>
                    <Form.Item name="rankLevel" label="等级 / 境界 / 职级">
                      <Input placeholder="只写当前真正影响他行动权限的层级。" />
                    </Form.Item>
                    <Form.Item name="socialIdentity" label="社会位置">
                      <Input placeholder="例如：边缘成员、继承人、流亡者" />
                    </Form.Item>
                  </div>
                </div>

                <div className="novel-form-section">
                  <div className="novel-form-section__header">
                    <div className="novel-form-section__title">阵营与上下文</div>
                    <div className="novel-form-section__desc">人物不要悬空存在，最好和势力、力量体系、主线挂点一起落下去。</div>
                  </div>
                  <div className="novel-grid novel-grid--2">
                    <Form.Item name="campFactions" label="所属势力">
                      <Select
                        mode="tags"
                        allowClear
                        options={factionOptions.map((item) => ({ value: item, label: item }))}
                      />
                    </Form.Item>
                    <Form.Item name="powerSystems" label="关联力量体系">
                      <Select
                        mode="tags"
                        allowClear
                        options={powerSystemOptions.map((item) => ({ value: item, label: item }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item name="contextHooks" label="和主线的关联挂点">
                    <Select
                      mode="tags"
                      allowClear
                      placeholder="例如：掌握补给线、知道旧案真相、和关键势力绑定"
                    />
                  </Form.Item>
                  <Form.Item name="background" label="背景经历">
                    <Input.TextArea
                      rows={5}
                      placeholder="只写会影响当前判断和选择的经历。背景不是传记，而是写作时要反复调用的前史。"
                    />
                  </Form.Item>
                </div>

                <div className="novel-form-section">
                  <div className="novel-form-section__header">
                    <div className="novel-form-section__title">动机与张力</div>
                    <div className="novel-form-section__desc">先搞清他想要什么、被什么卡住，人物才会站得住。</div>
                  </div>
                  <div className="novel-grid novel-grid--2">
                    <Form.Item name="goals" label="当前目标">
                      <Input.TextArea rows={4} placeholder="写眼下最直接的诉求，不要写成空泛口号。" />
                    </Form.Item>
                    <Form.Item name="firstImpression" label="第一印象">
                      <Input.TextArea rows={4} placeholder="第一次出场时，读者最容易记住他什么。" />
                    </Form.Item>
                  </div>
                  <div className="novel-grid novel-grid--2">
                    <Form.Item name="innerConflict" label="内在矛盾">
                      <Input.TextArea rows={4} placeholder="写他明知道该怎么做，却做不到的地方。" />
                    </Form.Item>
                    <Form.Item name="relationshipTension" label="关系张力">
                      <Input.TextArea rows={4} placeholder="写他和谁最容易拉扯、对立或彼此拖累。" />
                    </Form.Item>
                  </div>
                </div>

                <div className="novel-form-section">
                  <div className="novel-form-section__header">
                    <div className="novel-form-section__title">可见特征与后续弧光</div>
                    <div className="novel-form-section__desc">让人物既有辨识度，也有后续变化空间。</div>
                  </div>
                  <div className="novel-grid novel-grid--2">
                    <Form.Item name="resonancePoint" label="读者共情点">
                      <Input.TextArea rows={4} placeholder="写读者最容易理解、心疼或认同他的地方。" />
                    </Form.Item>
                    <Form.Item name="characterArc" label="后续弧光">
                      <Input.TextArea rows={4} placeholder="写这个角色会朝哪个方向变化，不必一口气写满。" />
                    </Form.Item>
                  </div>
                  <Form.Item name="appearance" label="可识别外观">
                    <Input.TextArea rows={4} placeholder="只写辨识度，不要堆满形容词。" />
                  </Form.Item>
                </div>
              </Form>

              {selectedCharacter ? (
                <div className="novel-support-grid" style={{ marginTop: 20 }}>
                  <WorkspaceTip title="相关物品">
                    {relatedItems.length === 0 ? (
                      <div>这个人物还没有绑定关键物品，可以去物品页补上。</div>
                    ) : relatedItems.map((item) => (
                      <div key={item.id}>
                        {item.itemName}
                        {item.category ? ` · ${item.category}` : ''}
                      </div>
                    ))}
                  </WorkspaceTip>
                  <WorkspaceTip title="相关关系">
                    {relatedRelations.length === 0 ? (
                      <div>这个人物还没有关系链，可以点上方「生成关系」先补一版。</div>
                    ) : relatedRelations.map((relation) => {
                      const otherId = relation.charAId === selectedCharacter.id ? relation.charBId : relation.charAId
                      const other = characters.find((item) => item.id === otherId)
                      return (
                        <div key={relation.id}>
                          {other?.fullName || '未知人物'} · {relation.relationLabel || relation.relationType || '关系待补充'}
                        </div>
                      )
                    })}
                  </WorkspaceTip>
                </div>
              ) : null}
            </>
          )}
        </WorkspacePanel>
      </div>

      <Modal
        title="批量生成人物"
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={handleBatchGenerate}
        confirmLoading={generating}
        okText="开始生成"
      >
        <Form form={batchForm} layout="vertical">
          <div className="novel-characters__batch-intro">
            <div className="novel-kicker">首轮人物网络</div>
            <div className="novel-characters__batch-intro-copy">先把功能位、阵营来源和人物关系入口铺开，再回到单人档案细修。这里先定结构，不在这一步把每个人写死。</div>
          </div>

          <div className="novel-note-list novel-characters__batch-notes" style={{ marginBottom: 16 }}>
            <div className="novel-note-list__item">这一轮会按你填写的配额补齐主要人物、次要人物、反派和功能角色；如果主角缺失，建议先单独补主角。</div>
            <div className="novel-note-list__item">种族、实体和势力偏好只负责定方向，先保证题材生态和人物功能完整。</div>
            <div className="novel-note-list__item">其余细节统一回到右侧单人档案补，不要试图在批量步骤里把人物一次写满。</div>
          </div>

          <div className="novel-characters__batch-section">
            <div className="novel-characters__batch-section-title">角色配额</div>
            <div className="novel-grid novel-grid--2">
            <Form.Item name="majorCount" label="主要人物数量">
              <Select options={[2, 3, 4, 5, 6].map((value) => ({ value, label: `${value} 人` }))} />
            </Form.Item>
            <Form.Item name="minorCount" label="次要人物数量">
              <Select options={[3, 5, 6, 8, 10].map((value) => ({ value, label: `${value} 人` }))} />
            </Form.Item>
            </div>
          </div>

          <div className="novel-characters__batch-section">
            <div className="novel-grid novel-grid--2">
              <Form.Item name="antagonistCount" label="反派数量">
              <Select options={[0, 1, 2, 3].map((value) => ({ value, label: `${value} 人` }))} />
            </Form.Item>
            <Form.Item name="supportingCount" label="功能角色数量">
              <Select options={[0, 1, 2, 3, 4].map((value) => ({ value, label: `${value} 人` }))} />
            </Form.Item>
            </div>
          </div>

          <div className="novel-characters__batch-section">
            <div className="novel-characters__batch-section-title">口径与补充要求</div>

            <Form.Item name="genderRatio" label="性别与年龄建议">
            <Input.TextArea rows={3} placeholder="例如：男女比例自然分布，保留一位年龄明显偏大的权威角色。" />
          </Form.Item>

          <Form.Item name="preferredSpecies" label="优先种族 / 实体">
            <Select
              mode="multiple"
              allowClear
              options={allSpecies.map((item) => ({ value: item, label: item }))}
            />
          </Form.Item>

          <Form.Item name="factionBias" label="优先势力来源">
            <Select
              mode="multiple"
              allowClear
              options={factionOptions.map((item) => ({ value: item, label: item }))}
            />
          </Form.Item>

          <Form.Item name="helperRoles" label="优先补齐的功能位">
            <Select
              mode="tags"
              allowClear
              placeholder="例如：队医、向导、执法者、卧底、军需官"
            />
          </Form.Item>

          <Form.Item name="batchSize" label="每批生成数量">
            <Select options={[4, 6, 8].map((value) => ({ value, label: `${value} 人 / 批` }))} />
          </Form.Item>

          <Form.Item name="specialRequirements" label="额外要求">
            <Input.TextArea
              rows={5}
              placeholder="例如：需要一位掌握关键药品的队医，一位和主角有旧债的敌对角色。"
            />
          </Form.Item>
          </div>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
