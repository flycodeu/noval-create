import { eq } from 'drizzle-orm'
import type {
  ThemeVoiceGenerationRequest,
  ThemeVoiceGenerationResult,
  ThemeVoiceGenerationStepResult,
} from '../../src/shared/theme-voice-generation'
import type { ThemeVoiceDocument, ThemeVoicePov, ThemeVoiceTense } from '../../src/shared/theme-voice'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import {
  buildContextAlignmentRules,
  buildHumanLanguageRules,
  buildOutputQualityRules,
} from '../../src/shared/prompt-library'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { getDb } from '../database/db'
import { novels } from '../database/schema'
import { safeParseAiJson } from '../utils/json'
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

function normalizePov(value: unknown): ThemeVoicePov | '' {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === 'first_person' || text === 'third_limited' || text === 'third_omniscient' || text === 'multi_pov') {
    return text
  }
  return ''
}

function normalizeTense(value: unknown): ThemeVoiceTense | '' {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === 'past' || text === 'present' || text === 'mixed') return text
  return ''
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

function buildCurrentThemeVoiceSummary(document: ThemeVoiceDocument): string {
  const lines = [
    document.theme ? `主题：${document.theme}` : '',
    document.motifs ? `母题：${document.motifs}` : '',
    document.emotionalCore ? `情感核心：${document.emotionalCore}` : '',
    document.pov ? `视角：${document.pov}` : '',
    document.tense ? `时态：${document.tense}` : '',
    document.narratorDistance ? `叙述距离：${document.narratorDistance}` : '',
    document.voiceKeywords ? `口吻关键词：${document.voiceKeywords}` : '',
    document.styleRules ? `风格规则：${document.styleRules}` : '',
    document.dialogueRules ? `对白规则：${document.dialogueRules}` : '',
    document.descriptionRules ? `描写规则：${document.descriptionRules}` : '',
    document.forbiddenPhrases ? `禁用表达：${document.forbiddenPhrases}` : '',
  ].filter(Boolean)

  return lines.length > 0 ? lines.join('\n') : '当前还没有可用的主题与文风草稿。'
}

function buildThemeVoicePrompt(
  profile: Awaited<ReturnType<typeof buildStoryProfile>>,
  current: ThemeVoiceDocument,
  mode: ThemeVoiceGenerationRequest['mode'],
  requirements?: string,
): string {
  return renderPrompt([
    '你是中文小说的主题与文风设计师。现在只输出一份 Theme & Voice Bible，不要代写剧情，不要扩写世界观设定。',
    sectionLines('小说基础', [
      `小说：${profile.novelTitle}`,
      `题材：${profile.genre}`,
      profile.background ? `背景：${profile.background}` : '',
      profile.projectBriefSummary ? `项目立项：${profile.projectBriefSummary}` : '',
      profile.premiseSummary ? `基础设定：${profile.premiseSummary}` : '',
      profile.storyDesignSummary ? `故事设计：${profile.storyDesignSummary}` : '',
      profile.worldRulesSummary ? `世界规则：${profile.worldRulesSummary}` : '',
      `主角称呼：${profile.protagonistReference}`,
      `主角命名规则：${profile.protagonistRule}`,
    ]),
    section('当前主题与文风草稿', buildCurrentThemeVoiceSummary(current)),
    requirements ? section('额外要求', requirements) : '',
    section('本轮目标', [
      mode === 'fill_blanks'
        ? '尽量沿用当前已有风格方向，重点补齐空白字段，不要推翻已经成立的口吻边界。'
        : '给出一版可直接约束后续正文生成与修订的主题与文风圣经。',
      '这份文档的重点是：作品到底在持续表达什么、用什么视角和时态、正文怎样写、哪些表达绝对不能再出现。',
    ].join('\n')),
    section('字段要求', [
      '- theme 写作品持续回答的命题，不要写成宣传口号。',
      '- motifs 写 3-6 个会反复出现的意象、母题或回响。',
      '- emotionalCore 写读者最稳定收到的情绪回报。',
      '- pov 只能是 first_person / third_limited / third_omniscient / multi_pov。',
      '- tense 只能是 past / present / mixed。',
      '- narratorDistance 写叙述距离和解释密度。',
      '- voiceKeywords 写 4-8 个口吻关键词。',
      '- styleRules / dialogueRules / descriptionRules 都要写成可执行规则，建议每行一条。',
      '- forbiddenPhrases 写应避免的总结腔、模板句、引号强调、对称排比、空泛抒情等。',
    ].join('\n')),
    section('上下文护栏', buildContextAlignmentRules({
      background: profile.background,
      storyCore: [profile.projectBriefSummary, profile.premiseSummary, profile.storyDesignSummary].filter(Boolean).join('\n\n'),
      worldSummary: profile.worldRulesSummary,
      taskFocus: '固定主题、视角、时态和语言规则，减少 AI 味、总结腔和口吻漂移。',
      extraLines: [
        '文风规则必须能直接变成正文写作与修订时的硬约束。',
      ],
    })),
    section('输出质量底线', buildOutputQualityRules([
      '风格规则要写成动作和限制，不要写成“高级”“细腻”“有文学性”这种空形容词。',
      '对白规则要落到潜台词密度、句子长度、解释比例和人物区分度上。',
      '禁用表达要真能拦住 AI 口号腔、万能情绪句、总结收尾和无意义对仗。',
    ])),
    section('语言要求', buildHumanLanguageRules([
      '主题与文风说明要像真正的写作规范，不要写成海报文案。',
      '优先使用可执行、可判断、可回查的规则。',
      '如果需要给出禁用表达，优先写类型和模式，也可以补少量典型短句。',
    ])),
    '只输出 JSON，不要解释，不要 Markdown，不要代码块。',
    '{"theme":"","motifs":"每行一条","emotionalCore":"","pov":"third_limited","tense":"past","narratorDistance":"","voiceKeywords":"每行一条","styleRules":"每行一条","dialogueRules":"每行一条","descriptionRules":"每行一条","forbiddenPhrases":"每行一条"}',
  ])
}

function parseGeneratedThemeVoice(text: string): ThemeVoiceDocument {
  const parsed = cleanAiValue(safeParseAiJson<Record<string, unknown>>(text, 'object'))

  return {
    theme: normalizeBlockText(parsed.theme),
    motifs: normalizeBlockText(parsed.motifs),
    emotionalCore: normalizeBlockText(parsed.emotionalCore ?? parsed.emotional_core),
    pov: normalizePov(parsed.pov),
    tense: normalizeTense(parsed.tense),
    narratorDistance: normalizeBlockText(parsed.narratorDistance ?? parsed.narrator_distance),
    voiceKeywords: normalizeBlockText(parsed.voiceKeywords ?? parsed.voice_keywords),
    styleRules: normalizeBlockText(parsed.styleRules ?? parsed.style_rules),
    dialogueRules: normalizeBlockText(parsed.dialogueRules ?? parsed.dialogue_rules),
    descriptionRules: normalizeBlockText(parsed.descriptionRules ?? parsed.description_rules),
    forbiddenPhrases: normalizeBlockText(parsed.forbiddenPhrases ?? parsed.forbidden_phrases),
  }
}

export async function generateThemeVoice(
  request: ThemeVoiceGenerationRequest,
): Promise<ThemeVoiceGenerationResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, request.novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(request.novelId)
  const current = parseThemeVoiceDocument(novel.themeVoiceJson)
  const step: ThemeVoiceGenerationStepResult = {
    key: 'theme_voice',
    label: '主题与文风圣经',
    status: 'success',
  }

  try {
    const result = await runChatTask({
      type: 'theme_voice_generate',
      novelId: request.novelId,
      modelConfigId: novel.modelConfigId || undefined,
      relatedEntityType: 'novel',
      relatedEntityId: request.novelId,
      messages: [{
        role: 'user',
        content: buildThemeVoicePrompt(profile, current, request.mode, request.requirements),
      }],
    })

    const document = parseGeneratedThemeVoice(result)
    const warnings = [
      document.theme ? '' : '主题仍为空，建议补出作品持续回答的核心命题。',
      document.emotionalCore ? '' : '情感核心仍为空，建议补出稳定的情绪回报。',
      document.pov ? '' : '叙事视角仍为空，长篇很容易发生视角漂移。',
      document.tense ? '' : '时态仍为空，后续正文可能失去统一口径。',
      document.styleRules ? '' : '风格规则仍为空，建议至少补 4 条可执行规则。',
      document.dialogueRules ? '' : '对白规则仍为空，建议补出人物说话方式和潜台词规则。',
      document.forbiddenPhrases ? '' : '禁用表达仍为空，建议补一轮去 AI 腔规则。',
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
