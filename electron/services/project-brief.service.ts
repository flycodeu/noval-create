import { eq } from 'drizzle-orm'
import type {
  ProjectBriefGenerationRequest,
  ProjectBriefGenerationResult,
  ProjectBriefGenerationStepResult,
} from '../../src/shared/project-brief-generation'
import type { ProjectBriefDocument, ProjectPlatformMode } from '../../src/shared/project-brief'
import {
  buildProjectBriefSummary,
  getPlatformDesignProfile,
  isProjectPlatformMode,
  parseProjectBriefDocument,
} from '../../src/shared/project-brief'
import {
  buildContextAlignmentRules,
  buildHumanLanguageRules,
  buildOutputQualityRules,
} from '../../src/shared/prompt-library'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { getDb } from '../database/db'
import { novels } from '../database/schema'
import { safeParseAiJson } from '../utils/json'
import { throwUserFacingError } from '../utils/user-facing-error'
import { buildStoryProfile } from './context.service'
import { runChatTask } from './task.service'

function clean(value?: string | null): string {
  return value?.trim() || ''
}

function renderPrompt(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function section(title: string, content?: string | null): string {
  const body = clean(content)
  if (!body) return ''
  return `【${title}】\n${body}`
}

function sectionLines(title: string, lines: Array<string | undefined | null | false>): string {
  const body = lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join('\n')
  return section(title, body)
}

function sanitizeErrorMessage(error: unknown, fallback = '生成失败'): string {
  const raw = error instanceof Error ? error.message : fallback
  return cleanAiFieldText(raw).replace(/^\[[^\]]+\]\s*/g, '').trim() || fallback
}

function normalizePlatformMode(value: unknown): ProjectPlatformMode | '' {
  const text = typeof value === 'string' ? value.trim() : ''
  return isProjectPlatformMode(text) ? text : ''
}

function normalizeBlockText(value: unknown): string {
  if (Array.isArray(value)) {
    return cleanAiStringArray(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ).join('\n')
  }

  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function buildCurrentBriefSummary(document: ProjectBriefDocument): string {
  return buildProjectBriefSummary(document) || '当前还没有可用的项目立项草稿。'
}

function buildProjectBriefPrompt(
  profile: Awaited<ReturnType<typeof buildStoryProfile>>,
  current: ProjectBriefDocument,
  mode: ProjectBriefGenerationRequest['mode'],
  requirements?: string,
): string {
  return renderPrompt([
    '你是中文小说项目策划。现在只补一份“Project Brief / 项目立项表”，不要代写剧情，不要扩写人物，不要输出世界观百科。',
    sectionLines('小说基础', [
      `小说：${profile.novelTitle}`,
      `题材：${profile.genre}`,
      profile.background ? `背景：${profile.background}` : '',
      profile.premiseSummary ? `基础设定：${profile.premiseSummary}` : '',
      profile.storyDesignSummary ? `故事设计：${profile.storyDesignSummary}` : '',
      profile.themeVoiceSummary ? `主题与文风：${profile.themeVoiceSummary}` : '',
    ]),
    section('当前立项草稿', buildCurrentBriefSummary(current)),
    current.platformMode
      ? sectionLines('当前平台设计约束', [
        `平台：${getPlatformDesignProfile(current.platformMode).label}`,
        `定位：${getPlatformDesignProfile(current.platformMode).positioning}`,
        `开局：${getPlatformDesignProfile(current.platformMode).openingFocus}`,
        `节奏：${getPlatformDesignProfile(current.platformMode).rhythmFocus}`,
        `质量门：${getPlatformDesignProfile(current.platformMode).qualityFocus.join('；')}`,
        `风险：${getPlatformDesignProfile(current.platformMode).riskFocus.join('；')}`,
      ])
      : '',
    requirements ? section('额外要求', requirements) : '',
    section('本轮目标', [
      mode === 'fill_blanks'
        ? '尽量沿用当前已有定位，重点补齐空白字段，不要推翻已经成立的产品方向。'
        : '给出一版完整、可执行、可直接进入后续设计页面的项目立项表。',
      '这份表只回答：面向谁、承诺什么、靠什么被点开、参考什么、什么绝对不能写偏。',
      '不要把主线剧情、章节推进和世界规则误写进 Brief。',
    ].join('\n')),
    section('字段要求', [
      '- platformMode 只能是 general / web_serial / fanqie / feilu / publishing 之一；选择番茄或飞卢后，后续设计必须服从对应平台策略。',
      '- targetAudience 写清赛道和内容形态，不要只写大类题材。',
      '- targetReader 写清阅读偏好、节奏预期、情绪需求。',
      '- readerPromise 写读者稳定能收到的体验回报。',
      '- sellingPoints 写 3-5 条可执行卖点，建议每行一条。',
      '- compTitles 写 2-4 个参考作品或对标方向，并注明借鉴点。',
      '- tabooRules 写必须避免的跑偏点、雷点或失真方式。',
      '- deliveryRhythm 写更新、单章回报、卷末回收或交付节奏。',
    ].join('\n')),
    section('上下文护栏', buildContextAlignmentRules({
      background: profile.background,
      storyCore: [profile.premiseSummary, profile.storyDesignSummary].filter(Boolean).join('\n\n'),
      worldSummary: profile.worldRulesSummary,
      taskFocus: '生成产品视角的立项表，而不是剧情摘要或设定百科。',
      extraLines: [
        '立项表必须能约束后面的主题、角色、线索和正文语言，避免变成空口号。',
      ],
    })),
    section('输出质量底线', buildOutputQualityRules([
      '所有字段都要尽量具体，能落到读者体验、内容结构或创作边界上。',
      '禁止出现空泛卖点，例如“情节精彩”“人物立体”“节奏紧凑”这种无执行信息的句子。',
    ])),
    section('语言要求', buildHumanLanguageRules([
      '用自然、具体、像编辑会写的中文，不要写成平台宣传语。',
      '优先给判断标准、读者感受和创作边界，不要堆抽象名词。',
    ])),
    '只输出 JSON，不要解释，不要 Markdown，不要代码块。',
    '{"platformMode":"fanqie","targetAudience":"","targetReader":"","readerPromise":"","sellingPoints":"每行一条","compTitles":"每行一条","tabooRules":"每行一条","deliveryRhythm":"每行一条"}',
  ])
}

function parseGeneratedProjectBrief(text: string): ProjectBriefDocument {
  const parsed = cleanAiValue(safeParseAiJson<Record<string, unknown>>(text, 'object'))

  return {
    platformMode: normalizePlatformMode(parsed.platformMode ?? parsed.platform_mode),
    targetAudience: normalizeBlockText(parsed.targetAudience ?? parsed.target_audience),
    targetReader: normalizeBlockText(parsed.targetReader ?? parsed.target_reader),
    readerPromise: normalizeBlockText(parsed.readerPromise ?? parsed.reader_promise),
    sellingPoints: normalizeBlockText(parsed.sellingPoints ?? parsed.selling_points),
    compTitles: normalizeBlockText(parsed.compTitles ?? parsed.comp_titles),
    tabooRules: normalizeBlockText(parsed.tabooRules ?? parsed.taboo_rules),
    deliveryRhythm: normalizeBlockText(parsed.deliveryRhythm ?? parsed.delivery_rhythm),
  }
}

export async function generateProjectBrief(
  request: ProjectBriefGenerationRequest,
): Promise<ProjectBriefGenerationResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, request.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(request.novelId)
  const current = parseProjectBriefDocument(novel.projectBriefJson)
  const step: ProjectBriefGenerationStepResult = {
    key: 'project_brief',
    label: '项目立项表',
    status: 'success',
  }

  try {
    const result = await runChatTask({
      type: 'project_brief_generate',
      novelId: request.novelId,
      modelConfigId: novel.modelConfigId || undefined,
      relatedEntityType: 'novel',
      relatedEntityId: request.novelId,
      messages: [{
        role: 'user',
        content: buildProjectBriefPrompt(profile, current, request.mode, request.requirements),
      }],
    })

    const document = parseGeneratedProjectBrief(result)
    const warnings = [
      document.platformMode ? '' : '未生成明确的目标平台，请保存前确认是番茄、飞卢、通用网文还是出版形态。',
      document.targetAudience ? '' : '目标赛道仍为空，后续角色和文风会缺少产品定位。',
      document.readerPromise ? '' : '读者承诺仍为空，建议补一条稳定体验回报。',
      document.sellingPoints ? '' : '卖点列表仍为空，建议至少补 3 条可执行卖点。',
      document.compTitles ? '' : '参考作品仍为空，建议补 2-4 个对标方向。',
    ].filter(Boolean)

    if (warnings.length > 0) {
      step.status = 'warning'
      step.warning = warnings.join('；')
    }

    return {
      ...document,
      steps: [step],
      warnings,
      hasPartialResult: Object.values(document).some(Boolean),
    }
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error)
    step.status = 'failed'
    step.error = errorMessage
    throw new Error(errorMessage)
  }
}
