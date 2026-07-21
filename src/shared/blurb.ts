export interface NovelBlurbDocument {
  titleCandidates: string[]
  oneLineHook: string
  platformBlurbs: {
    qidian?: string
    tomato?: string
    feilu?: string
    publishing?: string
  }
  volumeNamingStyle: string
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

const EMPTY_BLURB: NovelBlurbDocument = {
  titleCandidates: [],
  oneLineHook: '',
  platformBlurbs: {},
  volumeNamingStyle: '',
}

export function parseNovelBlurbDocument(raw?: string | null): NovelBlurbDocument {
  if (!raw) return EMPTY_BLURB

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const platformBlurbsRaw = parsed.platform_blurbs ?? parsed.platformBlurbs
    const platformBlurbs = platformBlurbsRaw && typeof platformBlurbsRaw === 'object' && !Array.isArray(platformBlurbsRaw)
      ? platformBlurbsRaw as Record<string, unknown>
      : {}

    return {
      titleCandidates: asStringArray(parsed.title_candidates ?? parsed.titleCandidates),
      oneLineHook: asText(parsed.one_line_hook ?? parsed.oneLineHook),
      platformBlurbs: {
        qidian: asText(platformBlurbs.qidian),
        tomato: asText(platformBlurbs.tomato),
        feilu: asText(platformBlurbs.feilu),
        publishing: asText(platformBlurbs.publishing),
      },
      volumeNamingStyle: asText(parsed.volume_naming_style ?? parsed.volumeNamingStyle),
    }
  } catch {
    return EMPTY_BLURB
  }
}

export function buildNovelBlurbPayload(document: Partial<NovelBlurbDocument>, existingRaw?: string | null): string {
  const current = parseNovelBlurbDocument(existingRaw)
  const next: NovelBlurbDocument = {
    titleCandidates: document.titleCandidates ?? current.titleCandidates,
    oneLineHook: document.oneLineHook ?? current.oneLineHook,
    platformBlurbs: {
      qidian: document.platformBlurbs?.qidian ?? current.platformBlurbs.qidian,
      tomato: document.platformBlurbs?.tomato ?? current.platformBlurbs.tomato,
      feilu: document.platformBlurbs?.feilu ?? current.platformBlurbs.feilu,
      publishing: document.platformBlurbs?.publishing ?? current.platformBlurbs.publishing,
    },
    volumeNamingStyle: document.volumeNamingStyle ?? current.volumeNamingStyle,
  }

  return JSON.stringify({
    title_candidates: next.titleCandidates.map((item) => item.trim()).filter(Boolean),
    one_line_hook: next.oneLineHook.trim(),
    platform_blurbs: {
      qidian: next.platformBlurbs.qidian?.trim() || undefined,
      tomato: next.platformBlurbs.tomato?.trim() || undefined,
      feilu: next.platformBlurbs.feilu?.trim() || undefined,
      publishing: next.platformBlurbs.publishing?.trim() || undefined,
    },
    volume_naming_style: next.volumeNamingStyle.trim(),
  })
}
