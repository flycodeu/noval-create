import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Input, Pagination, Select, Tag, Tooltip } from 'antd'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  FolderFilled,
  FolderOpenFilled,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
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

const CHAPTERS_PER_PAGE = 40

function getVolumeDisplayName(volume?: StoryVolume | null): string {
  if (!volume) return '未分卷'
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

export interface ChapterNavigatorProps {
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

interface VolumeGroup {
  key: string
  volumeId: number | null
  label: string
  statusLabel?: string
  targetWords?: number
  chapters: Chapter[]
  totalWords: number
  sort: number
}

/** 写作页左栏：支持千章级快速过滤、卷折叠/展开、分页、超长标题截断与 Tooltip 完整预览。 */
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
  const [searchKeyword, setSearchKeyword] = useState('')
  const [openVolumeKeys, setOpenVolumeKeys] = useState<Record<string, boolean>>({})
  const [volumePages, setVolumePages] = useState<Record<string, number>>({})
  const activeChapterRef = useRef<HTMLDivElement | null>(null)

  const chapterVolumeGroups = useMemo<VolumeGroup[]>(() => {
    const volumeById = new Map(volumes.map((volume) => [volume.id, volume]))
    const grouped = new Map<string, VolumeGroup>()

    volumes.forEach((volume) => {
      grouped.set(`volume-${volume.id}`, {
        key: `volume-${volume.id}`,
        volumeId: volume.id,
        label: getVolumeDisplayName(volume),
        statusLabel: getVolumeStatusLabel(volume.status),
        targetWords: volume.targetWords,
        chapters: [],
        totalWords: 0,
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
          label: volume ? getVolumeDisplayName(volume) : '未分卷',
          statusLabel: volume ? getVolumeStatusLabel(volume.status) : undefined,
          targetWords: volume?.targetWords,
          chapters: [],
          totalWords: 0,
          sort: volume?.volumeNumber || 9999,
        })
      }
      const group = grouped.get(key)!
      group.chapters.push(chapter)
      group.totalWords += chapter.wordCount || 0
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

  // 确保当前选中的章节所在的卷始终展开并定位到对应分页
  useEffect(() => {
    if (currentVolumeGroupKey) {
      setOpenVolumeKeys((prev) => ({ ...prev, [currentVolumeGroupKey]: true }))
    }
    if (currentChapter && currentVolumeGroup) {
      const indexInGroup = currentVolumeGroup.chapters.findIndex((c) => c.id === currentChapter.id)
      if (indexInGroup >= 0) {
        const targetPage = Math.floor(indexInGroup / CHAPTERS_PER_PAGE) + 1
        setVolumePages((prev) => ({ ...prev, [currentVolumeGroup.key]: targetPage }))
      }
    }
  }, [currentChapter, currentVolumeGroup, currentVolumeGroupKey])

  // 滚动到激活章节
  useEffect(() => {
    if (activeChapterRef.current) {
      activeChapterRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [currentChapterId])

  const normalizedKeyword = searchKeyword.trim().toLowerCase()

  const filteredGroups = useMemo(() => {
    if (!normalizedKeyword) return chapterVolumeGroups

    return chapterVolumeGroups
      .map((group) => {
        const filteredChapters = group.chapters.filter((chapter) => {
          const numStr = String(chapter.chapterNum)
          const title = (chapter.title || '').toLowerCase()
          return (
            numStr.includes(normalizedKeyword)
            || `第${numStr}章`.includes(normalizedKeyword)
            || `#${numStr}`.includes(normalizedKeyword)
            || title.includes(normalizedKeyword)
          )
        })
        return {
          ...group,
          chapters: filteredChapters,
        }
      })
      .filter((group) => group.chapters.length > 0)
  }, [chapterVolumeGroups, normalizedKeyword])

  const totalFilteredChapters = useMemo(
    () => filteredGroups.reduce((acc, g) => acc + g.chapters.length, 0),
    [filteredGroups],
  )

  const toggleVolume = useCallback((groupKey: string) => {
    setOpenVolumeKeys((prev) => ({
      ...prev,
      [groupKey]: prev[groupKey] === undefined ? false : !prev[groupKey],
    }))
  }, [])

  const setAllVolumesOpen = useCallback((open: boolean) => {
    const next: Record<string, boolean> = {}
    chapterVolumeGroups.forEach((g) => {
      next[g.key] = open
    })
    setOpenVolumeKeys(next)
  }, [chapterVolumeGroups])

  const isAllOpen = useMemo(() => {
    if (chapterVolumeGroups.length === 0) return true
    return chapterVolumeGroups.every((g) => openVolumeKeys[g.key] ?? true)
  }, [chapterVolumeGroups, openVolumeKeys])

  return (
    <section className="chapter-console-page__panel chapter-navigator-panel">
      <SectionHeader
        title="卷 / 章导航"
        extra={(
          <div className="chapter-navigator-panel__head-actions">
            <Button
              size="small"
              type="text"
              icon={isAllOpen ? <FolderFilled /> : <FolderOpenFilled />}
              onClick={() => setAllVolumesOpen(!isAllOpen)}
              title={isAllOpen ? '折叠全部卷' : '展开全部卷'}
            >
              {isAllOpen ? '折叠全部' : '展开全部'}
            </Button>
            <Button size="small" icon={<UnorderedListOutlined />} onClick={onOpenStructure}>
              结构
            </Button>
          </div>
        )}
      />

      {/* 搜索与过滤工具栏 */}
      <div className="chapter-navigator__search-row">
        <Input
          size="small"
          placeholder="按章号或关键词筛选..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          allowClear
          className="chapter-navigator__search-input"
        />
        {normalizedKeyword ? (
          <span className="chapter-navigator__search-badge">
            匹配 {totalFilteredChapters} 章
          </span>
        ) : (
          <span className="chapter-navigator__count-badge">
            {chapters.length} 章
          </span>
        )}
      </div>

      {/* 章节列表区 */}
      <div className="chapter-console-page__chapter-list chapter-navigator__list">
        {filteredGroups.length > 0 ? (
          filteredGroups.map((group) => {
            const isOpen = openVolumeKeys[group.key] ?? true
            const currentPage = volumePages[group.key] || 1
            const isPaginated = !normalizedKeyword && group.chapters.length > CHAPTERS_PER_PAGE
            const paginatedChapters = isPaginated
              ? group.chapters.slice((currentPage - 1) * CHAPTERS_PER_PAGE, currentPage * CHAPTERS_PER_PAGE)
              : group.chapters

            return (
              <section
                key={group.key}
                className={`chapter-console-page__volume-group chapter-navigator__volume-group${
                  group.key === currentVolumeGroupKey ? ' is-active-volume' : ''
                }`}
              >
                <div
                  className="chapter-console-page__volume-head chapter-navigator__volume-head"
                  onClick={() => toggleVolume(group.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleVolume(group.key)
                    }
                  }}
                >
                  <div className="chapter-navigator__volume-title">
                    <span className="chapter-navigator__volume-toggle-icon">
                      {isOpen ? <CaretDownOutlined /> : <CaretRightOutlined />}
                    </span>
                    <strong className="chapter-navigator__volume-name" title={group.label}>
                      {group.label}
                    </strong>
                    <span className="chapter-navigator__volume-count">
                      {group.chapters.length} 章
                    </span>
                  </div>

                  <div className="chapter-navigator__volume-tools" onClick={(e) => e.stopPropagation()}>
                    {group.volumeId ? (
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => onAddChapter(group.volumeId)}
                        title="在此卷新建章"
                        className="chapter-navigator__add-chapter-btn"
                      >
                        加章
                      </Button>
                    ) : null}
                  </div>
                </div>

                {isOpen ? (
                  <div className="chapter-console-page__volume-chapters chapter-navigator__volume-chapters">
                    {paginatedChapters.length > 0 ? (
                      paginatedChapters.map((chapter) => {
                        const isCurrent = currentChapterId === chapter.id
                        const chapterGeneration =
                          activeGeneration.chapterId === chapter.id && activeGeneration.status !== 'idle'
                            ? activeGeneration
                            : lastGenerationByChapter[chapter.id]
                        const chapterGenerationMeta = chapterGeneration ? getGenerationTagMeta(chapterGeneration) : null
                        const isHovered = hoverChapterId === chapter.id
                        const formattedNum = formatChapterNumber(chapter.chapterNum)
                        const displayTitle = chapter.title || `第${chapter.chapterNum}章`

                        return (
                          <div
                            key={chapter.id}
                            ref={isCurrent ? activeChapterRef : null}
                            className={`chapter-console-page__chapter-card chapter-navigator__chapter-card ${
                              isCurrent ? 'is-active' : ''
                            }`}
                            onClick={() => onSelectChapter(chapter.id)}
                            onMouseEnter={() => setHoverChapterId(chapter.id)}
                            onMouseLeave={() => setHoverChapterId(null)}
                          >
                            <div className="chapter-navigator__chapter-main">
                              <span className="chapter-navigator__chapter-num">
                                {formattedNum}
                              </span>

                              <Tooltip
                                title={displayTitle}
                                mouseEnterDelay={0.4}
                                placement="topLeft"
                              >
                                <span className="chapter-navigator__chapter-title">
                                  {displayTitle}
                                </span>
                              </Tooltip>
                            </div>

                            <div className="chapter-navigator__chapter-meta">
                              <span className="chapter-navigator__chapter-words">
                                {chapter.wordCount > 0 ? `${(chapter.wordCount / 1000).toFixed(chapter.wordCount >= 10000 ? 0 : 1)}k字` : '0字'}
                              </span>

                              {chapterGenerationMeta ? (
                                <Tag
                                  color={chapterGenerationMeta.color}
                                  className="chapter-navigator__status-tag"
                                >
                                  {chapterGenerationMeta.label}
                                </Tag>
                              ) : parseStringArray(chapter.staleReasonJson).length > 0 ? (
                                <Tag color="warning" className="chapter-navigator__status-tag">
                                  待同步
                                </Tag>
                              ) : (
                                <span className="chapter-navigator__status-text">
                                  {getStatusLabel(chapter.status)}
                                </span>
                              )}

                              {isHovered ? (
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onDeleteChapter(chapter.id, event)
                                  }}
                                  className="chapter-navigator__delete-btn"
                                  title="删除章节"
                                />
                              ) : null}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="chapter-console-page__volume-empty">此卷暂无章节</div>
                    )}

                    {isPaginated ? (
                      <div className="chapter-navigator__pagination-wrap">
                        <Pagination
                          size="small"
                          simple
                          current={currentPage}
                          pageSize={CHAPTERS_PER_PAGE}
                          total={group.chapters.length}
                          onChange={(page) => setVolumePages((prev) => ({ ...prev, [group.key]: page }))}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            )
          })
        ) : (
          <Empty
            description={normalizedKeyword ? '未找到匹配章节' : '还没有章节，先创建一个。'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </div>

      <ActionBar align="between" className="chapter-navigator__bottom-bar">
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => onAddChapter(currentVolumeGroup?.volumeId)}
          className="chapter-navigator__add-btn"
        >
          新建章节
        </Button>
        <Select
          size="small"
          className="writing-layout-select-generation"
          value={executionModeOverride}
          options={[
            { value: 'follow_default', label: `跟随默认（${getAiExecutionModeLabel(defaultAiExecutionMode)}）` },
            ...AI_EXECUTION_MODE_OPTIONS.map((item) => ({
              value: item.value,
              label: `覆盖·${item.label}`,
            })),
          ]}
          onChange={(value) => onExecutionModeChange(value)}
        />
      </ActionBar>
    </section>
  )
}

