import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Pagination, Select, Space, Spin, Tag, message } from 'antd'
import { ApartmentOutlined, DeleteOutlined, ReloadOutlined, RobotOutlined, SaveOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type { Character, CharacterDetailContext, CharacterFilterOptions, CharacterQueryInput, CharacterStats, PagedResult } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getCharacterBatchPreset } from '../../../shared/creation-tools'
import { getFactionNameOptions, getPowerSystemNameOptions, getSpeciesNameOptions, parseWorldRulesJson } from '../../../shared/genre-system'
import { buildDraftMessages, normalizeOptionalNumber, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel, WorkspaceTip } from '../components/WorkspaceShell'
import '../components/boards.css'

interface Props { novelId: number }

interface CharacterFormValues {
  roleType: Character['roleType']
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

const PAGE_SIZE = 24
const EMPTY_PAGE: PagedResult<Character> = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
const EMPTY_STATS: CharacterStats = { total: 0, protagonistCount: 0, majorCount: 0, antagonistCount: 0, relationCount: 0, speciesCount: 0 }
const EMPTY_FILTERS: CharacterFilterOptions = { species: [], entityTypes: [] }
const EMPTY_DETAIL: CharacterDetailContext = { relatedItems: [], relatedCharacters: [], relatedRelations: [] }

const ROLE_META: Record<Character['roleType'], { label: string; color: string }> = {
  protagonist: { label: '主角', color: 'gold' },
  major: { label: '主要人物', color: 'blue' },
  minor: { label: '次要人物', color: 'default' },
  antagonist: { label: '对立角色', color: 'red' },
  supporting: { label: '功能角色', color: 'purple' },
}

const ROLE_OPTIONS = [
  { value: 'protagonist', label: '主角' },
  { value: 'major', label: '主要人物' },
  { value: 'antagonist', label: '对立角色' },
  { value: 'supporting', label: '功能角色' },
  { value: 'minor', label: '次要人物' },
] as const

const ENTITY_TYPE_OPTIONS = [
  { value: 'human', label: '人类' },
  { value: 'undead', label: '亡灵 / 不死者' },
  { value: 'beast', label: '兽类 / 灵兽' },
  { value: 'immortal', label: '仙神 / 超凡存在' },
  { value: 'nonhuman', label: '非人智慧体' },
]

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseAppearance(raw?: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && typeof parsed.description === 'string' ? parsed.description : ''
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

export default function CharactersPage({ novelId }: Props) {
  const { currentNovel, setCharacters } = useNovelStore()
  const [form] = Form.useForm<CharacterFormValues>()
  const [batchForm] = Form.useForm<CharacterBatchFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [pageData, setPageData] = useState<PagedResult<Character>>(EMPTY_PAGE)
  const [stats, setStats] = useState<CharacterStats>(EMPTY_STATS)
  const [filterOptions, setFilterOptions] = useState<CharacterFilterOptions>(EMPTY_FILTERS)
  const [detailContext, setDetailContext] = useState<CharacterDetailContext>(EMPTY_DETAIL)
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [speciesFilter, setSpeciesFilter] = useState<string>('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all')

  const worldRules = useMemo(() => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName), [currentNovel?.genreName, currentNovel?.worldRulesJson])
  const speciesOptions = useMemo(() => getSpeciesNameOptions(worldRules), [worldRules])
  const factionOptions = useMemo(() => getFactionNameOptions(worldRules), [worldRules])
  const powerSystemOptions = useMemo(() => getPowerSystemNameOptions(worldRules), [worldRules])
  const batchPreset = useMemo(() => getCharacterBatchPreset(currentNovel?.genreName, speciesOptions), [currentNovel?.genreName, speciesOptions])
  const availableSpecies = useMemo(() => Array.from(new Set([...speciesOptions, ...filterOptions.species])).filter(Boolean), [filterOptions.species, speciesOptions])
  const availableEntityTypes = useMemo(() => Array.from(new Set([...ENTITY_TYPE_OPTIONS.map((item) => item.value), ...filterOptions.entityTypes])).filter(Boolean), [filterOptions.entityTypes])

  const buildQuery = useCallback((targetPage = page): CharacterQueryInput => ({
    novelId,
    page: targetPage,
    pageSize: PAGE_SIZE,
    ...(roleFilter !== 'all' ? { roleType: roleFilter as Character['roleType'] } : {}),
    ...(entityTypeFilter !== 'all' ? { entityType: entityTypeFilter } : {}),
    ...(speciesFilter !== 'all' ? { species: speciesFilter } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  }), [entityTypeFilter, keyword, novelId, page, roleFilter, speciesFilter])

  const loadCharacterDetail = useCallback(async (characterId: number) => {
    const [character, context] = await Promise.all([
      window.electron.character.get(characterId),
      window.electron.character.getDetailContext(characterId),
    ])
    if (!character) {
      setSelectedId(null)
      setSelectedCharacter(null)
      setDetailContext(EMPTY_DETAIL)
      form.resetFields()
      return
    }
    setSelectedId(character.id)
    setSelectedCharacter(character)
    setDetailContext(context)
    form.setFieldsValue(toFormValues(character))
  }, [form])

  const loadPage = useCallback(async (preferredId?: number | null, targetPage = page) => {
    setLoading(true)
    try {
      const query = buildQuery(targetPage)
      const [list, summary, nextFilters] = await Promise.all([
        window.electron.character.query(query),
        window.electron.character.getStats(query),
        window.electron.character.getFilterOptions(novelId),
      ])
      setPageData(list)
      setStats(summary)
      setFilterOptions(nextFilters)
      setCharacters(list.items)

      const nextId = preferredId ?? (list.items.some((item) => item.id === selectedId) ? selectedId : list.items[0]?.id ?? null)
      if (nextId) {
        setCreating(false)
        await loadCharacterDetail(nextId)
      } else {
        setSelectedId(null)
        setSelectedCharacter(null)
        setDetailContext(EMPTY_DETAIL)
        setCreating(false)
        form.resetFields()
      }
    } finally {
      setLoading(false)
    }
  }, [buildQuery, form, loadCharacterDetail, novelId, page, selectedId, setCharacters])

  useEffect(() => { void loadPage(selectedId, page) }, [loadPage, page, selectedId])
  useEffect(() => { setPage(1) }, [entityTypeFilter, keyword, roleFilter, speciesFilter])
  useEffect(() => {
    batchForm.setFieldsValue({
      majorCount: batchPreset.majorCount,
      minorCount: batchPreset.minorCount,
      antagonistCount: batchPreset.antagonistCount,
      supportingCount: batchPreset.supportingCount,
      genderRatio: batchPreset.genderRatio,
      preferredSpecies: batchPreset.preferredSpecies,
      factionBias: factionOptions.slice(0, 3),
      helperRoles: batchPreset.helperRoles,
      batchSize: 6,
      specialRequirements: '',
    })
  }, [batchForm, batchPreset, factionOptions])

  const handleNew = () => {
    setCreating(true)
    setSelectedId(null)
    setSelectedCharacter(null)
    setDetailContext(EMPTY_DETAIL)
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
        await loadPage(selectedCharacter.id, page)
      } else {
        const nextId = await window.electron.character.create(novelId, serialize(values))
        await loadPage(nextId, page)
      }
      setCreating(false)
      message.success('人物档案已保存。')
    } catch (error) {
      console.error(error)
      message.error('保存失败，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedCharacter?.id) return
    Modal.confirm({
      title: `删除「${selectedCharacter.fullName}」？`,
      content: '删除后不会自动清理其他模块中的引用，请确认这个角色已不再使用。',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electron.character.delete(selectedCharacter.id)
        await loadPage(null, page)
        message.success('人物已删除。')
      },
    })
  }

  const handleGenerateProtagonist = async () => {
    setGenerating(true)
    try {
      const nextId = await window.electron.character.generateProtagonist(novelId, {})
      await loadPage(nextId, 1)
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
      await loadPage(null, 1)
      message.success('人物网络首轮已生成。')
    } catch (error) {
      console.error(error)
      message.error('批量生成人物失败。')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateRelations = async () => {
    setGenerating(true)
    try {
      await window.electron.character.generateRelations(novelId)
      await loadPage(selectedId, page)
      message.success('人物关系已生成。')
    } catch (error) {
      console.error(error)
      message.error('人物关系生成失败。')
    } finally {
      setGenerating(false)
    }
  }

  const handleClear = async () => {
    Modal.confirm({
      title: '清空人物系统？',
      content: '会删除当前小说下全部人物与关系数据，此操作不可撤销。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        await window.electron.character.clear(novelId)
        form.resetFields()
        setSelectedId(null)
        setSelectedCharacter(null)
        setDetailContext(EMPTY_DETAIL)
        setCreating(false)
        await loadPage(null, 1)
        message.success('人物系统已清空。')
      },
    })
  }

  const selectedLead = selectedCharacter ? selectedCharacter.innerConflict || selectedCharacter.goals || selectedCharacter.firstImpression || selectedCharacter.background || '先补这个角色的核心目标和阻力。' : creating ? '先定身份和当前目标。' : '先从左侧选择一个角色。'

  return (
    <WorkspacePage
      className="novel-characters-page"
      layout="wide"
      eyebrow="角色系统"
      title="角色系统"
      description="管理人物档案和当前角色编辑。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<TeamOutlined />} loading={generating} onClick={() => setBatchOpen(true)}>AI 批量生成</Button>
          <Button icon={<RobotOutlined />} loading={generating} onClick={handleGenerateProtagonist}>AI 补主角</Button>
          <Button icon={<ApartmentOutlined />} loading={generating} onClick={handleGenerateRelations}>AI 生成关系</Button>
          <Button icon={<UserAddOutlined />} onClick={handleNew}>新建人物</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void loadPage(selectedId, page)}>刷新</Button>
          <Button danger icon={<DeleteOutlined />} loading={generating} onClick={() => void handleClear()}>清空人物</Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '角色总数', value: stats.total },
            { label: '势力 / 体系', value: `${factionOptions.length} / ${powerSystemOptions.length}` },
            { label: '当前焦点', value: selectedCharacter ? `${selectedCharacter.fullName} · ${ROLE_META[selectedCharacter.roleType].label}` : '未选中角色' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="筛选后角色" value={pageData.total} tone="warm" hint={`第 ${pageData.page} 页`} />
          <WorkspaceMetric label="主角数" value={stats.protagonistCount} hint="当前小说已建立的主角数。" />
          <WorkspaceMetric label="关系数" value={stats.relationCount} tone="cool" hint="已建立的人物关系条目。" />
          <WorkspaceMetric label="种类覆盖" value={stats.speciesCount} hint="当前角色体系出现过的种类数。" />
        </>
      )}
    >
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          title="人物列表"
          description="支持分页、筛选和关键词查询。"
          extra={(
            <div className="novel-filter-bar">
              <div className="novel-filter-bar__row">
                <Input.Search allowClear placeholder="搜索姓名、目标、职业或矛盾" value={keyword} onChange={(event) => setKeyword(event.target.value)} onSearch={setKeyword} />
                <Select value={roleFilter} options={[{ value: 'all', label: '全部角色' }, ...ROLE_OPTIONS]} onChange={setRoleFilter} />
              </div>
              <div className="novel-filter-bar__row">
                <Select value={entityTypeFilter} options={[{ value: 'all', label: '全部实体' }, ...availableEntityTypes.map((item) => ({ value: item, label: ENTITY_TYPE_OPTIONS.find((option) => option.value === item)?.label || item }))]} onChange={setEntityTypeFilter} />
                <Select value={speciesFilter} options={[{ value: 'all', label: '全部种类' }, ...availableSpecies.map((item) => ({ value: item, label: item }))]} onChange={setSpeciesFilter} />
              </div>
            </div>
          )}
        >
          {loading ? <div className="novel-empty"><Spin /></div> : pageData.total === 0 ? <div className="novel-empty">当前筛选下还没有角色。</div> : (
            <div style={{ display: 'grid', gap: 12 }}>
              {pageData.items.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  className={`novel-list-card ${selectedId === character.id ? 'novel-list-card--active' : ''}`}
                  onClick={() => void loadCharacterDetail(character.id)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className="novel-list-card__title">{character.fullName}</div>
                  <div className="novel-list-card__meta">
                    <Tag color={ROLE_META[character.roleType].color}>{ROLE_META[character.roleType].label}</Tag>
                    {character.species ? <Tag>{character.species}</Tag> : null}
                    {character.rankLevel ? <Tag color="blue">{character.rankLevel}</Tag> : null}
                  </div>
                  <div className="novel-list-card__desc">{character.innerConflict || character.goals || character.firstImpression || character.background || '这个角色还没有核心信息。'}</div>
                </button>
              ))}
              <Pagination current={pageData.page} pageSize={pageData.pageSize} total={pageData.total} size="small" showSizeChanger={false} onChange={setPage} />
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel
          title={selectedCharacter ? `编辑：${selectedCharacter.fullName}` : creating ? '新建人物' : '人物档案'}
          description="补当前人物的身份、动机和关系。"
          extra={(
            <Space>
              <AIGenerateButton
                label={selectedCharacter ? 'AI 补当前人物' : 'AI 生成人物'}
                isJson
                disabled={!selectedCharacter && !creating}
                buildMessages={() => {
                  const values = form.getFieldsValue(true)
                  return buildDraftMessages({
                    task: '人物档案',
                    mode: 'replace',
                    context: [
                      { label: '书名', value: currentNovel?.title || '' },
                      { label: '题材', value: currentNovel?.genreName || '' },
                      { label: '小说简介', value: currentNovel?.synopsis || '' },
                      { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
                      { label: '人物生态', value: worldRules.characterEcology.overview },
                      { label: '可用种类', value: availableSpecies.slice(0, 12).join('、') },
                      { label: '可用势力', value: factionOptions.slice(0, 12).join('、') },
                      { label: '可用体系', value: powerSystemOptions.slice(0, 12).join('、') },
                    ],
                    fields: [
                      { key: 'species', label: '种类', value: values.species },
                      { key: 'fullName', label: '姓名', value: values.fullName, hint: '写正常、可读的人名。' },
                      { key: 'gender', label: '性别', value: values.gender },
                      { key: 'age', label: '年龄', type: 'number', value: values.age },
                      { key: 'occupation', label: '职业', value: values.occupation },
                      { key: 'rankLevel', label: '等级 / 职级', value: values.rankLevel },
                      { key: 'socialIdentity', label: '社会位置', value: values.socialIdentity },
                      { key: 'background', label: '背景经历', value: values.background },
                      { key: 'campFactions', label: '所属势力', type: 'string[]', value: values.campFactions },
                      { key: 'powerSystems', label: '关联体系', type: 'string[]', value: values.powerSystems },
                      { key: 'contextHooks', label: '主线挂点', type: 'string[]', value: values.contextHooks },
                      { key: 'goals', label: '当前目标', value: values.goals },
                      { key: 'firstImpression', label: '第一印象', value: values.firstImpression },
                      { key: 'innerConflict', label: '内在矛盾', value: values.innerConflict },
                      { key: 'relationshipTension', label: '关系张力', value: values.relationshipTension },
                      { key: 'resonancePoint', label: '共情点', value: values.resonancePoint },
                      { key: 'characterArc', label: '后续弧光', value: values.characterArc },
                      { key: 'appearance', label: '可识别外貌', value: values.appearance },
                    ],
                  })
                }}
                onResult={(raw) => {
                  const values = form.getFieldsValue(true)
                  const draft = parseDraftJson<Record<string, unknown>>(raw)
                  form.setFieldsValue({
                    ...values,
                    species: typeof draft.species === 'string' ? draft.species : values.species,
                    fullName: typeof draft.fullName === 'string' ? draft.fullName : values.fullName,
                    gender: typeof draft.gender === 'string' ? draft.gender : values.gender,
                    age: normalizeOptionalNumber(draft.age ?? values.age),
                    occupation: typeof draft.occupation === 'string' ? draft.occupation : values.occupation,
                    rankLevel: typeof draft.rankLevel === 'string' ? draft.rankLevel : values.rankLevel,
                    socialIdentity: typeof draft.socialIdentity === 'string' ? draft.socialIdentity : values.socialIdentity,
                    background: typeof draft.background === 'string' ? draft.background : values.background,
                    campFactions: normalizeStringArray(draft.campFactions).length > 0 ? normalizeStringArray(draft.campFactions) : values.campFactions,
                    powerSystems: normalizeStringArray(draft.powerSystems).length > 0 ? normalizeStringArray(draft.powerSystems) : values.powerSystems,
                    contextHooks: normalizeStringArray(draft.contextHooks).length > 0 ? normalizeStringArray(draft.contextHooks) : values.contextHooks,
                    goals: typeof draft.goals === 'string' ? draft.goals : values.goals,
                    firstImpression: typeof draft.firstImpression === 'string' ? draft.firstImpression : values.firstImpression,
                    innerConflict: typeof draft.innerConflict === 'string' ? draft.innerConflict : values.innerConflict,
                    relationshipTension: typeof draft.relationshipTension === 'string' ? draft.relationshipTension : values.relationshipTension,
                    resonancePoint: typeof draft.resonancePoint === 'string' ? draft.resonancePoint : values.resonancePoint,
                    characterArc: typeof draft.characterArc === 'string' ? draft.characterArc : values.characterArc,
                    appearance: typeof draft.appearance === 'string' ? draft.appearance : values.appearance,
                  })
                }}
              />
              {selectedCharacter ? <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>删除</Button> : null}
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button>
            </Space>
          )}
        >
          {!selectedCharacter && !creating && !loading ? <div className="novel-empty">从左侧选中一个角色后再编辑。</div> : (
            <>
              <div className="novel-characters__editor-intro">
                <div className="novel-characters__editor-intro-copy">
                  <div className="novel-kicker">{selectedCharacter ? '当前人物' : '新建档案'}</div>
                  <strong>{selectedCharacter ? selectedCharacter.fullName : '从身份和目标开始'}</strong>
                  <span>{selectedLead}</span>
                </div>
              </div>
              <Form form={form} layout="vertical">
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="roleType" label="角色类型" rules={[{ required: true, message: '请选择角色类型' }]}><Select options={ROLE_OPTIONS as unknown as Array<{ value: Character['roleType']; label: string }>} /></Form.Item>
                  <Form.Item name="entityType" label="实体类型"><Select allowClear options={ENTITY_TYPE_OPTIONS} /></Form.Item>
                  <Form.Item name="species" label="种类 / 物种"><Select showSearch allowClear options={availableSpecies.map((item) => ({ value: item, label: item }))} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}><Input /></Form.Item>
                  <Form.Item name="gender" label="性别"><Input /></Form.Item>
                  <Form.Item name="age" label="年龄"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="occupation" label="职业 / 身份"><Input /></Form.Item>
                  <Form.Item name="rankLevel" label="等级 / 职级"><Input /></Form.Item>
                  <Form.Item name="socialIdentity" label="社会位置"><Input /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="campFactions" label="所属势力"><Select mode="tags" allowClear options={factionOptions.map((item) => ({ value: item, label: item }))} /></Form.Item>
                  <Form.Item name="powerSystems" label="关联体系"><Select mode="tags" allowClear options={powerSystemOptions.map((item) => ({ value: item, label: item }))} /></Form.Item>
                </div>
                <Form.Item name="contextHooks" label="主线挂点"><Select mode="tags" allowClear placeholder="例如：掌握补给线、知道旧案真相、被关键势力追杀" /></Form.Item>
                <Form.Item name="background" label="背景经历"><Input.TextArea rows={4} /></Form.Item>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="goals" label="当前目标"><Input.TextArea rows={3} /></Form.Item>
                  <Form.Item name="firstImpression" label="第一印象"><Input.TextArea rows={3} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="innerConflict" label="内在矛盾"><Input.TextArea rows={3} /></Form.Item>
                  <Form.Item name="relationshipTension" label="关系张力"><Input.TextArea rows={3} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="resonancePoint" label="读者共情点"><Input.TextArea rows={3} /></Form.Item>
                  <Form.Item name="characterArc" label="后续弧光"><Input.TextArea rows={3} /></Form.Item>
                </div>
                <Form.Item name="appearance" label="可识别外貌"><Input.TextArea rows={3} /></Form.Item>
              </Form>

              {selectedCharacter ? (
                <div className="novel-support-grid" style={{ marginTop: 20 }}>
                  <WorkspaceTip title="相关物品">
                    {detailContext.relatedItems.length === 0 ? <div>这个角色还没有绑定关键物品。</div> : detailContext.relatedItems.map((item) => <div key={item.id}>{item.itemName}</div>)}
                  </WorkspaceTip>
                  <WorkspaceTip title="相关关系">
                    {detailContext.relatedRelations.length === 0 ? <div>这个角色还没有关系链。</div> : detailContext.relatedRelations.map((relation) => {
                      const other = detailContext.relatedCharacters.find((item) => item.id === (relation.charAId === selectedCharacter.id ? relation.charBId : relation.charAId))
                      return <div key={relation.id}>{other?.fullName || '未知人物'} · {relation.relationLabel || relation.relationType || '关系待补'}</div>
                    })}
                  </WorkspaceTip>
                </div>
              ) : null}
            </>
          )}
        </WorkspacePanel>
      </div>

      <Modal title="批量生成人物" open={batchOpen} onCancel={() => setBatchOpen(false)} onOk={() => void handleBatchGenerate()} confirmLoading={generating} okText="开始生成">
        <Form form={batchForm} layout="vertical">
          <div className="novel-grid novel-grid--2">
            <Form.Item name="majorCount" label="主要人物"><Select options={[2, 3, 4, 5, 6].map((value) => ({ value, label: `${value} 位` }))} /></Form.Item>
            <Form.Item name="minorCount" label="次要人物"><Select options={[3, 5, 6, 8, 10].map((value) => ({ value, label: `${value} 位` }))} /></Form.Item>
          </div>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="antagonistCount" label="对立角色"><Select options={[0, 1, 2, 3].map((value) => ({ value, label: `${value} 位` }))} /></Form.Item>
            <Form.Item name="supportingCount" label="功能角色"><Select options={[0, 1, 2, 3, 4].map((value) => ({ value, label: `${value} 位` }))} /></Form.Item>
          </div>
          <Form.Item name="genderRatio" label="性别与年龄建议"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="preferredSpecies" label="优先种类"><Select mode="multiple" allowClear options={availableSpecies.map((item) => ({ value: item, label: item }))} /></Form.Item>
          <Form.Item name="factionBias" label="优先势力来源"><Select mode="multiple" allowClear options={factionOptions.map((item) => ({ value: item, label: item }))} /></Form.Item>
          <Form.Item name="helperRoles" label="优先功能位"><Select mode="tags" allowClear placeholder="例如：队医、情报员、导师、卧底" /></Form.Item>
          <Form.Item name="batchSize" label="每批生成数量"><Select options={[4, 6, 8].map((value) => ({ value, label: `${value} 位 / 批` }))} /></Form.Item>
          <Form.Item name="specialRequirements" label="额外要求"><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
