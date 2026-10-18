import { CREATIVE_STAGES, type CreativeChangeScope, type CreativeChapterRevision, type CreativeStage } from '../../../shared/creative-workflow'
import { getUserFacingMessage } from '../../../utils/user-facing-message'

export type ObjectTaskTarget = {
  title: string
  stage: CreativeStage
  request: string
  atChapter?: number
  count?: number
  changeScope?: CreativeChangeScope
  chapterRevision?: CreativeChapterRevision
  sourceArtifactId?: string
  revisionIssueIds?: number[]
  runId?: number
  artifactId?: string
  initialAutoApply?: boolean
}

export function objectTaskFromRoute(route: string, title: string): ObjectTaskTarget {
  const params = new URLSearchParams(route.split('?')[1] || '')
  const stage = params.get('stage') as CreativeStage
  if (!CREATIVE_STAGES.includes(stage)) throw new Error(getUserFacingMessage('workspace.revision.stageMissing'))
  const atChapter = params.has('atChapter') ? Number(params.get('atChapter')) : undefined
  if (atChapter !== undefined && (!Number.isInteger(atChapter) || atChapter < 0)) throw new Error(getUserFacingMessage('workspace.revision.chapterInvalid'))
  const json = <T,>(key: string): T | undefined => params.has(key) ? JSON.parse(params.get(key)!) as T : undefined
  return { title, stage, request: params.get('request') || '', atChapter,
    count: params.has('count') ? Math.max(1, Number(params.get('count')) || 1) : undefined,
    sourceArtifactId: params.get('sourceArtifactId') || undefined,
    changeScope: json<CreativeChangeScope>('changeScope'), chapterRevision: json<CreativeChapterRevision>('chapterRevision'),
    revisionIssueIds: json<number[]>('revisionIssueIds'), initialAutoApply: params.get('autoApply') === 'true',
  }
}
