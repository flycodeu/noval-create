import { useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Input, InputNumber, Select, Tag, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import type {
  Chapter,
  ChapterSegment,
  Character,
  ForeshadowLedgerEntry,
  StoryFact,
  StoryVolume,
} from '../../../../../types'
import { parseCharacterKnowledgeJson } from '../../parsers'
import {
  formatRatioPercent,
  getCurrentVolumeNumber,
  normalizeIdArray,
  type VolumeTruthRevealStats,
} from './insight-utils'

export function ChapterForeshadowWritebackCard({
  chapter,
  chapterSegments,
  ledger,
  saving,
  onCreate,
  onPatch,
  onDelete,
  onOpenLedger,
}: {
  chapter: Chapter | null
  chapterSegments: ChapterSegment[]
  ledger: ForeshadowLedgerEntry[]
  saving: boolean
  onCreate: (data: Partial<ForeshadowLedgerEntry>) => Promise<void>
  onPatch: (id: number, data: Partial<ForeshadowLedgerEntry>) => Promise<void>
  onDelete: (entry: ForeshadowLedgerEntry) => void
  onOpenLedger: () => void
}) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [sourceSegmentId, setSourceSegmentId] = useState<number | undefined>(undefined)
  const [targetPayoffChapter, setTargetPayoffChapter] = useState<number | null>(null)
  const [plantMethod, setPlantMethod] = useState('')
  const [salienceLevel, setSalienceLevel] = useState('medium')
  const [impactScope, setImpactScope] = useState('global')

  const chapterEntries = useMemo(
    () => ledger
      .filter((item) => chapter && item.sourceChapterId === chapter.id)
      .sort((left, right) => right.id - left.id),
    [chapter, ledger],
  )
  const segmentById = useMemo(
    () => new Map(chapterSegments.map((segment) => [segment.id, segment] as const)),
    [chapterSegments],
  )

  if (!chapter) {
    return <div className="novel-copy-block">先选择章节后再执行“本章伏笔回写”。</div>
  }

  const handleCreate = async () => {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      message.warning(getUserFacingMessage('writing.foreshadowTitleRequired'))
      return
    }
    await onCreate({
      title: normalizedTitle,
      detail: detail.trim() || undefined,
      sourceSegmentId: sourceSegmentId || null,
      plantMethod: plantMethod.trim() || undefined,
      salienceLevel,
      targetPayoffChapter: targetPayoffChapter || null,
      impactScope,
      status: 'active',
    })
    setTitle('')
    setDetail('')
    setSourceSegmentId(undefined)
    setTargetPayoffChapter(null)
    setPlantMethod('')
    setSalienceLevel('medium')
    setImpactScope('global')
  }

  return (
    <div className="writing-layout-stack">
      <div className="writing-layout-row writing-layout-row--between writing-layout-row--wrap">
        <div className="novel-insight-list">
          <div className="novel-insight-list__item">{`当前章节：第${chapter.chapterNum}章`}</div>
          <div className="novel-insight-list__item">{`本章已回写：${chapterEntries.length} 条`}</div>
        </div>
        <Button size="small" onClick={onOpenLedger}>打开伏笔回收账本</Button>
      </div>
      <div className="novel-note-list">
        <div className="novel-note-list__item writing-layout-stack writing-layout-stack--xs">
          <strong>新增本章伏笔</strong>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="伏笔标题，例如：断裂的族徽纹章"
            disabled={saving}
          />
          <Input.TextArea
            value={detail}
            rows={6}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="伏笔说明（可选）"
            disabled={saving}
          />
          <Input
            value={plantMethod}
            onChange={(event) => setPlantMethod(event.target.value)}
            placeholder="埋设方式（可选），例如：对话暗示 / 道具特写"
            disabled={saving}
          />
          <div className="writing-layout-field-grid">
            <Select
              allowClear
              value={sourceSegmentId}
              onChange={(value) => setSourceSegmentId(value)}
              placeholder="埋设场景（可选）"
              options={chapterSegments.map((segment) => ({
                value: segment.id,
                label: `场景${String(segment.segmentOrder || 0).padStart(2, '0')} · ${segment.title || '未命名场景'}`,
              }))}
              disabled={saving}
            />
            <InputNumber
              min={1}
              precision={0}
              value={targetPayoffChapter}
              onChange={(value) => setTargetPayoffChapter(typeof value === 'number' ? value : null)}
              className="writing-layout-width-full"
              placeholder="目标回收章位"
              disabled={saving}
            />
            <Select
              value={salienceLevel}
              onChange={(value) => setSalienceLevel(value)}
              options={[
                { value: 'low', label: '低显著' },
                { value: 'medium', label: '中显著' },
                { value: 'high', label: '高显著' },
              ]}
              disabled={saving}
            />
            <Select
              value={impactScope}
              onChange={(value) => setImpactScope(value)}
              options={[
                { value: 'local', label: '局部' },
                { value: 'character', label: '人物线' },
                { value: 'world', label: '世界观线' },
                { value: 'global', label: '全局主线' },
              ]}
              disabled={saving}
            />
          </div>
          <div>
            <Button type="primary" icon={<PlusOutlined />} loading={saving} onClick={() => void handleCreate()}>
              回写为本章新伏笔
            </Button>
          </div>
        </div>
      </div>
      {chapterEntries.length <= 0 ? (
        <div className="novel-copy-block">当前章节还没有回写伏笔。你可以先新增，或去账本页导入现有伏笔。</div>
      ) : (
        <div className="novel-note-list">
          {chapterEntries.map((entry) => {
            const segment = entry.sourceSegmentId ? segmentById.get(entry.sourceSegmentId) : null
            return (
              <div key={entry.id} className="novel-note-list__item writing-layout-stack writing-layout-stack--xs">
                <div className="writing-layout-row writing-layout-row--wrap">
                  <strong>{entry.title}</strong>
                  <Tag color={entry.status === 'resolved' ? 'success' : entry.status === 'active' ? 'processing' : 'default'}>
                    {entry.status || 'draft'}
                  </Tag>
                  {typeof entry.targetPayoffChapter === 'number' ? <Tag>{`目标第${entry.targetPayoffChapter}章`}</Tag> : null}
                </div>
                <div className="writing-layout-copy-muted">
                  {segment ? `场景：${segment.title || `场景${segment.segmentOrder}`}` : '场景：未设置'}
                  {entry.plantMethod ? ` · 埋设：${entry.plantMethod}` : ''}
                </div>
                {entry.detail ? <div>{entry.detail}</div> : null}
                {entry.payoffSceneAction ? <div className="writing-layout-copy-muted">{`回收动作：${entry.payoffSceneAction}`}</div> : null}
                {entry.requiredEvidence ? <div className="writing-layout-copy-muted">{`可见证据：${entry.requiredEvidence}`}</div> : null}
                {entry.readerVisibleOutcome ? <div className="writing-layout-copy-muted">{`读者结果：${entry.readerVisibleOutcome}`}</div> : null}
                {entry.allowedDelayReason ? <div className="writing-layout-copy-faint">{`允许延期：${entry.allowedDelayReason}`}</div> : null}
                <div className="writing-layout-row writing-layout-row--wrap">
                  <Select
                    size="small"
                    value={entry.status || 'draft'}
                    className="writing-layout-status-select"
                    disabled={saving}
                    onChange={(value) => void onPatch(entry.id, { status: value })}
                    options={[
                      { value: 'draft', label: '草稿' },
                      { value: 'active', label: '进行中' },
                      { value: 'resolved', label: '已回收' },
                      { value: 'archived', label: '归档' },
                    ]}
                  />
                  <Button
                    size="small"
                    loading={saving}
                    onClick={() => void onPatch(entry.id, { status: 'resolved' })}
                    disabled={entry.status === 'resolved'}
                  >
                    标记已回收
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(entry)}>
                    删除
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ChapterRevealConstraintCard({
  chapter,
  facts,
  volumes,
  characters,
  allowedFactIds,
  revealedFactIds,
  truthStats,
  saving,
  onUpdate,
  onOpenBoard,
}: {
  chapter: Chapter | null
  facts: StoryFact[]
  volumes: StoryVolume[]
  characters: Character[]
  allowedFactIds: number[]
  revealedFactIds: number[]
  truthStats: VolumeTruthRevealStats
  saving: boolean
  onUpdate: (nextAllowedIds: number[], nextRevealedIds: number[]) => Promise<void>
  onOpenBoard: () => void
}) {
  const [kind, setKind] = useState<'truth' | 'clue' | 'red_herring'>('truth')
  const chapterVolumeNumber = useMemo(
    () => getCurrentVolumeNumber(chapter, volumes),
    [chapter, volumes],
  )
  const puzzleTitleById = useMemo(() => {
    const map = new Map<number, string>()
    facts
      .filter((fact) => fact.kind === 'puzzle')
      .forEach((fact) => {
        map.set(fact.id, fact.title)
      })
    return map
  }, [facts])
  const characterNameById = useMemo(() => {
    const map = new Map<number, string>()
    characters.forEach((character) => {
      map.set(character.id, character.fullName)
    })
    return map
  }, [characters])
  const candidateFacts = useMemo(
    () => facts
      .filter((fact) => fact.kind === kind)
      .sort((left, right) => {
        const leftVolume = left.plannedRevealVolume || 999
        const rightVolume = right.plannedRevealVolume || 999
        if (leftVolume !== rightVolume) return leftVolume - rightVolume
        return left.id - right.id
      }),
    [facts, kind],
  )
  const allowedSet = useMemo(() => new Set(allowedFactIds), [allowedFactIds])
  const revealedSet = useMemo(() => new Set(revealedFactIds), [revealedFactIds])
  const volumeLabel = chapterVolumeNumber ? `第${chapterVolumeNumber}卷` : '待绑定卷'
  const ratioLabel = `${truthStats.plannedTruths}/${truthStats.totalTruths}`

  if (!chapter) {
    return <div className="novel-copy-block">先选择章节后再设置“本章允许揭示什么”。</div>
  }

  const handleAllowedToggle = (fact: StoryFact, checked: boolean) => {
    const nextAllowed = checked
      ? normalizeIdArray([...allowedFactIds, fact.id])
      : allowedFactIds.filter((id) => id !== fact.id)
    const nextRevealed = checked
      ? revealedFactIds
      : revealedFactIds.filter((id) => id !== fact.id)
    void onUpdate(nextAllowed, nextRevealed)
    if (checked && fact.kind === 'truth' && truthStats.overLimit) {
      message.warning(getUserFacingMessage('writing.truthRatioExceeded', { ratio: formatRatioPercent(truthStats.ratio) }))
    }
  }

  const handleRevealedToggle = (fact: StoryFact, checked: boolean) => {
    const withAllowed = checked
      ? normalizeIdArray([...allowedFactIds, fact.id])
      : allowedFactIds
    const nextRevealed = checked
      ? normalizeIdArray([...revealedFactIds, fact.id])
      : revealedFactIds.filter((id) => id !== fact.id)
    void onUpdate(withAllowed, nextRevealed)
  }

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <div className="writing-layout-row writing-layout-row--between writing-layout-row--wrap">
        <div className="novel-insight-list">
          <div className="novel-insight-list__item">{`当前卷：${volumeLabel}`}</div>
          <div className="novel-insight-list__item">{`真相揭示：${ratioLabel}（${formatRatioPercent(truthStats.ratio)}）`}</div>
          <div className="novel-insight-list__item">
            {truthStats.limit == null ? '卷级上限：未设置' : `卷级上限：${formatRatioPercent(truthStats.limit)}`}
          </div>
        </div>
        <Button size="small" onClick={onOpenBoard}>打开信息差谜题板</Button>
      </div>
      {truthStats.overLimit ? (
        <Alert
          showIcon
          type="warning"
          message="当前卷真相揭示比例超限"
          description="系统不会阻止勾选，但建议回到“信息差谜题板”调整计划揭示卷。"
        />
      ) : null}
      <Select
        value={kind}
        onChange={(value) => setKind(value as 'truth' | 'clue' | 'red_herring')}
        options={[
          { value: 'truth', label: '真相' },
          { value: 'clue', label: '线索' },
          { value: 'red_herring', label: '假线索' },
        ]}
      />
      {candidateFacts.length <= 0 ? (
        <div className="novel-copy-block">当前分类下没有命中可调度条目。</div>
      ) : (
        <div className="novel-note-list">
          {candidateFacts.map((fact) => {
            const locked = typeof fact.forbiddenBeforeVolume === 'number'
              && (!chapterVolumeNumber || chapterVolumeNumber < fact.forbiddenBeforeVolume)
            const relatedPuzzle = fact.relatedPuzzleId ? puzzleTitleById.get(fact.relatedPuzzleId) : null
            const characterKnowledge = parseCharacterKnowledgeJson(fact.characterKnowledgeJson)
              .map((entry) => characterNameById.get(entry.characterId) || `角色#${entry.characterId}`)
            return (
              <div key={fact.id} className="novel-note-list__item">
                <div className="writing-layout-stack writing-layout-stack--xs">
                  <div className="writing-layout-row writing-layout-row--wrap">
                    <strong>{fact.title}</strong>
                    <Tag color={fact.kind === 'truth' ? 'gold' : fact.kind === 'red_herring' ? 'volcano' : 'processing'}>
                      {fact.kind === 'truth' ? '真相' : fact.kind === 'red_herring' ? '假线索' : '线索'}
                    </Tag>
                    {fact.plannedRevealVolume ? <Tag>{`计划揭示：第${fact.plannedRevealVolume}卷`}</Tag> : null}
                    {locked ? <Tag color="warning">{`锁定到第${fact.forbiddenBeforeVolume}卷`}</Tag> : null}
                  </div>
                  {fact.summary ? <div>{fact.summary}</div> : null}
                  <div className="writing-layout-row writing-layout-row--wrap">
                    {relatedPuzzle ? <span>{`关联谜题：${relatedPuzzle}`}</span> : null}
                    {characterKnowledge.length > 0 ? <span>{`角色已知：${characterKnowledge.join('、')}`}</span> : null}
                    {fact.readerKnownChapterId ? <span>{`读者已知章节ID：${fact.readerKnownChapterId}`}</span> : null}
                    {fact.protagonistKnownChapterId ? <span>{`主角已知章节ID：${fact.protagonistKnownChapterId}`}</span> : null}
                  </div>
                  <div className="writing-layout-row writing-layout-row--wrap">
                    <Checkbox
                      checked={allowedSet.has(fact.id)}
                      disabled={saving || locked}
                      onChange={(event) => handleAllowedToggle(fact, event.target.checked)}
                    >
                      本章允许揭示
                    </Checkbox>
                    <Checkbox
                      checked={revealedSet.has(fact.id)}
                      disabled={saving || !allowedSet.has(fact.id)}
                      onChange={(event) => handleRevealedToggle(fact, event.target.checked)}
                    >
                      本章已揭示
                    </Checkbox>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
