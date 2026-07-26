import type { Chapter } from '../../../types'

export const STATUS_OPTIONS = [
  { value: 'outline', label: '待写' },
  { value: 'writing', label: '写作中' },
  { value: 'draft', label: '草稿' },
  { value: 'reviewing', label: '审校中' },
  { value: 'final', label: '已完成' },
]

export const formatChapterNumber = (chapterNum?: number) => typeof chapterNum === 'number' ? `第${chapterNum}章` : '章节号待补'

export const getStatusLabel = (status?: Chapter['status']) => STATUS_OPTIONS.find((item) => item.value === status)?.label || '未设置'
