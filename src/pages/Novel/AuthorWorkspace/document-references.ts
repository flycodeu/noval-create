import { documentFieldKey } from './content-document'

const REFERENCE_FIELDS: Record<string, string> = {
  factId: 'fact', allowedFactIds: 'fact', revealedFactIds: 'fact',
  requiredForeshadowIds: 'foreshadow', linkedForeshadowIds: 'foreshadow',
  servedThreadIds: 'thread', requiredCharacterArcIds: 'characterArc', requiredRelationshipArcIds: 'relationshipArc',
  requiredResistanceTrackIds: 'resistance', requiredEndgameCommitmentIds: 'commitment',
  characterId: 'character', characterIds: 'character', knownFromStartCharacterIds: 'character',
  readerKnownChapterId: 'chapter', protagonistKnownChapterId: 'chapter', knownChapterId: 'chapter',
  chapterStartId: 'chapter', chapterEndId: 'chapter', lastProgressChapterId: 'chapter',
  fromId: '*', toId: '*', parentId: 'location', requiredAssetRefs: '*', revealPayload: 'fact',
}
const REFERENCE_LABELS: Record<string, string> = {
  fact: '信息点', foreshadow: '伏笔', thread: '故事线', characterArc: '人物变化', relationshipArc: '关系变化',
  resistance: '阻力', commitment: '结局承诺', character: '人物', chapter: '章节', location: '地点', faction: '组织', item: '物品', event: '事件',
}

export function documentReferenceType(key: string): string | undefined {
  return REFERENCE_FIELDS[documentFieldKey(key)]
}

export function documentReferenceLabel(key: string, value: unknown, names: Record<string, string>): string | undefined {
  const field = documentFieldKey(key)
  const type = documentReferenceType(field)
  if (!type || value === '' || value == null) return undefined
  const raw = String(value)
  const explicit = raw.match(/^([a-zA-Z_]+):([\w-]+)$/)
  const id = raw.match(/^#?(\d+)$/)?.[1]
  // Reveal instructions and asset requirements may also contain ordinary prose.
  if ((field === 'revealPayload' || field === 'requiredAssetRefs') && !explicit && !id) return undefined
  const reference = !explicit && id && type === 'character' && names[`nativeCharacter:${id}`]
    ? `nativeCharacter:${id}` : explicit ? raw : id && type !== '*' ? `${type}:${id}` : raw
  return names[reference] || `关联${REFERENCE_LABELS[explicit?.[1] || type] || '资料'}不可用`
}

export function documentReferenceOptions(key: string, names: Record<string, string>, values: unknown[]) {
  const type = documentReferenceType(key)
  const numeric = values.some(value => typeof value === 'number') || !values.length && !['characterIds', 'knownFromStartCharacterIds', 'requiredAssetRefs', 'revealPayload', 'fromId', 'toId', 'parentId'].includes(documentFieldKey(key))
  const options: Array<{ value: string | number; label: string }> = []
  for (const [id, label] of Object.entries(names)) {
    const [namespace, suffix] = id.split(':')
    if (numeric) {
      // Atlas UUIDs and native row numbers are separate identities, even for the same person.
      if (namespace !== (type === 'character' ? 'nativeCharacter' : type) && !(type === 'character' && namespace === 'character' && !names[`nativeCharacter:${suffix}`])) continue
      if (!/^\d+$/.test(suffix) || !Number.isSafeInteger(Number(suffix)) || Number(suffix) <= 0) continue
      options.push({ value: Number(suffix), label })
    } else if (namespace !== 'nativeCharacter' && (type === '*' || namespace === type)) options.push({ value: id, label })
  }
  for (const value of values) {
    if (value == null || value === '') continue
    if (!options.some(option => option.value === value)) options.push({ value: value as string | number, label: documentReferenceLabel(key, value, names) || String(value) })
  }
  return options
}

/** All lookups stay scoped to the current novel; numeric IDs never share a namespace. */
export async function loadDocumentNames(novelId: number, reportFailure?: (message: string) => void): Promise<Record<string, string>> {
  const index = (type: string, rows: Array<{ id?: number; title: string }>) => Object.fromEntries(rows.filter(item => item.id != null).map(item => [`${type}:${item.id}`, item.title]))
  const sources = [
    { label: '人物与地图', read: async () => Object.fromEntries((await window.electron.storyAtlas.query({ novelId, includePlanned: true })).entities.map(item => [item.id, item.name])) },
    { label: '人物档案', read: async () => index('nativeCharacter', (await window.electron.character.list(novelId)).map(item => ({ id: item.id, title: item.fullName }))) },
    { label: '信息点', read: async () => index('fact', await window.electron.storyFact.list(novelId)) },
    { label: '伏笔', read: async () => index('foreshadow', await window.electron.foreshadow.listLedger(novelId, { readOnly: true })) },
    { label: '章节', read: async () => index('chapter', (await window.electron.chapter.list(novelId)).map(item => ({ id: item.id, title: `第 ${item.chapterNum} 章${item.title ? ` · ${item.title}` : ''}` }))) },
    { label: '故事线', read: async () => index('thread', await window.electron.thread.list(novelId)) },
    { label: '人物变化', read: async () => index('characterArc', (await window.electron.characterArc.listCharacterArcs(novelId)).map(item => ({ id: item.id, title: `${item.characterName} · 人物变化` }))) },
    { label: '关系变化', read: async () => index('relationshipArc', (await window.electron.characterArc.listRelationshipArcs(novelId)).map(item => ({ id: item.id, title: `${item.charAName}与${item.charBName}${item.relationLabelSnapshot ? ` · ${item.relationLabelSnapshot}` : ''}` }))) },
    { label: '阻力', read: async () => index('resistance', await window.electron.resistance.listTracks(novelId)) },
    { label: '结局承诺', read: async () => index('commitment', await window.electron.endgameAsset.listCommitments(novelId, { readOnly: true })) },
  ]
  const results = await Promise.allSettled(sources.map(source => source.read()))
  const names: Record<string, string> = {}
  const failed: string[] = []
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') Object.assign(names, result.value)
    else failed.push(sources[i].label)
  })
  if (failed.length) reportFailure?.(`${failed.join('、')}的关联名称读取失败，请重试。`)
  return names
}
