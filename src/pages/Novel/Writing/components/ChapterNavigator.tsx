import React, { useMemo, useState } from 'react'
import { Button, Empty, Select, Tag } from 'antd'
import { DeleteOutlined, PlusOutlined, UnorderedListOutlined } from '@ant-design/icons'
import ActionBar from '../../../../components/novel/common/ActionBar'
import SectionHeader from '../../../../components/novel/common/SectionHeader'
import {
  AI_EXECUTION_MODE_OPTIONS,
  getAiExecutionModeLabel,
  type AiExecutionMode,
} from '../../../../shared/ai-execution'
import { useWritingViewStore, type WritingGenerationSnapshot } from '../../../../stores/writingView.store'
import type { Chapter, StoryVolume } from '../../../../types'
import { formatChapterNumber, getStatusLabel } from '../chapter-labels'
import { parseStringArray } from '../parsers'

function getVolumeDisplayName(volume?: StoryVolume | null): string {
  if (!volume) return '未绑定卷'
  return volume.title?.trim() || `第${volume.volumeNumber}卷`
}

function getVolumeStatusLabel(status?: StoryVolume['status']): string {
  if (status === 'locked') return '已锁定'
  if (status === 'draft') return '草稿'
  return '规划中'
}

function getGenerationTagMeta(snapshot: WritingGenerationSnapshot) {
  if (snapshot.status === 'running') return { color: 'processing' as const, label: '生成中' }
  if (snapshot.status === 'failed') return { color: 'error' as const, label: '失败' }
  if (snapshot.status === 'cancelled') return { color: 'default' as const, label: '已取消' }
  return { color: 'success' as const, label: '刚完成' }
}

interface ChapterNavigatorProps {
  chapters: Chapter[]
  volumes: StoryVolume[]
  currentChapter: Chapter | null
  currentChapterId: number | null
  defaultAiExecutionMode: AiExecutionMode
  executionModeOverride: AiExecutionMode | 'follow_default'
  onExecutionModeChange: (value: AiExecutionMode | 'follow_default') => void
  onSelectChapter: (chapterId: number) => void
  onAddChapter: (volumeId?: number | null) => void
  onDeleteChapter: (chapterId: number, event: React.MouseEvent) => void
  onOpenStructure: () => void
}

/** 写作页左栏：按卷分组的章节导航 + AI 执行模式选择。 */
export default function ChapterNavigator({
  chapters,
  volumes,
  currentChapter,
  currentChapterId,
  defaultAiExecutionMode,
  executionModeOverride,
  onExecutionModeChange,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  onOpenStructure,
}: ChapterNavigatorProps) {
  const activeGeneration = useWritingViewStore((state) => state.activeGeneration)
  const lastGenerationByChapter = useWritingViewStore((state) => state.lastGenerationByChapter)
  const [hoverChapterId, setHoverChapterId] = useState<number | null>(null)

  const chapterVolumeGroups = useMemo(() => {
    const volumeById = new Map(volumes.map((volume) => [volume.id, volume]))
    const grouped = new Map<string, {
      key: string
      volumeId: number | null
      label: string
      meta: string
      chapters: Chapter[]
      sort: number
    }>()

    volumes.forEach((volume) => {
      grouped.set(`volume-${volume.id}`, {
        key: `volume-${volume.id}`,
        volumeId: volume.id,
        label: getVolumeDisplayName(volume),
        meta: `${getVolumeStatusLabel(volume.status)} · 目标 ${volume.targetWords.toLocaleString()} 字`,
        chapters: [],
        sort: volume.volumeNumber || 9999,
      })
    })

    chapters.forEach((chapter) => {
      const volume = chapter.volumeId ? volumeById.get(chapter.volumeId) : null
      const key = volume ? `volume-${volume.id}` : 'unbound'
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          volumeId: volume?.id || null,
          label: volume ? getVolumeDisplayName(volume) : '未绑定卷',
          meta: volume
            ? `${getVolumeStatusLabel(volume.status)} · 目标 ${volume.targetWords.toLocaleString()} 字`
            : '这些章节还没有归入卷级结构',
          chapters: [],
          sort: volume?.volumeNumber || 9999,
        })
      }
      grouped.get(key)?.chapters.push(chapter)
    })

    return Array.from(grouped.values())
      .filter((group) => group.chapters.length > 0 || group.volumeId !== null)
      .sort((left, right) => left.sort - right.sort || left.label.localeCompare(right.label))
      .map((group) => ({
        ...group,
        chapters: group.chapters.sort((left, right) => left.chapterNum - right.chapterNum || left.id - right.id),
      }))
  }, [chapters, volumes])

  const currentVolumeGroupKey = currentChapter
    ? currentChapter.volumeId ? `volume-${currentChapter.volumeId}` : 'unbound'
    : chapterVolumeGroups.find((group) => group.chapters.length > 0)?.key || chapterVolumeGroups[0]?.key || 'unbound'
  const currentVolumeGroup = useMemo(
    () => chapterVolumeGroups.find((group) => group.key === currentVolumeGroupKey) || null,
    [chapterVolumeGroups, currentVolumeGroupKey],
  )

  return (
    <section className="chapter-console-page__panel">
      <SectionHeader
        eyebrow="章节生产"
        title="卷 / 章导航"
        description={`共 ${chapterVolumeGroups.length || 0} 卷组、${chapters.length} 章，按长篇结构选择当前要写的章节。`}
        extra={(
          <Button size="small" icon={<UnorderedListOutlined />} onClick={onOpenStructure}>
            结构
          </Button>
        )}
      />
      <div className="chapter-console-page__chapter-list">
        {chapterVolumeGroups.length > 0 ? chapterVolumeGroups.map((group) => (
          <section
            key={group.key}
            className={`chapter-console-page__volume-group${group.key === currentVolumeGroupKey ? ' is-active' : ''}`}
          >
            <div className="chapter-console-page__volume-head">
              <div className="chapter-console-page__volume-title">
                <strong>{group.label}</strong>
                <span>{`${group.chapters.length} 章 · ${group.chapters.reduce((total, chapter) => total + (chapter.wordCount || 0), 0).toLocaleString()} 字`}</span>
              </div>
              <div className="chapter-console-page__volume-tools">
                <span>{group.meta}</span>
                {group.volumeId ? (
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => onAddChapter(group.volumeId)}
                  >
                    新章
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="chapter-console-page__volume-chapters">
              {group.chapters.length > 0 ? group.chapters.map((chapter) => {
                const chapterGeneration = activeGeneration.chapterId === chapter.id && activeGeneration.status !== 'idle'
                  ? activeGeneration
                  : lastGenerationByChapter[chapter.id]
                const chapterGenerationMeta = chapterGeneration ? getGenerationTagMeta(chapterGeneration) : null
                return (
                  <div
                    key={chapter.id}
                    className={`chapter-console-page__chapter-card ${currentChapterId === chapter.id ? 'is-active' : ''}`}
                    onClick={() => onSelectChapter(chapter.id)}
                    onMouseEnter={() => setHoverChapterId(chapter.id)}
                    onMouseLeave={() => setHoverChapterId(null)}
                  >
                    <div className="chapter-console-page__chapter-copy">
                      <strong>{formatChapterNumber(chapter.chapterNum)}</strong>
                      <span>{chapter.title || `第${chapter.chapterNum}章`}</span>
                      <small>{`${chapter.wordCount} 字 · ${getStatusLabel(chapter.status)}`}</small>
                      <div className="chapter-console-page__chapter-tags">
                        {parseStringArray(chapter.staleReasonJson).length > 0 ? <Tag color="warning">待同步</Tag> : null}
                        {chapterGenerationMeta ? <Tag color={chapterGenerationMeta.color}>{chapterGenerationMeta.label}</Tag> : null}
                      </div>
                    </div>
                    {hoverChapterId === chapter.id ? (
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(event) => onDeleteChapter(chapter.id, event)}
                      />
                    ) : null}
                  </div>
                )
              }) : (
                <div className="chapter-console-page__volume-empty">当前卷还没有章节。</div>
              )}
            </div>
          </section>
        )) : <Empty description="还没有章节，先创建一个。" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </div>
      <ActionBar align="between">
        <Button type="dashed" icon={<PlusOutlined />} onClick={() => onAddChapter(currentVolumeGroup?.volumeId)}>
          在当前卷新建章
        </Button>
        <Select
          size="small"
          className="writing-layout-select-generation"
          value={executionModeOverride}
          options={[
            { value: 'follow_default', label: `跟随默认（${getAiExecutionModeLabel(defaultAiExecutionMode)}）` },
            ...AI_EXECUTION_MODE_OPTIONS.map((item) => ({
              value: item.value,
              label: `本次覆盖·${item.label}`,
            })),
          ]}
          onChange={(value) => onExecutionModeChange(value)}
        />
      </ActionBar>
    </section>
  )
}
