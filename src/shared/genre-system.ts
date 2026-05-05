export type GenreRulePackKey =
  | 'generic'
  | 'zombie'
  | 'wuxia'
  | 'historical'
  | 'xianxia'
  | 'fantasy'
  | 'modern-mystery'
  | 'urban-ability'
  | 'western-fantasy'

export interface GenreProfile {
  key: GenreRulePackKey
  name: string
  subgenre: string
  worldviewTone: string
  socialFrame: string
  narrativeFocus: string[]
  languageAvoidances: string[]
}

export interface PowerSystem {
  id: string
  name: string
  appliesTo: string[]
  levels: string[]
  advancementRule: string
  limitations: string
  cost: string
  taboo: string
}

export interface SpeciesProfile {
  id: string
  name: string
  entityType: string
  summary: string
  traits: string[]
  commonIdentities: string[]
  relationToHumans: string
  storyUse: string
}

export interface FactionProfile {
  id: string
  name: string
  factionType: string
  summary: string
  structure: string
  resources: string
  externalRelations: string
  recruitFrom: string
  notableSites: string[]
}

export interface CharacterEcologySlot {
  id: string
  label: string
  entityType: string
  species: string
  narrativeFunction: string
  contextLink: string
  preferredFactions: string[]
  powerBias: string[]
}

export interface MapBlueprintLevel {
  depth: number
  label: string
  nodeTypes: string[]
  relationHint: string
  suggestedCount: number
  examples: string[]
}

export interface MapBlueprint {
  overview: string
  levels: MapBlueprintLevel[]
}

export interface ClimateCycle {
  id: string
  region: string
  pattern: string
  seasonalShift: string
  hazardTrigger: string
  travelImpact: string
  resourceImpact: string
}

export interface EconomyLoop {
  id: string
  name: string
  coreResource: string
  circulationPath: string
  controller: string
  scarcityTrigger: string
  volatilityTrigger: string
  storyUse: string
}

export interface WorldDynamics {
  overview: string
  climateCycles: ClimateCycle[]
  economyLoops: EconomyLoop[]
}

export type TimelineCalendarType =
  | 'gregorian'
  | 'regnal'
  | 'relative-disaster'
  | 'custom-era'
  | 'future-date'

export interface TimelineConfig {
  calendarType: TimelineCalendarType
  eraName: string
  epochLabel: string
  baseYearLabel: string
  displayPattern: string
  relativeZeroLabel: string
  recommendedEventTypes: string[]
  precisionOptions: string[]
}

export type RealismLevel = 'strict-realism' | 'rule-realism' | 'stylized-fantasy'

export interface WritingConstraints {
  antiQuoteEmphasis: boolean
  antiConceptSlogans: boolean
  antiSymmetricLines: boolean
  narrationStyle: string
  dialogueStyle: string
  forbiddenPhrases: string[]
  extraRules: string[]
  realismLevel: RealismLevel
  sciencePolicy: string
  physicsPolicy: string
  commonSenseFocus: string[]
  contextAlignmentFocus: string[]
}

export interface CharacterEcology {
  overview: string
  slots: CharacterEcologySlot[]
}

export interface GenreWorldRules {
  version: 2
  genreProfile: GenreProfile
  powerSystems: PowerSystem[]
  speciesSystem: SpeciesProfile[]
  factionSystem: FactionProfile[]
  characterEcology: CharacterEcology
  mapBlueprint: MapBlueprint
  worldDynamics: WorldDynamics
  timelineConfig: TimelineConfig
  writingConstraints: WritingConstraints
}

export type HistoricalGroundingMode =
  | 'none'
  | 'historical_realist'
  | 'alternate_history'
  | 'pseudo_historical_fantasy'

export type HistoricalGroundingStrictness = 'none' | 'high' | 'medium' | 'low'
export type HistoricalGroundingCoverage = 'none' | 'partial' | 'grounded'

export interface HistoricalGroundingAssessment {
  mode: HistoricalGroundingMode
  strictness: HistoricalGroundingStrictness
  coverage: HistoricalGroundingCoverage
  conservativeFallbackActive: boolean
  sourceSignals: string[]
  missingSignals: string[]
  summary: string
}

type GenreWorldRuleSeed = Omit<GenreWorldRules, 'timelineConfig' | 'worldDynamics'> & {
  timelineConfig?: TimelineConfig
  worldDynamics?: WorldDynamics
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value)
  return fallback
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const text = asText(value)
  if (!text) return []
  return text
    .split(/[\n,，、]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function normalizeArray<T>(
  value: unknown,
  fallback: T[],
  normalizer: (item: unknown, index: number) => T | null,
): T[] {
  if (!Array.isArray(value)) return clone(fallback)
  const result = value
    .map((item, index) => normalizer(item, index))
    .filter((item): item is T => Boolean(item))
  return result.length > 0 ? result : clone(fallback)
}

interface WritingRealityOptions {
  realismLevel: RealismLevel
  sciencePolicy: string
  physicsPolicy: string
  commonSenseFocus: string[]
  contextAlignmentFocus: string[]
}

const REALISM_LEVEL_LABELS: Record<RealismLevel, string> = {
  'strict-realism': '\u4e25\u683c\u5199\u5b9e',
  'rule-realism': '\u89c4\u5219\u5199\u5b9e',
  'stylized-fantasy': '\u98ce\u683c\u5316\u5e7b\u60f3',
}

function getDefaultRealityOptions(packKey: GenreRulePackKey): WritingRealityOptions {
  switch (packKey) {
    case 'historical':
      return {
        realismLevel: 'strict-realism',
        sciencePolicy: '制度、官称、器物、交通、饮食和地理尺度默认按时代常识处理，未确认时使用保守表达。',
        physicsPolicy: '行军、传信、伤病恢复、舟车速度和物资调度必须服从时代成本与地理条件。',
        commonSenseFocus: ['官制礼法', '时代器物', '地理尺度', '交通脚程', '军政后勤', '身份秩序', '措辞时代感'],
        contextAlignmentFocus: ['王朝结构', '地域差异', '分歧设定', '制度约束', '人物身份', '事件纪年'],
      }
    case 'zombie':
      return {
        realismLevel: 'strict-realism',
        sciencePolicy: '\u611f\u67d3\u3001\u4f24\u75c5\u3001\u836f\u7269\u548c\u8865\u7ed9\u6309\u73b0\u5b9e\u5e38\u8bc6\u5904\u7406\u3002',
        physicsPolicy: '\u79fb\u52a8\u3001\u566a\u58f0\u3001\u8d1f\u91cd\u548c\u5efa\u7b51\u7834\u574f\u9075\u5b88\u73b0\u5b9e\u56e0\u679c\u3002',
        commonSenseFocus: ['\u611f\u67d3\u4f20\u64ad', '\u4f24\u75c5\u6062\u590d', '\u8d44\u6e90\u6d88\u8017', '\u7fa4\u4f53\u7eaa\u5f8b', '\u64a4\u79bb\u8def\u7ebf', '\u8865\u7ed9\u5206\u914d'],
        contextAlignmentFocus: ['\u57fa\u5730\u79e9\u5e8f', '\u5e78\u5b58\u8005\u5173\u7cfb', '\u5730\u7406\u5c01\u9501', '\u7269\u8d44\u6765\u6e90', '\u98ce\u9669\u627f\u62c5'],
      }
    case 'wuxia':
      return {
        realismLevel: 'rule-realism',
        sciencePolicy: '没有修仙式奇迹，武学、药理、马力、武器和行旅逻辑要尽量符合江湖常识与时代背景。',
        physicsPolicy: '招式距离、伤势恢复、追杀路线和地形影响要有实际代价。',
        commonSenseFocus: ['伤病代价', '赶路脚程', '银钱余粮', '门规师承', '官面压力', '名声后果', '兵器适配'],
        contextAlignmentFocus: ['江湖秩序', '师门恩怨', '地域路线', '追捕与寻仇', '重要决定', '人情旧债'],
      }
    case 'xianxia':
      return {
        realismLevel: 'rule-realism',
        sciencePolicy: '\u8d85\u81ea\u7136\u53ef\u4ee5\u5b58\u5728\uff0c\u4f46\u5fc5\u987b\u670d\u4ece\u65e2\u5b9a\u4fee\u70bc\u4f53\u7cfb\u548c\u4ee3\u4ef7\u3002',
        physicsPolicy: '\u51e1\u4fd7\u5c42\u9762\u4fdd\u6301\u81ea\u6d3d\uff0c\u8d85\u5e38\u6548\u679c\u8981\u6709\u5883\u754c\u3001\u6cd5\u95e8\u6216\u5a92\u4ecb\u652f\u6491\u3002',
        commonSenseFocus: ['\u5883\u754c\u5dee\u8ddd', '\u8d44\u6e90\u4ee3\u4ef7', '\u5b97\u95e8\u793c\u6cd5', '\u95ed\u5173\u5468\u671f', '\u56e0\u679c\u62a5\u5e94', '\u8eab\u4efd\u79e9\u5e8f'],
        contextAlignmentFocus: ['\u5b97\u95e8\u4f53\u7cfb', '\u529f\u6cd5\u6765\u6e90', '\u79d8\u5883\u89c4\u5219', '\u4eba\u7269\u4fee\u4e3a', '\u52bf\u529b\u5229\u76ca'],
      }
    case 'fantasy':
      return {
        realismLevel: 'rule-realism',
        sciencePolicy: '\u5141\u8bb8\u865a\u6784\u529b\u91cf\uff0c\u4f46\u7b49\u7ea7\u3001\u8840\u8109\u3001\u6cd5\u5668\u548c\u8d44\u6e90\u8981\u524d\u540e\u4e00\u81f4\u3002',
        physicsPolicy: '\u6218\u6597\u3001\u8ffd\u9010\u3001\u7834\u574f\u8303\u56f4\u548c\u6062\u590d\u901f\u5ea6\u8981\u4e0e\u4eba\u7269\u7b49\u7ea7\u3001\u88c5\u5907\u548c\u573a\u5730\u5339\u914d\u3002',
        commonSenseFocus: ['\u7b49\u7ea7\u5dee\u8ddd', '\u6218\u6597\u4ee3\u4ef7', '\u8d44\u6e90\u4e89\u593a', '\u52bf\u529b\u53cd\u5e94', '\u9057\u8ff9\u98ce\u9669', '\u8eab\u4efd\u540e\u679c'],
        contextAlignmentFocus: ['\u529b\u91cf\u4f53\u7cfb', '\u9635\u8425\u5173\u7cfb', '\u6210\u957f\u8def\u5f84', '\u5173\u952e\u8d44\u6e90', '\u5730\u56fe\u5c42\u7ea7'],
      }
    case 'modern-mystery':
      return {
        realismLevel: 'strict-realism',
        sciencePolicy: '\u73b0\u4ee3\u60ac\u7591\u9ed8\u8ba4\u4e0d\u5f15\u5165\u8d85\u81ea\u7136\u3001\u9ed1\u79d1\u6280\u6377\u5f84\u6216\u4e07\u80fd\u4fa6\u67e5\u624b\u6bb5\uff0c\u8c03\u67e5\u3001\u6cd5\u533b\u3001\u76d1\u63a7\u3001\u901a\u8baf\u3001\u5a92\u4f53\u4e0e\u884c\u653f\u6d41\u7a0b\u6309\u73b0\u5b9e\u5e38\u8bc6\u5904\u7406\u3002',
        physicsPolicy: '\u8def\u7a0b\u3001\u4f24\u52bf\u3001\u76d1\u63a7\u8986\u76d6\u3001\u8bc1\u636e\u7559\u5b58\u3001\u8bbf\u95ee\u6743\u9650\u548c\u884c\u52a8\u98ce\u9669\u90fd\u8981\u6709\u73b0\u5b9e\u4ee3\u4ef7\uff0c\u4e0d\u80fd\u9760\u4e00\u53e5\u8bdd\u8df3\u8fc7\u3002',
        commonSenseFocus: ['\u65f6\u95f4\u7ebf\u6821\u5bf9', '\u8bc1\u636e\u94fe', '\u76d1\u63a7\u75d5\u8ff9', '\u8bbf\u95ee\u6743\u9650', '\u5730\u65b9\u5173\u7cfb', '\u8206\u8bba\u98ce\u9669', '\u4f24\u52bf\u6062\u590d', '\u884c\u52a8\u6210\u672c'],
        contextAlignmentFocus: ['\u65e7\u6848\u4e0e\u5f53\u4e0b\u7684\u8fde\u63a5', '\u673a\u6784\u963b\u529b', '\u5730\u65b9\u884c\u4e1a\u7eb9\u7406', '\u4fe1\u606f\u4e0d\u5bf9\u79f0', '\u77e5\u60c5\u4eba\u6c89\u9ed8', '\u73b0\u5b9e\u5730\u7406\u95ed\u73af'],
      }
    case 'urban-ability':
      return {
        realismLevel: 'rule-realism',
        sciencePolicy: '\u73b0\u4ee3\u793e\u4f1a\u90e8\u5206\u5148\u9075\u5b88\u73b0\u5b9e\u5e38\u8bc6\uff0c\u5f02\u80fd\u90e8\u5206\u5fc5\u987b\u6709\u89e6\u53d1\u6761\u4ef6\u548c\u526f\u4f5c\u7528\u3002',
        physicsPolicy: '\u65e5\u5e38\u884c\u52a8\u3001\u76d1\u63a7\u75d5\u8ff9\u3001\u4f24\u52bf\u4e0e\u6267\u6cd5\u53cd\u5e94\u6309\u73b0\u5b9e\u5904\u7406\u3002',
        commonSenseFocus: ['\u8eab\u4efd\u4f2a\u88c5', '\u76d1\u63a7\u53d6\u8bc1', '\u526f\u4f5c\u7528', '\u8206\u8bba\u98ce\u9669', '\u7ec4\u7ec7\u89c4\u7a0b', '\u751f\u6d3b\u538b\u529b'],
        contextAlignmentFocus: ['\u90fd\u5e02\u65e5\u5e38', '\u5f02\u80fd\u7ec4\u7ec7', '\u793e\u4f1a\u89c4\u5219', '\u6848\u4ef6\u7ebf\u7d22', '\u66b4\u9732\u540e\u679c'],
      }
    case 'western-fantasy':
      return {
        realismLevel: 'rule-realism',
        sciencePolicy: '\u5141\u8bb8\u9b54\u6cd5\u548c\u795e\u672f\uff0c\u4f46\u65bd\u6cd5\u6765\u6e90\u3001\u4eea\u5f0f\u6750\u6599\u548c\u79cd\u65cf\u5929\u8d4b\u5fc5\u987b\u4e00\u81f4\u3002',
        physicsPolicy: '\u666e\u901a\u4eba\u7684\u4f53\u80fd\u3001\u884c\u519b\u3001\u56f4\u57ce\u548c\u4f24\u4ea1\u9075\u5b88\u5e38\u8bc6\uff0c\u8d85\u5e38\u73b0\u8c61\u9700\u8981\u9636\u4f4d\u6216\u4eea\u5f0f\u652f\u6491\u3002',
        commonSenseFocus: ['\u9636\u5c42\u793c\u6cd5', '\u519b\u653f\u540e\u52e4', '\u65bd\u6cd5\u4ee3\u4ef7', '\u4fe1\u4ef0\u79e9\u5e8f', '\u79cd\u65cf\u5173\u7cfb', '\u9886\u5730\u6cbb\u7406'],
        contextAlignmentFocus: ['\u738b\u56fd\u7ed3\u6784', '\u6559\u4f1a\u6743\u529b', '\u6cd5\u672f\u6765\u6e90', '\u76df\u7ea6\u4ec7\u6028', '\u5730\u56fe\u4ea4\u901a'],
      }
    case 'generic':
    default:
      return {
        realismLevel: 'rule-realism',
        sciencePolicy: '\u672a\u660e\u786e\u5141\u8bb8\u8d85\u5e38\u73b0\u8c61\u65f6\uff0c\u9ed8\u8ba4\u9075\u5b88\u73b0\u5b9e\u5e38\u8bc6\u548c\u793e\u4f1a\u903b\u8f91\u3002',
        physicsPolicy: '\u4e8b\u4ef6\u63a8\u8fdb\u3001\u79fb\u52a8\u3001\u4f24\u52bf\u548c\u8d44\u6e90\u6d88\u8017\u8981\u6709\u53ef\u9a8c\u8bc1\u7684\u4ee3\u4ef7\u3002',
        commonSenseFocus: ['\u56e0\u679c\u94fe', '\u4ee3\u4ef7\u627f\u62c5', '\u4eba\u7269\u52a8\u673a', '\u8d44\u6e90\u9650\u5236', '\u884c\u52a8\u6761\u4ef6', '\u7ec4\u7ec7\u53cd\u5e94'],
        contextAlignmentFocus: ['\u80cc\u666f\u8bbe\u5b9a', '\u4e3b\u9898\u65b9\u5411', '\u4eba\u7269\u5173\u7cfb', '\u4e16\u754c\u89c4\u5219', '\u65f6\u95f4\u987a\u5e8f'],
      }
  }
}

export function describeRealismLevel(level: RealismLevel): string {
  return REALISM_LEVEL_LABELS[level] || '\u89c4\u5219\u5199\u5b9e'
}

function createWritingConstraints(
  narrationStyle: string,
  dialogueStyle: string,
  forbiddenPhrases: string[],
  extraRules: string[],
  options: Partial<WritingRealityOptions> = {},
): WritingConstraints {
  const reality = {
    ...getDefaultRealityOptions('generic'),
    ...options,
  }

  return {
    antiQuoteEmphasis: true,
    antiConceptSlogans: true,
    antiSymmetricLines: true,
    narrationStyle,
    dialogueStyle,
    forbiddenPhrases,
    extraRules,
    realismLevel: reality.realismLevel,
    sciencePolicy: reality.sciencePolicy,
    physicsPolicy: reality.physicsPolicy,
    commonSenseFocus: dedupe(reality.commonSenseFocus).slice(0, 8),
    contextAlignmentFocus: dedupe(reality.contextAlignmentFocus).slice(0, 8),
  }
}

function createTimelineConfig(
  calendarType: TimelineCalendarType,
  overrides: Partial<TimelineConfig> = {},
): TimelineConfig {
  return {
    calendarType,
    eraName: '',
    epochLabel: '',
    baseYearLabel: '',
    displayPattern: '',
    relativeZeroLabel: '',
    recommendedEventTypes: [],
    precisionOptions: [],
    ...overrides,
  }
}

function createWorldDynamics(
  overview: string,
  climateCycles: ClimateCycle[],
  economyLoops: EconomyLoop[],
): WorldDynamics {
  return {
    overview,
    climateCycles,
    economyLoops,
  }
}

function getDefaultWorldDynamics(packKey: GenreRulePackKey): WorldDynamics {
  switch (packKey) {
    case 'historical':
      return createWorldDynamics(
        '历史叙事要让税赋、军政、礼制、地理和交通持续改变人物的行动空间，而不是只做时代装饰。',
        [
          {
            id: 'historical-regions',
            region: '州府、郡县、边镇、驿路与漕运节点',
            pattern: '农时、汛期、战时征发与边境戒严会周期性改变地方秩序和行动成本。',
            seasonalShift: '春耕秋收、汛期封渡、冬雪断道和灾荒迁徙会改变军政与民生压力。',
            hazardTrigger: '饥荒、兵灾、河患、疫病、边患、征役失衡或地方豪强坐大。',
            travelImpact: '决定官道、驿站、水路、边关和民间私路的通行效率与风险。',
            resourceImpact: '影响粮价、盐铁、军械、马匹、布帛和地方财政调度能力。',
          },
        ],
        [
          {
            id: 'historical-tax',
            name: '赋税与军需循环',
            coreResource: '粮食、盐铁、马匹、布帛、铜钱、漕运和情报文书。',
            circulationPath: '州县田赋/作坊/商路 -> 仓储/驿站/军府 -> 官署、军营、地方豪强与边镇。',
            controller: '朝廷中枢、州县官署、地方豪强、军镇体系与商旅网络。',
            scarcityTrigger: '灾荒、战事、封路、贪腐、苛征或边贸中断。',
            volatilityTrigger: '政局更替、军费暴涨、漕运失守、税制变动或分歧设定落地。',
            storyUse: '把家国、朝局、宗族和个人命运落到真实的赋役、军需、路程与名分压力上。',
          },
        ],
      )
    case 'zombie':
      return createWorldDynamics(
        '气候变化、灾后基础设施和补给循环会直接改变生存区的秩序、移动半径和资源争夺强度。',
        [
          {
            id: 'zombie-season',
            region: '主要活动城市与外围撤离带',
            pattern: '四季分明或冷热骤变，雨季和寒潮都会放大生存压力。',
            seasonalShift: '暴雨、酷暑、寒潮会改变尸体腐败速度、夜间活动窗口和外出频率。',
            hazardTrigger: '暴雨断电、严寒停摆、台风封路、夏季疫病扩散。',
            travelImpact: '极端天气会切断撤离路线、放大噪声风险，并迫使队伍改走高风险补给线。',
            resourceImpact: '天气变化会影响燃料、药品、净水、保暖物资和粮食保存效率。',
          },
        ],
        [
          {
            id: 'zombie-supply',
            name: '灾后补给链',
            coreResource: '粮食、药品、燃料、弹药、发电与净水设备。',
            circulationPath: '仓储点/医院/商超残余 -> 搜集队 -> 据点仓库 -> 前线与伤员。',
            controller: '据点管理层、武装队伍、黑市团伙和运输节点守卫者。',
            scarcityTrigger: '封路、尸潮、内斗、伤员激增或天气突变。',
            volatilityTrigger: '路线失守、仓库暴露、配给冲突或外来势力抢夺。',
            storyUse: '决定谁能活、谁要迁移、谁会背叛，也决定队伍是否还能维持纪律与信任。',
          },
        ],
      )
    case 'wuxia':
      return createWorldDynamics(
        '江湖不是静态背景，季节、河运、官道和银钱流向都会改变赶路节奏、追杀压力和门派生意。',
        [
          {
            id: 'wuxia-routes',
            region: '州府、山道、镖路与水路节点',
            pattern: '春汛、暑热、秋收、寒冬会改变不同路线的通行难度。',
            seasonalShift: '汛期河道危险、冬季山道封雪、夏季疫病和秋收忙闲都会影响江湖行动。',
            hazardTrigger: '洪水、山体塌方、雪封古道、疫病流行和旱灾。',
            travelImpact: '影响押镖、追杀、渡口停留和门派之间的支援速度。',
            resourceImpact: '药材、粮价、马匹和兵器材料会因季节与产地变化而波动。',
          },
        ],
        [
          {
            id: 'wuxia-silver',
            name: '银钱与漕运链',
            coreResource: '银两、药材、粮食、兵器材料、马匹和消息网。',
            circulationPath: '产地/商路/渡口 -> 镖局/商号 -> 州府/门派/黑市。',
            controller: '商号、镖局、地方豪强、漕运势力和官面关系人。',
            scarcityTrigger: '封河、抄家、兵乱、旱涝和门派冲突。',
            volatilityTrigger: '漕运断线、镖物失手、黑市涨价或官府突然严查。',
            storyUse: '让势力争斗从“面子”落到“银钱、药材、脚程和人情债”这些真实压力上。',
          },
        ],
      )
    case 'xianxia':
      return createWorldDynamics(
        '修真世界的天象、灵气潮汐和坊市流通必须长期波动，否则资源争夺、闭关压力和宗门秩序都会失真。',
        [
          {
            id: 'xianxia-aura',
            region: '宗门山门、灵脉节点、凡俗边境与秘境入口',
            pattern: '灵气浓淡、节令更替和天象异动会周期性改变修炼与出行条件。',
            seasonalShift: '灵潮涨落、寒月封山、火脉躁动、秘境开合与妖兽迁徙会同步变化。',
            hazardTrigger: '灵脉枯竭、天火、寒潮、兽潮、秘境乱流或瘴气扩散。',
            travelImpact: '决定御器/传送成本、闭关窗口、历练路线和宗门边防压力。',
            resourceImpact: '灵草成熟期、矿脉产出、丹药价格和坊市供给会随天象与灵潮改变。',
          },
        ],
        [
          {
            id: 'xianxia-market',
            name: '灵石与修行资源循环',
            coreResource: '灵石、丹药、法器材料、秘境名额、功法与情报。',
            circulationPath: '矿脉/秘境/宗门库房 -> 坊市/拍卖会 -> 内门/散修/家族网络。',
            controller: '宗门执事、商盟、世家、黑市和守矿势力。',
            scarcityTrigger: '灵脉衰竭、宗门封锁、秘境关闭、炼丹失误或大战消耗。',
            volatilityTrigger: '秘境异变、拍卖垄断、矿脉争夺、师门配额调整或大能出手。',
            storyUse: '把境界推进、师承压力和阵营矛盾落到持续可写的修行资源张力上。',
          },
        ],
      )
    case 'fantasy':
      return createWorldDynamics(
        '奇幻世界的季节、地貌和贸易线会决定军政反应、冒险窗口和资源占有，不应只剩风景描写。',
        [
          {
            id: 'fantasy-frontier',
            region: '边境、遗迹带、王国腹地与荒野通路',
            pattern: '季节分区明显，不同气候带会周期性改变边境压力和探索成本。',
            seasonalShift: '冬季封路、春季解冻、雨季泥泞和旱季缺水会改变行军与补给。',
            hazardTrigger: '暴雪、沼泽外溢、旱灾、林火、兽潮或魔潮扰动。',
            travelImpact: '影响远征、护送、边防调度和遗迹探索成功率。',
            resourceImpact: '粮食、木材、矿石、药材和魔法材料的产出随季节波动。',
          },
        ],
        [
          {
            id: 'fantasy-goods',
            name: '军需与奇物流通链',
            coreResource: '粮食、铁矿、木材、坐骑、法材、遗迹产物和雇佣兵资金。',
            circulationPath: '产地/边境据点 -> 城镇市场/公会 -> 军团/领主/冒险者。',
            controller: '领主、商会、公会、军团后勤与边境守备力量。',
            scarcityTrigger: '战争征用、边境失守、盗匪袭击、魔潮和歉收。',
            volatilityTrigger: '通路关闭、税赋调整、公会垄断或遗迹产出突增突减。',
            storyUse: '让战争、探险和阵营争夺能持续体现后勤、税负和资源分配的现实后果。',
          },
        ],
      )
    case 'modern-mystery':
      return createWorldDynamics(
        '现代悬疑也需要环境和经济纹理，天气、产业景气和地方物流常常决定线索保存方式、行动窗口和遮掩成本。',
        [
          {
            id: 'mystery-weather',
            region: '城市城区、老厂区、沿江/沿海地带和郊县通路',
            pattern: '现实天气与季节变化要能影响现场状态、出行成本和监控盲区。',
            seasonalShift: '梅雨、寒潮、高温、台风和枯水期会改变现场保存、取证难度和人流密度。',
            hazardTrigger: '暴雨积水、停电、厂区废气、雾天封路和河道涨落。',
            travelImpact: '影响走访路线、值班节奏、监控可视性和夜间行动风险。',
            resourceImpact: '影响物流速度、旧厂运转、维修成本和地方就业稳定性。',
          },
        ],
        [
          {
            id: 'mystery-industry',
            name: '地方产业与利益链',
            coreResource: '现金流、旧厂资产、土地开发、货运线路、医疗与信息渠道。',
            circulationPath: '地方企业/园区/物流站 -> 地方机构/承包商/媒体关系网 -> 当事人家庭与案发现场。',
            controller: '企业管理层、地方关系人、物流节点和灰色承包链。',
            scarcityTrigger: '企业转型、停工、欠薪、事故、征地和资金断裂。',
            volatilityTrigger: '媒体曝光、项目停摆、审计追查、极端天气或政策调整。',
            storyUse: '把旧案遮掩、证据去向、沉默成本和地方互保写成可追踪的现实利益链。',
          },
        ],
      )
    case 'urban-ability':
      return createWorldDynamics(
        '都市异能的动态压力不仅来自能力体系，还来自城市天气、能源消耗和地下市场的异常流通。',
        [
          {
            id: 'urban-anomaly-weather',
            region: '城市商业区、旧城区、封锁点与异常高发区',
            pattern: '常规天气与异常波动叠加，暴雨、热浪、停电和磁暴会影响异常活动频率。',
            seasonalShift: '台风季、酷暑、寒潮和节假日人流峰值都会改变异常暴露与封锁成本。',
            hazardTrigger: '暴雨内涝、停电、异常能量泄漏、地铁拥堵和大面积通讯失灵。',
            travelImpact: '影响撤离路线、监控覆盖、秘密运输和收容效率。',
            resourceImpact: '影响电力、冷链、实验物资、黑市样本和城市物资调配。',
          },
        ],
        [
          {
            id: 'urban-black-market',
            name: '异常资源与地下交易链',
            coreResource: '样本、药剂、芯片、封存器具、身份掩护和情报。',
            circulationPath: '实验室/封存点/地下渠道 -> 中间商 -> 异能组织/资本集团/行动人员。',
            controller: '调查机构、资本集团、地下掮客和黑市物流网络。',
            scarcityTrigger: '封锁升级、样本损毁、监管收紧、城市停摆或供货源被清除。',
            volatilityTrigger: '异常事件曝光、组织清洗、价格垄断或大规模停电。',
            storyUse: '把能力争夺落到现实城市的供给、监管和生活代价上，而不是只剩数值升级。',
          },
        ],
      )
    case 'western-fantasy':
      return createWorldDynamics(
        '西幻秩序要靠季节、税赋、教会调度和军政后勤支撑，气候与经济必须持续改变王国与边境的力量平衡。',
        [
          {
            id: 'western-harvest',
            region: '王国腹地、山地边境、港口与教区路线',
            pattern: '播种、收获、严冬和雨季会改变领地治理与战争节奏。',
            seasonalShift: '冬季封山、春季泥泞、秋收与海风季会重塑行军和海运窗口。',
            hazardTrigger: '暴雪、歉收、洪涝、疫病、山火和魔物迁徙。',
            travelImpact: '影响边境增援、朝圣路线、商旅护送和围城补给。',
            resourceImpact: '影响粮税、铁料、木材、仪式材料和港口周转能力。',
          },
        ],
        [
          {
            id: 'western-levy',
            name: '税赋与军需流通链',
            coreResource: '粮食、税赋、铁料、马匹、神术材料和雇佣军薪金。',
            circulationPath: '农庄/矿场/港口 -> 领主仓库/教会/公会 -> 军团/法师塔/边境要塞。',
            controller: '领主、教会、商会、公会与边境军需官。',
            scarcityTrigger: '歉收、封港、叛乱、围城、宗教冲突或龙灾。',
            volatilityTrigger: '税制调整、王位争夺、海运中断、教会禁令或边防战事。',
            storyUse: '让王国政治、教会影响和战争准备都能落实到税、粮、铁和交通线上。',
          },
        ],
      )
    case 'generic':
    default:
      return createWorldDynamics(
        '环境变化和经济流通都必须能改变人物的行动边界，而不是停留在资料设定。',
        [
          {
            id: 'generic-climate',
            region: '主要活动区域',
            pattern: '先定义常态气候、季节节律与地理差异，再决定人物默认行动成本。',
            seasonalShift: '至少要说明哪些月份/阶段更适合远行、战争、闭关、调查或生产。',
            hazardTrigger: '暴雨、严寒、干旱、瘴气、沙暴或地脉异动这类极端变化何时出现。',
            travelImpact: '天气变化要影响路程、信息传递、追兵速度、补给线和现场条件。',
            resourceImpact: '气候必须改变粮食、能源、药材、矿物或其他关键资源的产出与保存。',
          },
        ],
        [
          {
            id: 'generic-economy',
            name: '主要流通链',
            coreResource: '写清本世界最关键的可流通资源、货币或身份筹码。',
            circulationPath: '说明资源从产地/源头如何流向中转、市场、势力和主角所在场景。',
            controller: '指出谁掌握税赋、配给、仓储、运输、黑市或情报渠道。',
            scarcityTrigger: '说明哪些战争、天气、制度或人为事件会制造紧缺。',
            volatilityTrigger: '说明哪些封锁、事故、政变或路线中断会快速拉高成本。',
            storyUse: '让资源流通链能够持续制造行动门槛、阵营摩擦和剧情选择压力。',
          },
        ],
      )
  }
}

function getDefaultTimelineConfig(packKey: GenreRulePackKey): TimelineConfig {
  switch (packKey) {
    case 'historical':
      return createTimelineConfig('regnal', {
        eraName: '朝代纪年',
        epochLabel: '年号',
        baseYearLabel: '元年',
        displayPattern: '某朝某年 / 某月 / 某次政变后',
        relativeZeroLabel: '故事开篇前',
        recommendedEventTypes: ['登基', '改制', '征调', '封赏', '失守', '迁徙', '会盟', '叛乱', '清算'],
        precisionOptions: ['年', '季', '月'],
      })
    case 'zombie':
      return createTimelineConfig('relative-disaster', {
        eraName: '灾变纪年',
        epochLabel: '灾变后',
        baseYearLabel: '爆发前',
        displayPattern: '灾变后第X天 / 第X周 / 第X月 / 第X年',
        relativeZeroLabel: '爆发当日',
        recommendedEventTypes: ['爆发', '失守', '补给', '搜救', '尸潮', '背叛', '迁移', '反攻', '收束'],
        precisionOptions: ['天', '周', '月', '年'],
      })
    case 'wuxia':
      return createTimelineConfig('regnal', {
        eraName: '江湖纪事',
        epochLabel: '某朝',
        baseYearLabel: '元年',
        displayPattern: '某朝某年 / 某季某月 / 某次大案后',
        relativeZeroLabel: '开篇之前',
        recommendedEventTypes: ['拜师', '下山', '押镖', '论剑', '缉拿', '寻仇', '失镖', '灭门', '归隐'],
        precisionOptions: ['年', '季', '月'],
      })
    case 'xianxia':
      return createTimelineConfig('custom-era', {
        eraName: '修真历',
        epochLabel: '纪元',
        baseYearLabel: '元年',
        displayPattern: '某纪元第X年 / 第X月 / 第X旬 / 某次闭关后',
        relativeZeroLabel: '开篇之前',
        recommendedEventTypes: ['入门', '试炼', '破境', '夺宝', '宗门冲突', '秘境', '闭关', '飞升', '因果回收'],
        precisionOptions: ['年', '季', '月', '旬'],
      })
    case 'fantasy':
      return createTimelineConfig('custom-era', {
        eraName: '诸界历',
        epochLabel: '历年',
        baseYearLabel: '元年',
        displayPattern: '诸界历X年 / 霜月 / 战役阶段',
        relativeZeroLabel: '故事前史',
        recommendedEventTypes: ['觉醒', '试炼', '远征', '揭示', '阵营裂变', '大战', '加冕', '回收伏笔'],
        precisionOptions: ['年', '季', '月', '战役阶段'],
      })
    case 'modern-mystery':
      return createTimelineConfig('gregorian', {
        eraName: '公历',
        epochLabel: '公元',
        baseYearLabel: '2026',
        displayPattern: 'YYYY年MM月DD日 / HH:mm / 某案发生后第X天',
        relativeZeroLabel: '异常事件发生前',
        recommendedEventTypes: ['旧案', '异常发现', '走访', '调阅', '封存', '失联', '追查', '通报', '收束'],
        precisionOptions: ['年', '月', '日', '小时'],
      })
    case 'urban-ability':
      return createTimelineConfig('gregorian', {
        eraName: '公历',
        epochLabel: '公元',
        baseYearLabel: '2026',
        displayPattern: 'YYYY年MM月DD日 / HH:mm',
        relativeZeroLabel: '故事开始前',
        recommendedEventTypes: ['发现异常', '觉醒', '调查', '冲突升级', '曝光', '反转', '追击', '收束'],
        precisionOptions: ['年', '月', '日', '小时'],
      })
    case 'western-fantasy':
      return createTimelineConfig('regnal', {
        eraName: '王朝纪年',
        epochLabel: '在位纪年',
        baseYearLabel: '王历元年',
        displayPattern: '王历X年 / 雪月 / 战役周',
        relativeZeroLabel: '新王登基前',
        recommendedEventTypes: ['登基', '远征', '圣谕', '叛乱', '试炼', '盟约', '围城', '决战', '收束'],
        precisionOptions: ['年', '季', '月', '战役周'],
      })
    case 'generic':
    default:
      return createTimelineConfig('custom-era', {
        eraName: '本纪元',
        epochLabel: '纪年',
        baseYearLabel: '元年',
        displayPattern: '第X年 / 第X月 / 第X阶段',
        relativeZeroLabel: '故事起点',
        recommendedEventTypes: ['开端', '转折', '升级', '揭示', '决裂', '收束'],
        precisionOptions: ['年', '季', '月', '阶段'],
      })
  }
}

const BUILTIN_GENRE_RULE_PACKS: Record<GenreRulePackKey, GenreWorldRuleSeed> = {
  generic: {
    version: 2,
    genreProfile: {
      key: 'generic',
      name: '通用长篇',
      subgenre: '自定义题材',
      worldviewTone: '世界规则必须能落回人物处境、资源分配和冲突升级，不做空泛概念展示。',
      socialFrame: '社会结构、阶层秩序和组织关系需要能解释人物的利益选择。',
      narrativeFocus: ['核心冲突', '人物关系', '事件后果', '世界规则落地'],
      languageAvoidances: ['概念口号', '引号着重', '伪深刻总结', '百科说明腔'],
    },
    powerSystems: [
      {
        id: 'generic-status',
        name: '身份与资源体系',
        appliesTo: ['人类', '非人角色', '组织成员'],
        levels: ['底层', '中层', '核心层'],
        advancementRule: '通过资源、能力、立场和关键事件获得提升。',
        limitations: '每次跃升都必须付出关系、道德或生存成本。',
        cost: '地位越高，越难独善其身。',
        taboo: '不要让角色无代价地拿到关键资源。',
      },
    ],
    speciesSystem: [
      {
        id: 'human',
        name: '人类',
        entityType: 'human',
        summary: '默认主体种族，也是大多数社会秩序的制定者和承受者。',
        traits: ['情绪复杂', '资源竞争强', '道德边界浮动'],
        commonIdentities: ['主角', '普通人', '组织成员'],
        relationToHumans: '自我参照系。',
        storyUse: '承接主要视角、情感共鸣和社会矛盾。',
      },
    ],
    factionSystem: [
      {
        id: 'core-power',
        name: '核心势力',
        factionType: '组织',
        summary: '控制主要资源、秩序或信息流的力量中心。',
        structure: '有明确上下级和利益链。',
        resources: '权力、资源、情报、人手。',
        externalRelations: '既压制外围，也需要外围维持运转。',
        recruitFrom: '从社会各层吸纳成员。',
        notableSites: ['总部', '外围据点'],
      },
    ],
    characterEcology: {
      overview: '角色生态以人物关系和功能分工为先，每类角色都要能回扣主题、背景和核心冲突。',
      slots: [
        {
          id: 'lead-anchor',
          label: '主视角支点',
          entityType: 'human',
          species: '人类',
          narrativeFunction: '承接主题、行动与代价。',
          contextLink: '必须直接卷入主线核心冲突。',
          preferredFactions: ['核心势力'],
          powerBias: ['身份与资源体系'],
        },
        {
          id: 'pressure-source',
          label: '外部压迫源',
          entityType: 'human',
          species: '人类',
          narrativeFunction: '持续制造资源、规则或关系压力。',
          contextLink: '与主角利益冲突但动机自洽。',
          preferredFactions: ['核心势力'],
          powerBias: ['身份与资源体系'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图按势力覆盖范围与关键冲突地点展开，不固定三级，按题材决定层级。',
      levels: [
        {
          depth: 1,
          label: '大区域/主势力圈',
          nodeTypes: ['区域', '国家', '势力圈'],
          relationHint: '决定资源流向、秩序边界和势力覆盖。',
          suggestedCount: 2,
          examples: ['中心城区', '边缘地区'],
        },
        {
          depth: 2,
          label: '关键活动区',
          nodeTypes: ['城区', '据点', '宗门', '城池'],
          relationHint: '承载主要人物活动和阶段冲突。',
          suggestedCount: 3,
          examples: ['总部', '黑市', '训练地'],
        },
        {
          depth: 3,
          label: '剧情节点',
          nodeTypes: ['建筑', '禁区', '秘境', '设施'],
          relationHint: '用于事件爆发、转折和伏笔回收。',
          suggestedCount: 3,
          examples: ['审讯室', '地下仓库', '遗迹入口'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '先写局势、动作、关系变化，再写情绪判断；避免解释型总结句先行。',
      '对白允许停顿、回避和信息差，不要求每句都工整完整。',
      ['所谓', '某种意义上', '命运', '这一刻', '不由得', '他说着说着'],
      ['普通概念不要加引号。', '不要把设定写成展示说明。'],
      getDefaultRealityOptions('generic'),
    ),
  },
  historical: {
    version: 2,
    genreProfile: {
      key: 'historical',
      name: '历史题材',
      subgenre: '历史正剧 / 架空历史 / 类历史',
      worldviewTone: '制度、地理、器物与身份秩序必须能落到人物选择，不允许空泛古风包装。',
      socialFrame: '朝廷、宗族、军镇、州县与商旅网络共同塑造人物的利益边界和行动代价。',
      narrativeFocus: ['时代结构', '制度压力', '人物命运', '地理与军政后果'],
      languageAvoidances: ['现代口语套壳', '悬浮古风词', '跨时代术语', '百科式历史说明'],
    },
    powerSystems: [
      {
        id: 'historical-status',
        name: '官身与门第体系',
        appliesTo: ['士人', '军职', '宗族成员', '市井人物'],
        levels: ['寒微', '地方骨干', '中枢相关'],
        advancementRule: '通过科名、军功、门第联姻、政局投靠或地方经营获得位置提升。',
        limitations: '名分、籍贯、派系、礼法和时代资源上限会同时约束人物跃升。',
        cost: '每次位置变化都会带来党争、宗族债务、名节损耗或生存风险。',
        taboo: '不能让角色无来源地掌握超出时代与身份的权力、知识或器物。',
      },
    ],
    speciesSystem: [
      {
        id: 'historical-human',
        name: '人类',
        entityType: 'human',
        summary: '历史题材默认以真实社会身份的人类群体为核心。',
        traits: ['受制度约束', '重名分', '受地理与资源制约'],
        commonIdentities: ['士人', '军户', '宗室', '商旅', '百姓'],
        relationToHumans: '主体社会网络。',
        storyUse: '承接时代秩序、家国冲突和个人命运转折。',
      },
    ],
    factionSystem: [
      {
        id: 'historical-court',
        name: '朝廷与地方体系',
        factionType: '政权',
        summary: '负责财政、军政、法度和人事调配，是多数历史冲突的制度母体。',
        structure: '中枢、州县、军镇与附属机构层层嵌套。',
        resources: '法统、税赋、文书、军权、仓储与道路节点。',
        externalRelations: '与宗族、豪强、边军、商路和异族势力长期博弈。',
        recruitFrom: '科举、荐举、军功、门第与地方网络。',
        notableSites: ['中枢官署', '州府衙门', '边镇大营'],
      },
    ],
    characterEcology: {
      overview: '历史角色要先确定身份、名分和依附关系，再决定情感与行动自由度。',
      slots: [
        {
          id: 'historical-lead',
          label: '时代夹缝中的主视角',
          entityType: 'human',
          species: '人类',
          narrativeFunction: '承受制度压力并推动命运转向。',
          contextLink: '必须同时卷入时代结构与私人代价。',
          preferredFactions: ['朝廷与地方体系'],
          powerBias: ['官身与门第体系'],
        },
        {
          id: 'historical-power',
          label: '制度压力源',
          entityType: 'human',
          species: '人类',
          narrativeFunction: '代表法统、门第、军政或地方秩序施压。',
          contextLink: '其选择要能体现时代结构，而不是纯反派功能位。',
          preferredFactions: ['朝廷与地方体系'],
          powerBias: ['官身与门第体系'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图优先展示王朝层级、州县节点和驿路水路，而不是孤立景点。',
      levels: [
        {
          depth: 1,
          label: '朝局与区域板块',
          nodeTypes: ['王朝', '疆域', '边境板块'],
          relationHint: '决定法统覆盖、军政重心和大战略方向。',
          suggestedCount: 2,
          examples: ['京畿', '边疆'],
        },
        {
          depth: 2,
          label: '州府与军镇',
          nodeTypes: ['州府', '郡县', '军镇', '港埠'],
          relationHint: '承接治理、税赋、军需和地方利益网络。',
          suggestedCount: 4,
          examples: ['州城', '边镇', '漕运口岸'],
        },
        {
          depth: 3,
          label: '剧情行动点',
          nodeTypes: ['衙署', '府邸', '关隘', '渡口', '营寨'],
          relationHint: '用于审案、调兵、潜入、接头和伏笔回收。',
          suggestedCount: 4,
          examples: ['州衙', '家庙', '关城', '驿站'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '优先写身份差序、制度摩擦、路程与现场动作，再落到情绪与评价，避免空泛古风抒情。',
      '对白应体现身份、礼法和权力距离；不确定具体官称时使用保守表达，避免硬编。',
      ['逆天改命', '降维打击', '血脉压制', '赛博', '顶流', '打工人'],
      ['未确认史实时，不生成貌似准确的细节。', '架空历史也要先交代分歧点与制度变形。'],
      getDefaultRealityOptions('historical'),
    ),
  },
  zombie: {
    version: 2,
    genreProfile: {
      key: 'zombie',
      name: '丧尸末日',
      subgenre: '病毒爆发 / 生存崩坏',
      worldviewTone: '世界秩序崩塌后，生存资源、感染风险和人性裂缝共同推进故事。',
      socialFrame: '国家框架可能仍有残存，但真正发挥作用的是基地、武装组织、幸存者团体与失控区域。',
      narrativeFocus: ['感染规则', '资源争夺', '生存秩序', '人性博弈'],
      languageAvoidances: ['中二命名', '夸张设定词', '抒情口号', '无意义引号'],
    },
    powerSystems: [
      {
        id: 'infection-rank',
        name: '感染等级',
        appliesTo: ['感染者', '变异体'],
        levels: ['游尸', '狂暴体', '猎杀者', '统御体', '尸王'],
        advancementRule: '由病毒进化、吞噬、环境刺激或实验介入推动。',
        limitations: '等级越高，行动逻辑越异化，越难稳定控制。',
        cost: '进化伴随理智流失、失控风险或生理畸变。',
        taboo: '不要让高阶丧尸没有代价地随意升级。',
      },
      {
        id: 'survivor-status',
        name: '幸存者生存位阶',
        appliesTo: ['幸存者', '基地成员'],
        levels: ['流亡者', '搜集者', '小队核心', '据点管理层', '基地决策层'],
        advancementRule: '通过资源控制、战斗能力、组织话语权和关键功绩提升。',
        limitations: '地位越高，背负的派系压力和道德债越重。',
        cost: '需要在信任、安全和资源之间持续交易。',
        taboo: '不要只写头衔，不解释其资源来源。',
      },
    ],
    speciesSystem: [
      {
        id: 'human',
        name: '幸存者',
        entityType: 'human',
        summary: '依靠组织、经验和临时秩序维持生存的人类群体。',
        traits: ['求生本能强', '关系脆弱', '资源敏感'],
        commonIdentities: ['基地居民', '搜救队员', '流亡者'],
        relationToHumans: '同类之间既互助也互相提防。',
        storyUse: '承载人性选择、制度冲突和情感共鸣。',
      },
      {
        id: 'infected',
        name: '感染者',
        entityType: 'undead',
        summary: '处在病毒影响下的非正常生命体，分等级演化。',
        traits: ['攻击性高', '行动模式受环境影响', '部分高阶保留伪装或统御能力'],
        commonIdentities: ['尸群前锋', '特殊变异体'],
        relationToHumans: '对人类构成直接生存威胁。',
        storyUse: '制造环境压迫、战斗威胁和秩序崩解感。',
      },
      {
        id: 'mutant-animal',
        name: '变异兽',
        entityType: 'beast',
        summary: '被病毒或环境污染改造的动物个体。',
        traits: ['领地性强', '感官强化', '行为不可预测'],
        commonIdentities: ['污染犬群', '夜行捕食者'],
        relationToHumans: '既可能成为猎物也可能被驯化利用。',
        storyUse: '补充环境威胁，丰富非人生态。',
      },
    ],
    factionSystem: [
      {
        id: 'survivor-base',
        name: '幸存者基地',
        factionType: '据点',
        summary: '以资源调配、防线和组织纪律维持生存的主体势力。',
        structure: '通常分为武装、后勤、医疗、管理层。',
        resources: '粮食、药品、武器、发电与庇护空间。',
        externalRelations: '与周边据点交易、敌对或结盟。',
        recruitFrom: '吸纳流民、专业人员和战斗骨干。',
        notableSites: ['主防线', '仓储区', '医疗区'],
      },
      {
        id: 'militia',
        name: '武装团体',
        factionType: '武装',
        summary: '以火力、纪律或恐怖控制地盘的组织。',
        structure: '头目制或军管制。',
        resources: '枪械、载具、囤积物资。',
        externalRelations: '容易与基地发生压迫、掠夺或交易关系。',
        recruitFrom: '前军警、雇佣兵、幸存者精英。',
        notableSites: ['军火库', '临时营地'],
      },
      {
        id: 'research-unit',
        name: '研究组织',
        factionType: '机构',
        summary: '掌握病毒样本、治疗方案或实验数据的关键力量。',
        structure: '研究层与安保层并行。',
        resources: '实验室、样本库、医疗设备。',
        externalRelations: '既可能被保护，也可能被围猎。',
        recruitFrom: '科研人员、医生、赞助方残余势力。',
        notableSites: ['实验楼', '冷藏库'],
      },
    ],
    characterEcology: {
      overview: '角色生态围绕生存链、感染链和组织链展开，不只写人类，还要有感染者、变异兽与不同基地身份。',
      slots: [
        {
          id: 'survivor-lead',
          label: '生存主角',
          entityType: 'human',
          species: '幸存者',
          narrativeFunction: '承担求生、决策和关系撕裂的主视角。',
          contextLink: '必须同时面对外部尸潮和内部秩序压力。',
          preferredFactions: ['幸存者基地'],
          powerBias: ['幸存者生存位阶'],
        },
        {
          id: 'base-power',
          label: '基地权力节点',
          entityType: 'human',
          species: '幸存者',
          narrativeFunction: '代表制度、分配权和秩序代价。',
          contextLink: '与主角在资源、信任或路线选择上发生拉扯。',
          preferredFactions: ['幸存者基地', '武装团体'],
          powerBias: ['幸存者生存位阶'],
        },
        {
          id: 'advanced-infected',
          label: '高阶感染体',
          entityType: 'undead',
          species: '感染者',
          narrativeFunction: '提供阶段性强敌或大型尸潮源头。',
          contextLink: '其能力或来历要与主线真相有关。',
          preferredFactions: ['研究组织'],
          powerBias: ['感染等级'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图以国家/大区、城市/基地、具体设施构成，重点体现防线、补给线和高风险区。',
      levels: [
        {
          depth: 1,
          label: '国家/大区',
          nodeTypes: ['国家', '大区', '封锁带'],
          relationHint: '区分已失控区域、军管区域和残存秩序区。',
          suggestedCount: 2,
          examples: ['东部封锁区', '沿海隔离带'],
        },
        {
          depth: 2,
          label: '城市/基地',
          nodeTypes: ['城市', '基地', '军事区', '研究区'],
          relationHint: '承载幸存者组织和主要路线。',
          suggestedCount: 3,
          examples: ['临港基地', '旧城区', '军方前哨'],
        },
        {
          depth: 3,
          label: '设施/高危点',
          nodeTypes: ['医院', '商场', '实验室', '地下通道', '仓库'],
          relationHint: '用于补给、伏击、实验真相和尸潮爆发。',
          suggestedCount: 4,
          examples: ['市立医院', '地下冷库', '高架桥断点'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '多写具体环境压力、行动路线和资源消耗，不要把末世写成抽象抒情舞台。',
      '对白要带求生目的、信息差和戒备感，不要人人都像概念发言。',
      ['命运', '文明的挽歌', '所谓人性', '最后的希望', '死亡在呼吸'],
      ['感染、断电、秩序崩坏等要用准确说法，不要拟人化。', '普通词不要套引号。'],
      getDefaultRealityOptions('zombie'),
    ),
  },
  wuxia: {
    version: 2,
    genreProfile: {
      key: 'wuxia',
      name: '武侠江湖',
      subgenre: '架空江湖 / 写实武林',
      worldviewTone: '江湖规矩、门第出身、伤病代价和朝堂力量共同塑造人物命运。',
      socialFrame: '世界由州府城镇、镖局帮会、武林门派、江湖散人、黑市牙行和官府缉捕体系交错构成。',
      narrativeFocus: ['江湖秩序', '人物成长', '师承恩怨', '名声代价', '行旅与见闻'],
      languageAvoidances: ['修仙口号', '万能神功设定', '空泛侠义宣言'],
    },
    powerSystems: [
      {
        id: 'martial-realm',
        name: '武学境界',
        appliesTo: ['侠客', '门派弟子', '镖师', '高手'],
        levels: ['入门', '练劲', '通脉', '凝势', '宗师', '绝顶'],
        advancementRule: '靠师承、苦练、实战、伤后恢复和长期积累推进，不靠一夜顿悟横跨数阶。',
        limitations: '体力、伤势、年龄、兵器适配和功法相性都会限制上限。',
        cost: '练功会耗时、耗银、耗药材和耗身体本钱，强行突破会留下暗伤。',
        taboo: '不要把内力写成无限能源，也不要让低阶角色随意横扫绝顶高手。',
      },
      {
        id: 'jianghu-status',
        name: '江湖名位',
        appliesTo: ['江湖人物', '帮会首脑', '镖师', '捕快'],
        levels: ['无名后辈', '地方成名', '一方豪强', '江湖名宿', '宗师/魁首'],
        advancementRule: '由战绩、信誉、门第、地盘、人脉和公开事件共同累积。',
        limitations: '名声可以带来号召力，也会引来寻仇、挑战和官面关注。',
        cost: '地位越高，越难抽身，越要承担师门、帮会和旧债压力。',
        taboo: '不要把名望写成空标签，它必须对应具体人脉、责任和风险。',
      },
    ],
    speciesSystem: [
      {
        id: 'jianghu-human',
        name: '江湖人物',
        entityType: 'human',
        summary: '闯荡江湖的主体，可能背着师门、旧债或血仇。',
        traits: ['讲路数', '重脸面', '代价现实'],
        commonIdentities: ['门派弟子', '散客', '镖师'],
        relationToHumans: '本质上就是人与人的恩怨网。',
        storyUse: '承接成长、师承、寻仇、护镖和结盟。',
      },
      {
        id: 'commonfolk',
        name: '市井百姓',
        entityType: 'human',
        summary: '官税、战乱、帮会和武林冲突的直接承受者。',
        traits: ['求生务实', '怕事也记仇', '会识时势'],
        commonIdentities: ['掌柜', '船户', '村民', '工匠'],
        relationToHumans: '他们就是江湖所依附的人间地基。',
        storyUse: '用来呈现人间疾苦、政令压力和主角选择的后果。',
      },
      {
        id: 'border-guest',
        name: '边地来客',
        entityType: 'human',
        summary: '走商、番僧、异域高手或边军逃人等流动人物。',
        traits: ['路线复杂', '背景难测', '开阔见识'],
        commonIdentities: ['走商', '番僧', '边军旧人'],
        relationToHumans: '带来外部视角和新的利益链。',
        storyUse: '用来打开边地事态、跨域交易和异域恩怨。',
      },
    ],
    factionSystem: [
      {
        id: 'sect',
        name: '门派',
        factionType: '门派',
        summary: '传承武学、维持门规并参与武林排位的核心组织。',
        structure: '掌门、长老、真传、内外门弟子层次分明。',
        resources: '秘笈、武库、药间、地盘和名望。',
        externalRelations: '与别派争排位、争弟子，也会与官府或商路合作。',
        recruitFrom: '师承传承、开山收徒、寒门投奔者。',
        notableSites: ['山门', '演武场', '藏兵楼'],
      },
      {
        id: 'underworld',
        name: '帮会/镖局',
        factionType: '江湖组织',
        summary: '掌控地盘、押运、漕运或黑市生意的现实势力。',
        structure: '首脑、堂口、镖师、外雇高手红白并立。',
        resources: '人手、银两、车马、消息网和线人。',
        externalRelations: '既要与门派打交道，也要应付官面缉捕和同行吞并。',
        recruitFrom: '流民、逃军、行商伙伴、失意武者。',
        notableSites: ['总堂', '码头', '黑市'],
      },
      {
        id: 'yamen',
        name: '官府/缉事机构',
        factionType: '官面',
        summary: '负责治安、缉拿、缉边或秘查的权力系统。',
        structure: '州府行政、捕快系统、密探线人分层运作。',
        resources: '律令、牢狱、公文、驻兵和档案。',
        externalRelations: '对门派和帮会时而拉拢，时而打压。',
        recruitFrom: '科举失意者、边军旧部、缉拿能手。',
        notableSites: ['州衙', '大牢', '缉事房'],
      },
    ],
    characterEcology: {
      overview: '角色生态要同时有行走江湖的主体、师门或旧债压力位、市井锚点和官面对照位。',
      slots: [
        {
          id: 'jianghu-lead',
          label: '行路主角',
          entityType: 'human',
          species: '江湖人物',
          narrativeFunction: '承担行走、练功、选择和付出代价。',
          contextLink: '必须被卷入师门、人情或大案之一。',
          preferredFactions: ['门派', '帮会/镖局', '官府/缉事机构'],
          powerBias: ['武学境界', '江湖名位'],
        },
        {
          id: 'master-pressure',
          label: '师门或旧债压力位',
          entityType: 'human',
          species: '江湖人物',
          narrativeFunction: '提供门规、情义、背叛或追杀压力。',
          contextLink: '要能对主角的路线和底线产生长期影响。',
          preferredFactions: ['门派', '官府/缉事机构'],
          powerBias: ['武学境界', '江湖名位'],
        },
        {
          id: 'mortal-anchor',
          label: '市井锚点',
          entityType: 'human',
          species: '市井百姓',
          narrativeFunction: '让江湖冲突落到人间疾苦、生计和小人命运上。',
          contextLink: '要能看见主角选择对普通人的真实影响。',
          preferredFactions: ['帮会/镖局', '官府/缉事机构'],
          powerBias: ['江湖名位'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图按州域路线、城镇/门派/帮口、客栈/镖路/险地递进，体现江湖是一个需要赶路、打点、还人情的人间网络。',
      levels: [
        {
          depth: 1,
          label: '州域/路线',
          nodeTypes: ['州域', '边地', '官道'],
          relationHint: '决定人物行走范围和消息流速。',
          suggestedCount: 2,
          examples: ['青州道', '塞北边路'],
        },
        {
          depth: 2,
          label: '城镇/门派/据点',
          nodeTypes: ['州城', '县镇', '门派', '镇口'],
          relationHint: '承载重要阵营和人情网络。',
          suggestedCount: 3,
          examples: ['龙门镇', '听潮门', '运河镇口'],
        },
        {
          depth: 3,
          label: '现场/险地/行旅点',
          nodeTypes: ['客栈', '镖道', '山寨', '渡口', '矿场'],
          relationHint: '用于爆发交手、护人、失物、寻踪和螺旋升压。',
          suggestedCount: 4,
          examples: ['断碑渡', '黑风寨', '长庭客栈'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '多写路程、伤势、银钱、人情、门规和官面压力，让江湖像有人住的地方，不要写成悬空神话。',
      '对白要分出门第、师承、行当和火气，少用修仙腔、热血宣言腔。',
      ['大道', '飞升', '天命所归', '一念通天'],
      ['写实武侠优先服从真实地理、兵器、伤病、官府和时代常识；架空武侠也要保持自己的秩序闭环。', '招式可以有名目，但出手距离、体力消耗和伤害后果要说得通。', '不要把江湖规矩写成空口号，要落实到追杀、护短、赔礼、结盟和报官等具体动作。'],
      getDefaultRealityOptions('wuxia'),
    ),
  },
  xianxia: {
    version: 2,
    genreProfile: {
      key: 'xianxia',
      name: '仙侠修真',
      subgenre: '修炼成长 / 宗门世界',
      worldviewTone: '境界、寿命、资源、因果和宗门秩序共同决定人物命运，凡俗与仙途之间长期存在落差。',
      socialFrame: '世界通常由凡俗王朝、修真宗门、修真家族、散修据点、坊市势力、秘境入口和上层界域共同构成。',
      narrativeFocus: ['境界晋升', '凡俗与仙途落差', '宗门秩序', '资源争夺', '因果代价'],
      languageAvoidances: ['现代口头语', '玄虚口号', '浮夸称号堆砌'],
    },
    powerSystems: [
      {
        id: 'cultivation',
        name: '修炼境界',
        appliesTo: ['修士', '灵兽', '妖族'],
        levels: ['炼气', '筑基', '金丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫'],
        advancementRule: '依靠灵根、机缘、功法、资源和心境突破。',
        limitations: '不同灵根和传承决定上限与速度。',
        cost: '突破失败、心魔、资源耗尽都会造成反噬。',
        taboo: '不要让角色越境作战和突破毫无代价。',
      },
      {
        id: 'sect-status',
        name: '宗门身份阶位',
        appliesTo: ['宗门成员'],
        levels: ['杂役', '外门弟子', '内门弟子', '真传', '长老', '掌教'],
        advancementRule: '由境界、战绩、贡献和派系支持共同决定。',
        limitations: '身份高低决定资源与责任，不能脱离宗门结构存在。',
        cost: '身份越高，越容易卷入派系斗争和因果纠缠。',
        taboo: '不要只写头衔，要写其对应的资源与约束。',
      },
    ],
    speciesSystem: [
      {
        id: 'human-cultivator',
        name: '人族修士',
        entityType: 'human',
        summary: '最常见的修炼主体，数量最多，宗门秩序围绕其展开。',
        traits: ['资源竞争强', '心性差异大', '派系分明'],
        commonIdentities: ['宗门弟子', '散修', '家族子弟'],
        relationToHumans: '主体人群。',
        storyUse: '承接成长、师承、宗门斗争与飞升路线。',
      },
      {
        id: 'mortal-population',
        name: '凡俗众生',
        entityType: 'human',
        summary: '尚未踏入修途的百姓、工匠、军户和边地人口。',
        traits: ['要面对天灾人祸', '对修士又敬又怕', '生计压力真实'],
        commonIdentities: ['村民', '工匠', '军户', '商贾'],
        relationToHumans: '是修真世界的人间基底。',
        storyUse: '用来呈现凡俗与仙途的落差、人间疾苦与主角选择的后果。',
      },
      {
        id: 'spirit-beast',
        name: '灵兽',
        entityType: 'beast',
        summary: '拥有灵智或灵性血脉的兽类个体，可契约、可修炼、可守护山门。',
        traits: ['血脉影响强', '感知敏锐', '忠诚与野性并存'],
        commonIdentities: ['护山灵兽', '契约伙伴', '秘境守护者'],
        relationToHumans: '与修士合作、依附或敌对。',
        storyUse: '补足非人生态、陪伴关系和秘境体系。',
      },
      {
        id: 'feral-beast',
        name: '异兽/妖物',
        entityType: 'beast',
        summary: '受煞气、秘境异变或古老血脉影响的凶物。',
        traits: ['领地性强', '环境适应极端', '多半具有特殊材料价值'],
        commonIdentities: ['山泽霸主', '秘境凶物', '炼丹材料来源'],
        relationToHumans: '既是资源与危险，也会倒逼势力重新划分边界。',
        storyUse: '用来支撑试炼、狩猎、护城、失控灾害和资源争夺。',
      },
      {
        id: 'evil-spirit',
        name: '恶灵/邪祟',
        entityType: 'nonhuman',
        summary: '由怨念、禁术、祭炼或灾厄死地孕生的异质存在。',
        traits: ['规则性强', '多与地脉或执念绑定', '难以用寻常方式彻底解决'],
        commonIdentities: ['恶地残魂', '养鬼产物', '封印物'],
        relationToHumans: '常与邪修、遗迹和禁地纠缠不清。',
        storyUse: '用来扩展灾厄来源、规则风险和因果反噬。',
      },
    ],
    factionSystem: [
      {
        id: 'sect',
        name: '宗门',
        factionType: '宗门',
        summary: '修真世界的基础秩序单位，掌握功法、灵脉和弟子选拔。',
        structure: '外门、内门、真传、长老会、掌教层层分化。',
        resources: '灵脉、功法、洞府、法宝、秘境名额。',
        externalRelations: '与其他宗门竞争资源，也与王朝和家族结盟。',
        recruitFrom: '凡俗王朝、修真家族、散修试炼者。',
        notableSites: ['山门', '藏经阁', '灵池'],
      },
      {
        id: 'dynasty',
        name: '王朝/州国',
        factionType: '国家',
        summary: '负责管理凡俗秩序，也与修真势力维持微妙平衡。',
        structure: '皇权、地方势力、供奉体系并行。',
        resources: '人口、税赋、地盘、矿脉入口。',
        externalRelations: '既依赖宗门镇压灾祸，也提防宗门坐大。',
        recruitFrom: '宗室、世家、地方势力。',
        notableSites: ['皇城', '边境州城'],
      },
      {
        id: 'clan',
        name: '修真家族',
        factionType: '家族',
        summary: '以血脉、婚盟和传承维系势力延续。',
        structure: '长房、分支、客卿、护道人。',
        resources: '族产、祖地、血脉功法。',
        externalRelations: '与宗门合作，也可能暗中争夺秘境与资源。',
        recruitFrom: '本族血脉、联姻、客卿修士。',
        notableSites: ['祖地', '家族秘库'],
      },
      {
        id: 'market-alliance',
        name: '坊市/散修盟',
        factionType: '交易网络',
        summary: '连接散修、行商、炼师和情报贩子的流动势力。',
        structure: '坐馆人、交易行、客卿和地下线人交错运作。',
        resources: '灵石、情报、罕见材料、黑市通道。',
        externalRelations: '和各家宗门、王朝、邪修都有交集，立场往往取决于利益。',
        recruitFrom: '散修、被放逐者、商贾与灰色人员。',
        notableSites: ['云河坊市', '拍卖楼', '散修客栈'],
      },
      {
        id: 'evil-cultivators',
        name: '邪修/魔道',
        factionType: '异端势力',
        summary: '通过抽魂、养鬼、血祭或禁术获取力量的暗面组织。',
        structure: '多以秘主、护法、供品和外围佣从构成。',
        resources: '禁术、尸地、生魂、邪器和隐匿洞府。',
        externalRelations: '和恶灵、异兽、黑市交易网络关系紧密，也会反向渗透正道宗门。',
        recruitFrom: '被逐出的弟子、因仇入魔者、走投无路的散修。',
        notableSites: ['尸河谷', '封魂坡', '地下血坛'],
      },
    ],
    characterEcology: {
      overview: '角色生态必须包含不同境界、不同势力、非人角色与凡俗锚点，体现宗门、王朝、家族、散修和界域之间的秩序差。',
      slots: [
        {
          id: 'cultivator-lead',
          label: '修炼主角',
          entityType: 'human',
          species: '人族修士',
          narrativeFunction: '承担成长、突破与因果代价。',
          contextLink: '必须被卷入宗门、坊市或界域秩序。',
          preferredFactions: ['宗门', '修真家族', '坊市/散修盟'],
          powerBias: ['修炼境界', '宗门身份阶位'],
        },
        {
          id: 'sect-senior',
          label: '宗门上位者',
          entityType: 'human',
          species: '人族修士',
          narrativeFunction: '代表宗门规则、资源分配和师承压力。',
          contextLink: '与主角在利益或道义上形成长期拉扯。',
          preferredFactions: ['宗门'],
          powerBias: ['修炼境界', '宗门身份阶位'],
        },
        {
          id: 'mortal-anchor',
          label: '凡俗牵引点',
          entityType: 'human',
          species: '凡俗众生',
          narrativeFunction: '让主角看见人间疾苦、赋税兵祸和灾变的真实后果。',
          contextLink: '要能影响主角对修行、权力和取舍的判断。',
          preferredFactions: ['王朝/州国', '坊市/散修盟'],
          powerBias: ['宗门身份阶位'],
        },
        {
          id: 'heterodox-pressure',
          label: '邪修或异类压力位',
          entityType: 'nonhuman',
          species: '恶灵/邪祟',
          narrativeFunction: '提供禁术、反噬和道心考验。',
          contextLink: '必须与秘境、邪修或旧因果有直接关联。',
          preferredFactions: ['邪修/魔道'],
          powerBias: ['修炼境界'],
        },
        {
          id: 'nonhuman-link',
          label: '非人连接点',
          entityType: 'beast',
          species: '灵兽',
          narrativeFunction: '提供血脉、契约、秘境和感情上的异质视角。',
          contextLink: '必须与世界规则或主角机缘直接相关。',
          preferredFactions: ['宗门', '修真家族'],
          powerBias: ['修炼境界'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图按界域、凡俗王朝/宗门势力、城池/坊市/秘境/洞府递进，体现修真世界层级、凡俗差异和资源分布。',
      levels: [
        {
          depth: 1,
          label: '界域/大陆',
          nodeTypes: ['界域', '大陆', '州域'],
          relationHint: '区分修炼文明层级与资源密度。',
          suggestedCount: 2,
          examples: ['北荒界', '东离大陆'],
        },
        {
          depth: 2,
          label: '州国/宗门势力',
          nodeTypes: ['王朝', '州国', '宗门', '家族领地'],
          relationHint: '承载主要势力与人物归属。',
          suggestedCount: 3,
          examples: ['太玄宗', '青岳国'],
        },
        {
          depth: 3,
          label: '城池/秘境/洞府',
          nodeTypes: ['城池', '坊市', '秘境', '洞府', '试炼地'],
          relationHint: '用于修炼、交易、试炼与冲突爆发。',
          suggestedCount: 4,
          examples: ['云河坊市', '九焰秘境'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '用具体修炼条件、资源、身份和凡俗纠葛来解释冲突，不要空喊仙途、大道。',
      '对白要符合身份层级和修真礼法，少用现代口头语。',
      ['大道无情', '天命如此', '仙路茫茫', '某种玄而又玄的感觉'],
      ['境界名称可以保留，但普通概念不要加引号。', '凡人区域、坊市、散修、邪修、灵兽、异兽和恶灵都要写出用处与代价。', '不要把宗门设定写成百科词条。'],
      getDefaultRealityOptions('xianxia'),
    ),
  },
  fantasy: {
    version: 2,
    genreProfile: {
      key: 'fantasy',
      name: '玄幻升级',
      subgenre: '强者进阶 / 多势力对撞',
      worldviewTone: '等级、血脉、学院、帝国和遗迹共同构成力量秩序。',
      socialFrame: '世界由帝国、宗族、学院、公会、禁地等多元势力组成。',
      narrativeFocus: ['等级成长', '势力对抗', '遗迹机缘', '血脉与出身'],
      languageAvoidances: ['流水账升级说明', '中二台词堆砌', '模板化爽句'],
    },
    powerSystems: [
      {
        id: 'rank',
        name: '战力等级',
        appliesTo: ['修炼者', '强者', '异族'],
        levels: ['斗者', '斗师', '大斗师', '斗灵', '斗王', '斗皇', '斗宗', '斗尊', '斗圣', '斗帝'],
        advancementRule: '通过功法、资源、血脉、战斗和传承实现跨级。',
        limitations: '高等级需要稳定资源和传承支撑。',
        cost: '越级与突破常伴随根基损伤、势力追杀或资源负债。',
        taboo: '不要让顶级境界成为空标签。',
      },
    ],
    speciesSystem: [
      {
        id: 'human',
        name: '人族',
        entityType: 'human',
        summary: '帝国、宗族和学院的主体构成。',
        traits: ['组织化强', '阶层流动依赖实力', '重视传承'],
        commonIdentities: ['学院学员', '宗族子弟', '佣兵'],
        relationToHumans: '主体种族。',
        storyUse: '承接升级与势力冲突。',
      },
      {
        id: 'monster',
        name: '魔兽/异族',
        entityType: 'beast',
        summary: '拥有血脉天赋或独特生理优势的非人群体。',
        traits: ['血脉优势明显', '领地观念强', '高阶个体可化形'],
        commonIdentities: ['守护兽', '禁地霸主', '异族领袖'],
        relationToHumans: '既是资源来源，也可能是联盟与婚盟对象。',
        storyUse: '提供血脉线、非人冲突和世界拓展。',
      },
    ],
    factionSystem: [
      {
        id: 'empire',
        name: '帝国',
        factionType: '国家',
        summary: '掌控疆域、法度和大型战争资源的上层力量。',
        structure: '皇室、军部、贵族、附属宗门并存。',
        resources: '军队、税赋、矿脉、秘库。',
        externalRelations: '与宗门、学院和世家互相制衡。',
        recruitFrom: '宗族、军功体系、学院毕业者。',
        notableSites: ['帝都', '边境战场'],
      },
      {
        id: 'academy',
        name: '学院',
        factionType: '学院',
        summary: '人才培养和跨势力竞争的重要枢纽。',
        structure: '导师、内外院、榜单体系。',
        resources: '课程、试炼场、藏书、交流资源。',
        externalRelations: '与帝国和宗门合作竞争。',
        recruitFrom: '平民天才、宗族子弟、外来者。',
        notableSites: ['内院', '试炼塔'],
      },
      {
        id: 'clan',
        name: '宗族',
        factionType: '家族',
        summary: '以血脉和祖传资源维系的中坚势力。',
        structure: '族长、长老会、嫡系旁系。',
        resources: '血脉传承、产业、附属护卫。',
        externalRelations: '既能依附帝国，也可反向争权。',
        recruitFrom: '本族和外姓附属。',
        notableSites: ['祖祠', '族地'],
      },
    ],
    characterEcology: {
      overview: '角色生态要同时覆盖主角线、宗族线、学院线和异族线，避免只剩升级打怪模板角色。',
      slots: [
        {
          id: 'upgrader',
          label: '升级主角',
          entityType: 'human',
          species: '人族',
          narrativeFunction: '承担成长、逆袭和代价。',
          contextLink: '出身限制与资源争夺必须明显。',
          preferredFactions: ['学院', '宗族', '帝国'],
          powerBias: ['战力等级'],
        },
        {
          id: 'bloodline-rival',
          label: '同辈强敌',
          entityType: 'human',
          species: '人族',
          narrativeFunction: '提供同层级竞争与价值观冲撞。',
          contextLink: '与主角共享赛道但资源与立场不同。',
          preferredFactions: ['学院', '宗族'],
          powerBias: ['战力等级'],
        },
        {
          id: 'alien-factor',
          label: '异族变量',
          entityType: 'beast',
          species: '魔兽/异族',
          narrativeFunction: '引入血脉、遗迹或非人利益链。',
          contextLink: '必须和世界大局或传承秘密相关。',
          preferredFactions: ['帝国'],
          powerBias: ['战力等级'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图由大陆/帝国、学院/宗族/禁地、遗迹/城池/战场构成，服务升级路线和势力战争。',
      levels: [
        {
          depth: 1,
          label: '大陆/帝国',
          nodeTypes: ['大陆', '帝国', '疆域'],
          relationHint: '确定势力边界和资源层次。',
          suggestedCount: 2,
          examples: ['北辰帝国', '荒火域'],
        },
        {
          depth: 2,
          label: '学院/宗族/禁地',
          nodeTypes: ['学院', '宗族', '城邦', '禁地'],
          relationHint: '承载人物归属和主线阵营。',
          suggestedCount: 3,
          examples: ['苍炎学院', '韩氏族地'],
        },
        {
          depth: 3,
          label: '遗迹/城池/战场',
          nodeTypes: ['遗迹', '城池', '试炼场', '战场'],
          relationHint: '用于突破、争夺、背叛和大战。',
          suggestedCount: 4,
          examples: ['焚天遗迹', '黑岩城'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '升级和打斗要落到资源、风险和人际后果，不要只报境界名。',
      '对白要体现出身和立场，不要人人都用同一套狠话。',
      ['震惊', '恐怖如斯', '气势如虹般席卷', '某种无法言说的强大'],
      ['战力等级可以保留，但要解释其现实作用。'],
      getDefaultRealityOptions('fantasy'),
    ),
  },
  'modern-mystery': {
    version: 2,
    genreProfile: {
      key: 'modern-mystery',
      name: '现代悬疑推理',
      subgenre: '社会派 / 刑侦 / 调查 / 旧案',
      worldviewTone: '异常埋在旧案、档案和地方关系里，调查推进要受到现实秩序的持续阻力。',
      socialFrame: '故事发生在真实城市语境里，基层机构、旧工业单位、家庭网络和媒体渠道共同施压。',
      narrativeFocus: ['旧案切口', '调查阻力', '证据链缺口', '地方现实纹理', '知情人沉默'],
      languageAvoidances: ['万能阴谋论', '空洞氛围词', '超自然偷解', '平台悬浮文案'],
    },
    powerSystems: [
      {
        id: 'access-tier',
        name: '调查权限与信息层级',
        appliesTo: ['记者', '警务人员', '档案管理者', '企业内部人员', '知情人'],
        levels: ['公开信息', '内部线索', '封存记录', '核心真相'],
        advancementRule: '通过走访、调阅、交换情报、建立信任或承担风险逐层靠近真相。',
        limitations: '权限越深，越容易触发缄默、阻拦、删改记录和现实报复。',
        cost: '每向前一步都可能付出职业代价、关系代价、名誉代价或人身风险。',
        taboo: '不要让主角靠一句套话就轻易拿到关键卷宗和口供。',
      },
    ],
    speciesSystem: [
      {
        id: 'human',
        name: '普通人',
        entityType: 'human',
        summary: '现代悬疑的主体仍是现实社会中的普通人，他们的身份、职业和过往决定了能看到什么、敢追到哪里。',
        traits: ['现实处境明确', '信息不完整', '会被制度与人情同时约束'],
        commonIdentities: ['记者', '民警', '家属', '保安', '医生', '工人', '教师', '社区居民'],
        relationToHumans: '人物之间的鸿沟主要来自权力、信息、职业边界和旧关系，而不是种族差异。',
        storyUse: '承接现实压力、调查路径、证词偏差和情感代价。',
      },
    ],
    factionSystem: [
      {
        id: 'local-system',
        name: '地方调查系统',
        factionType: '机构',
        summary: '负责立案、协查、封存和现场控制的正式系统，既可能提供线索，也可能成为第一道阻力。',
        structure: '分局、派出所、档案室、内勤与外勤层层相扣。',
        resources: '卷宗、监控、接警记录、问询权限和现场进入资格。',
        externalRelations: '要和医院、媒体、企业、街道、学校与上级系统保持平衡。',
        recruitFrom: '警务人员、内勤文员、技术人员和协查接口人。',
        notableSites: ['分局档案室', '值班室', '证物室'],
      },
      {
        id: 'legacy-industry',
        name: '旧工业体系',
        factionType: '企业/单位',
        summary: '由老厂区、改制企业、退休办和遗留资产构成的利益网络，表面沉寂，内部却保存着大量无法公开的旧账。',
        structure: '厂办、保卫科、退休办与外包物业交织。',
        resources: '历史档案、旧通讯设备、内部名单、厂区空间和地方人脉。',
        externalRelations: '与地方机构既合作又互相遮掩，遇到调查时优先维稳和切割责任。',
        recruitFrom: '老职工、家属、保安、后勤和承包商。',
        notableSites: ['老厂办公楼', '封闭车间', '退休办'],
      },
    ],
    characterEcology: {
      overview: '现代悬疑的角色生态要围绕“谁知道一点、谁在阻拦、谁承担后果”来布置，而不是一味堆神秘人。',
      slots: [
        {
          id: 'investigator',
          label: '追查推动者',
          entityType: 'human',
          species: '普通人',
          narrativeFunction: '推动线索串联、承担调查成本并把旧案与当下连起来。',
          contextLink: '必须有现实理由接近事件，同时会被权限、关系或职业边界卡住。',
          preferredFactions: ['地方调查系统', '旧工业体系'],
          powerBias: ['调查权限与信息层级'],
        },
        {
          id: 'gatekeeper',
          label: '沉默守门人',
          entityType: 'human',
          species: '普通人',
          narrativeFunction: '掌握一段关键记录或关键记忆，是第一层阻力来源。',
          contextLink: '沉默必须有利害原因，不是单纯装神秘。',
          preferredFactions: ['地方调查系统', '旧工业体系'],
          powerBias: ['调查权限与信息层级'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图按城市层级、机构空间和封闭现场展开，重点是哪些地方能进、哪些地方不能进。',
      levels: [
        {
          depth: 1,
          label: '城市/县城/老工业区',
          nodeTypes: ['城市', '县城', '老工业区', '沿江港区'],
          relationHint: '确定地方规模、熟人社会密度和线索流向。',
          suggestedCount: 2,
          examples: ['北城老工业区', '沿江新区'],
        },
        {
          depth: 2,
          label: '机构/单位/生活节点',
          nodeTypes: ['分局', '报社', '医院', '学校', '厂办', '街道'],
          relationHint: '承载权限边界、信息来源和现实阻力。',
          suggestedCount: 4,
          examples: ['分局档案室', '市报社副刊部', '职工医院'],
        },
        {
          depth: 3,
          label: '封闭现场/证据节点',
          nodeTypes: ['废弃车间', '通讯站', '地下仓库', '出租屋', '值班室'],
          relationHint: '用于发现异样、取证、对质和回收旧记录。',
          suggestedCount: 4,
          examples: ['封闭通讯站', '废弃仓库夹层', '夜班值班室'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '优先写线索入口、现实阻力、空间细节和人物判断，不要把悬疑写成空心氛围。',
      '对白要像现实中的走访、问话、敷衍、试探和留白，不要人人都端着谜语腔。',
      ['命运的齿轮', '深不见底的迷雾', '某种无法言说的阴影', '所有真相终将浮出水面'],
      ['优先使用卷宗、档案、监控、通联、旧闻、值班记录、医院记录等现实线索载体。', '标题和设定名尽量从职业现场、地点纹理、时间锚点和证据载体里取词。'],
      getDefaultRealityOptions('modern-mystery'),
    ),
  },
  'urban-ability': {
    version: 2,
    genreProfile: {
      key: 'urban-ability',
      name: '都市异能',
      subgenre: '现代社会 / 隐秘能力体系',
      worldviewTone: '现实秩序与隐秘能力秩序并行，普通生活与异常事件相互渗透。',
      socialFrame: '明面是现代城市社会，暗面是异能组织、资本集团、调查机构和地下市场。',
      narrativeFocus: ['双重身份', '隐秘组织', '现实代价', '能力规则'],
      languageAvoidances: ['中二台词', '说明书口吻', '悬浮鸡汤'],
    },
    powerSystems: [
      {
        id: 'ability-grade',
        name: '异能评级',
        appliesTo: ['异能者', '实验体'],
        levels: ['E级', 'D级', 'C级', 'B级', 'A级', 'S级'],
        advancementRule: '通过觉醒、训练、事件刺激或实验强化提升。',
        limitations: '能力越强，副作用、暴露风险和监管压力越大。',
        cost: '能力会侵蚀身体、情绪或人际关系。',
        taboo: '不要让能力没有社会后果。',
      },
    ],
    speciesSystem: [
      {
        id: 'human',
        name: '普通人/异能者',
        entityType: 'human',
        summary: '现代城市社会的主体，人群中潜藏少量觉醒者。',
        traits: ['社会身份复杂', '生活压力真实', '隐秘性强'],
        commonIdentities: ['社畜', '学生', '调查员', '觉醒者'],
        relationToHumans: '普通人与异能者常有信息鸿沟。',
        storyUse: '承接现实感与能力代价。',
      },
      {
        id: 'spirit-entity',
        name: '异象生命',
        entityType: 'nonhuman',
        summary: '由污染、实验、灵异或维度裂缝产生的非人存在。',
        traits: ['规则异常', '形态多变', '难以归类'],
        commonIdentities: ['寄生体', '异常样本', '拟人化异物'],
        relationToHumans: '既可能寄生、交易，也可能互相利用。',
        storyUse: '制造都市异常层和非人冲突。',
      },
    ],
    factionSystem: [
      {
        id: 'agency',
        name: '调查机构',
        factionType: '机构',
        summary: '负责回收、调查、封锁异常事件的官方或半官方力量。',
        structure: '行动组、技术组、审查组并行。',
        resources: '权限、档案、封锁手段、训练系统。',
        externalRelations: '与资本、地下组织和媒体互相牵制。',
        recruitFrom: '军警系统、天赋觉醒者、专业人员。',
        notableSites: ['指挥中心', '封存库'],
      },
      {
        id: 'consortium',
        name: '资本集团',
        factionType: '企业',
        summary: '借异能或异常资源谋利的商业势力。',
        structure: '高层董事会与实验部门分离。',
        resources: '资金、实验平台、舆论资源。',
        externalRelations: '表面守法，暗中争夺样本与觉醒者。',
        recruitFrom: '商业精英、研究人员、雇佣异能者。',
        notableSites: ['总部大楼', '地下实验室'],
      },
    ],
    characterEcology: {
      overview: '角色生态要兼顾普通生活身份和异常系统身份，避免所有人都只剩超能力标签。',
      slots: [
        {
          id: 'double-life',
          label: '双重身份主角',
          entityType: 'human',
          species: '普通人/异能者',
          narrativeFunction: '连接现实生活与异常事件。',
          contextLink: '必须在公开身份和暗面身份之间反复切换。',
          preferredFactions: ['调查机构', '资本集团'],
          powerBias: ['异能评级'],
        },
        {
          id: 'authority-node',
          label: '规则执行者',
          entityType: 'human',
          species: '普通人/异能者',
          narrativeFunction: '代表制度、监管与情报。',
          contextLink: '与主角在信任和立场上长期拉扯。',
          preferredFactions: ['调查机构'],
          powerBias: ['异能评级'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图以城市区块、组织据点和具体异常现场构成，强调日常与异变重叠。',
      levels: [
        {
          depth: 1,
          label: '城市/城区',
          nodeTypes: ['城市', '城区', '开发区'],
          relationHint: '划分公开社会和异常高发区域。',
          suggestedCount: 2,
          examples: ['临海市', '北城旧区'],
        },
        {
          depth: 2,
          label: '组织据点',
          nodeTypes: ['机构', '企业园区', '社区', '学校'],
          relationHint: '承载人物日常身份与组织关系。',
          suggestedCount: 3,
          examples: ['调查局分部', '星港集团园区'],
        },
        {
          depth: 3,
          label: '异常现场',
          nodeTypes: ['实验室', '仓库', '公寓', '地铁站', '封锁点'],
          relationHint: '用于异常爆发、回收行动和真相揭示。',
          suggestedCount: 4,
          examples: ['三号封存库', '废弃地铁站'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '都市部分要像真实生活现场，异常部分要有具体规则和社会代价。',
      '对白贴近现代人表达，不要写成中二宣言。',
      ['命运的齿轮', '都市暗面的王者', '某种无法言说的悸动'],
      ['异能名可以保留，但普通概念不要加引号。'],
      getDefaultRealityOptions('urban-ability'),
    ),
  },
  'western-fantasy': {
    version: 2,
    genreProfile: {
      key: 'western-fantasy',
      name: '西幻魔法',
      subgenre: '王国 / 教会 / 魔法',
      worldviewTone: '王权、教会、贵族与魔法体系共同塑造秩序。',
      socialFrame: '王国、城邦、骑士团、公会和异族领地构成复合政治格局。',
      narrativeFocus: ['王国秩序', '魔法代价', '异族关系', '信仰与权力'],
      languageAvoidances: ['东方修仙词', '现代网络用语', '空洞史诗口号'],
    },
    powerSystems: [
      {
        id: 'magic-circle',
        name: '魔法阶位',
        appliesTo: ['法师', '术士', '神职者'],
        levels: ['学徒', '一环', '二环', '三环', '四环', '五环', '六环', '七环', '八环', '九环'],
        advancementRule: '依靠法术知识、施法资质、仪式资源和信仰渠道晋升。',
        limitations: '不同施法体系有不同来源和禁忌。',
        cost: '过度施法会造成精神负担、神术反噬或污染。',
        taboo: '不要让高环法术没有仪式成本。',
      },
    ],
    speciesSystem: [
      {
        id: 'human',
        name: '人类',
        entityType: 'human',
        summary: '王国体系的主体种族，掌控大多数城镇与政治结构。',
        traits: ['组织能力强', '阶级分化明显', '扩张性强'],
        commonIdentities: ['骑士', '法师', '平民', '贵族'],
        relationToHumans: '主体种族。',
        storyUse: '承接政治、信仰和战争主线。',
      },
      {
        id: 'elf',
        name: '精灵',
        entityType: 'nonhuman',
        summary: '与自然、长寿和魔法文明联系更深的异族。',
        traits: ['寿命长', '审美与秩序观独特', '对人类保持警惕'],
        commonIdentities: ['林地守卫', '古法术继承者'],
        relationToHumans: '既可能联盟，也可能因为历史旧账敌对。',
        storyUse: '提供文明差异和古老视角。',
      },
    ],
    factionSystem: [
      {
        id: 'kingdom',
        name: '王国',
        factionType: '国家',
        summary: '以王权、贵族和军队支撑的世俗秩序。',
        structure: '王室、贵族领主、骑士团、税务体系。',
        resources: '土地、税赋、兵力、港口与矿山。',
        externalRelations: '与教会、公会和异族长期博弈。',
        recruitFrom: '贵族、封臣、雇佣军和平民。',
        notableSites: ['王城', '边境要塞'],
      },
      {
        id: 'church',
        name: '教会',
        factionType: '信仰组织',
        summary: '掌握信仰解释权和部分超凡力量渠道的神权组织。',
        structure: '教阶、修会、审判所。',
        resources: '神术、信众、圣物、舆论影响力。',
        externalRelations: '与王国合作竞争并行。',
        recruitFrom: '神职者、修士、虔诚信徒。',
        notableSites: ['大教堂', '圣物库'],
      },
    ],
    characterEcology: {
      overview: '角色生态要覆盖王国、教会、魔法体系与异族关系，不只做人类骑士或法师。',
      slots: [
        {
          id: 'crown-link',
          label: '王国线主角',
          entityType: 'human',
          species: '人类',
          narrativeFunction: '连接战争、政务与个人命运。',
          contextLink: '必须受到王权或贵族秩序牵引。',
          preferredFactions: ['王国'],
          powerBias: ['魔法阶位'],
        },
        {
          id: 'faith-node',
          label: '信仰冲突节点',
          entityType: 'human',
          species: '人类',
          narrativeFunction: '承载神权与世俗秩序的矛盾。',
          contextLink: '与主角形成价值观或立场冲突。',
          preferredFactions: ['教会'],
          powerBias: ['魔法阶位'],
        },
      ],
    },
    mapBlueprint: {
      overview: '地图按大陆/王国、城邦/领地、教堂/要塞/遗迹展开，服务战争、政治与冒险。',
      levels: [
        {
          depth: 1,
          label: '大陆/王国',
          nodeTypes: ['大陆', '王国', '公国'],
          relationHint: '定义政权边界和文明圈层。',
          suggestedCount: 2,
          examples: ['洛兰王国', '北境公国'],
        },
        {
          depth: 2,
          label: '城邦/领地',
          nodeTypes: ['王城', '边境领', '林地', '教区'],
          relationHint: '承载势力驻点和人口中心。',
          suggestedCount: 3,
          examples: ['银冠城', '灰谷教区'],
        },
        {
          depth: 3,
          label: '要塞/遗迹/神殿',
          nodeTypes: ['要塞', '神殿', '遗迹', '港口'],
          relationHint: '用于战争、探索和圣物争夺。',
          suggestedCount: 4,
          examples: ['圣焰大教堂', '黑石要塞'],
        },
      ],
    },
    writingConstraints: createWritingConstraints(
      '把王国、教会和异族关系写成现实利益链，不要只喊史诗口号。',
      '对白要带阶层感、礼仪感和立场差异。',
      ['古老而神秘', '命运的指引', '史诗般的伟大', '光与暗的永恒战争'],
      ['专有名词可保留，普通概念不要加引号。'],
      getDefaultRealityOptions('western-fantasy'),
    ),
  },
}

const GENRE_ALIAS_RULES: Array<{ pattern: RegExp; key: GenreRulePackKey }> = [
  { pattern: /\u4e27\u5c38|\u672b\u4e16|\u75c5\u6bd2|\u5c38\u6f6e/u, key: 'zombie' },
  { pattern: /\u5386\u53f2\u6b63\u5267|\u5386\u53f2\u5c0f\u8bf4|\u67b6\u7a7a\u5386\u53f2|\u7c7b\u5386\u53f2|\u5bab\u5ef7|\u671d\u5802|\u738b\u671d|\u53f2\u8bd7\u5386\u53f2/u, key: 'historical' },
  { pattern: /\u4ed9\u4fa0|\u4fee\u771f|\u4fee\u4ed9|\u4ed9\u754c|\u5b97\u95e8/u, key: 'xianxia' },
  { pattern: /\u6b66\u4fa0|\u6c5f\u6e56|\u4fa0\u5ba2|\u6b66\u6797|\u9556\u5c40|\u5e2e\u4f1a/u, key: 'wuxia' },
  { pattern: /\u7384\u5e7b|\u6597\u7834|\u6597\u6c14|\u5347\u7ea7/u, key: 'fantasy' },
  { pattern: /\u60ac\u7591|\u63a8\u7406|\u5211\u4fa6|\u4fa6\u67e5|\u8c03\u67e5|\u793e\u4f1a\u6d3e|\u672c\u683c|\u7f6a\u6848|\u65e7\u6848/u, key: 'modern-mystery' },
  { pattern: /\u90fd\u5e02\u5f02\u80fd|\u5f02\u80fd|\u73b0\u4ee3\u5f02\u80fd|\u8d85\u80fd\u529b|\u89c9\u9192/u, key: 'urban-ability' },
  { pattern: /\u897f\u5e7b|\u9b54\u6cd5|\u6559\u4f1a|\u738b\u56fd/u, key: 'western-fantasy' },
]

function resolvePackKey(genreName?: string | null): GenreRulePackKey {
  const text = asText(genreName)
  if (!text) return 'generic'

  for (const rule of GENRE_ALIAS_RULES) {
    if (rule.pattern.test(text)) return rule.key
  }

  return 'generic'
}

export function getBuiltinGenreRules(genreName?: string | null): GenreWorldRules {
  const seed = clone(BUILTIN_GENRE_RULE_PACKS[resolvePackKey(genreName)])
  return {
    ...seed,
    worldDynamics: normalizeWorldDynamics(
      seed.worldDynamics,
      getDefaultWorldDynamics(seed.genreProfile.key),
    ),
    timelineConfig: normalizeTimelineConfig(
      seed.timelineConfig,
      getDefaultTimelineConfig(seed.genreProfile.key),
    ),
  }
}

function normalizeGenreProfile(
  value: unknown,
  fallback: GenreProfile,
  genreName?: string | null,
  legacy?: Record<string, unknown>,
): GenreProfile {
  const base = clone(fallback)
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const resolvedGenreName = asText(record.name) || asText(genreName) || base.name

  return {
    key: resolvePackKey(resolvedGenreName),
    name: resolvedGenreName,
    subgenre: asText(record.subgenre) || base.subgenre,
    worldviewTone: asText(record.worldviewTone) || asText(legacy?.geography) || base.worldviewTone,
    socialFrame: asText(record.socialFrame) || asText(legacy?.social_structure) || base.socialFrame,
    narrativeFocus: dedupe([
      ...toStringArray(record.narrativeFocus),
      ...toStringArray(legacy?.special_terms),
      ...base.narrativeFocus,
    ]).slice(0, 8),
    languageAvoidances: dedupe([
      ...toStringArray(record.languageAvoidances),
      ...toStringArray(legacy?.forbidden_elements),
      ...base.languageAvoidances,
    ]).slice(0, 10),
  }
}

function normalizePowerSystems(value: unknown, fallback: PowerSystem[], legacy?: Record<string, unknown>): PowerSystem[] {
  const fromArray = normalizeArray(value, fallback, (item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    const name = asText(record.name)
    if (!name) return null
    return {
      id: asText(record.id) || `power-${index + 1}`,
      name,
      appliesTo: dedupe(toStringArray(record.appliesTo)),
      levels: dedupe(toStringArray(record.levels)),
      advancementRule: asText(record.advancementRule),
      limitations: asText(record.limitations),
      cost: asText(record.cost),
      taboo: asText(record.taboo),
    }
  })

  if (Array.isArray(value)) return fromArray

  const powerSystemRecord = legacy?.power_system && typeof legacy.power_system === 'object'
    ? legacy.power_system as Record<string, unknown>
    : undefined

  const legacyLevels = dedupe([
    ...toStringArray(legacy?.power_levels),
    ...toStringArray(powerSystemRecord?.levels),
  ])
  const legacyName = asText(legacy?.power_system_name) || asText(powerSystemRecord?.name)
  const legacyRules = asText(legacy?.power_rules) || asText(legacy?.logic_constraints) || asText(powerSystemRecord?.rules)

  if (!legacyName && legacyLevels.length === 0 && !legacyRules) {
    return clone(fallback)
  }

  const seed = clone(fallback[0] || {
    id: 'legacy-power',
    name: '力量体系',
    appliesTo: [],
    levels: [],
    advancementRule: '',
    limitations: '',
    cost: '',
    taboo: '',
  })

  return [{
    ...seed,
    name: legacyName || seed.name,
    levels: legacyLevels.length > 0 ? legacyLevels : seed.levels,
    advancementRule: legacyRules || seed.advancementRule,
  }]
}

function normalizeSpecies(value: unknown, fallback: SpeciesProfile[]): SpeciesProfile[] {
  return normalizeArray(value, fallback, (item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    const name = asText(record.name)
    if (!name) return null
    return {
      id: asText(record.id) || `species-${index + 1}`,
      name,
      entityType: asText(record.entityType) || 'human',
      summary: asText(record.summary),
      traits: dedupe(toStringArray(record.traits)),
      commonIdentities: dedupe(toStringArray(record.commonIdentities)),
      relationToHumans: asText(record.relationToHumans),
      storyUse: asText(record.storyUse),
    }
  })
}

function normalizeFactions(value: unknown, fallback: FactionProfile[]): FactionProfile[] {
  return normalizeArray(value, fallback, (item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    const name = asText(record.name)
    if (!name) return null
    return {
      id: asText(record.id) || `faction-${index + 1}`,
      name,
      factionType: asText(record.factionType) || '势力',
      summary: asText(record.summary),
      structure: asText(record.structure),
      resources: asText(record.resources),
      externalRelations: asText(record.externalRelations),
      recruitFrom: asText(record.recruitFrom),
      notableSites: dedupe(toStringArray(record.notableSites)),
    }
  })
}

function normalizeCharacterEcology(value: unknown, fallback: CharacterEcology): CharacterEcology {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    overview: asText(record.overview) || fallback.overview,
    slots: normalizeArray(record.slots, fallback.slots, (item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const slot = item as Record<string, unknown>
      const label = asText(slot.label)
      if (!label) return null
      return {
        id: asText(slot.id) || `ecology-${index + 1}`,
        label,
        entityType: asText(slot.entityType) || 'human',
        species: asText(slot.species) || '',
        narrativeFunction: asText(slot.narrativeFunction),
        contextLink: asText(slot.contextLink),
        preferredFactions: dedupe(toStringArray(slot.preferredFactions)),
        powerBias: dedupe(toStringArray(slot.powerBias)),
      }
    }),
  }
}

function normalizeMapBlueprint(value: unknown, fallback: MapBlueprint, legacy?: Record<string, unknown>): MapBlueprint {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    overview: asText(record.overview) || asText(legacy?.geography) || fallback.overview,
    levels: normalizeArray(record.levels, fallback.levels, (item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const layer = item as Record<string, unknown>
      const label = asText(layer.label)
      if (!label) return null
      return {
        depth: asNumber(layer.depth, index + 1),
        label,
        nodeTypes: dedupe(toStringArray(layer.nodeTypes)),
        relationHint: asText(layer.relationHint),
        suggestedCount: Math.max(1, asNumber(layer.suggestedCount, fallback.levels[index]?.suggestedCount || 3)),
        examples: dedupe(toStringArray(layer.examples)),
      }
    }),
  }
}

export function assessHistoricalGrounding(input: {
  genreName?: string | null
  worldRulesJson?: string | null
  backgroundText?: string | null
  glossaryTerms?: string[]
}): HistoricalGroundingAssessment {
  const genreName = asText(input.genreName)
  const worldRulesText = asText(input.worldRulesJson)
  const backgroundText = asText(input.backgroundText)
  const glossaryTerms = dedupe((input.glossaryTerms || []).map((item) => item.trim()).filter(Boolean))
  const aggregateText = [genreName, worldRulesText, backgroundText, glossaryTerms.join('\n')].filter(Boolean).join('\n')

  const looksHistorical = /历史|王朝|朝堂|宫廷|侯爵|帝国旧制|架空历史|史诗历史|类历史/u.test(genreName)
    || /王朝|郡县|州府|礼制|官制|宗庙|年号|分歧点|架空/u.test(aggregateText)
  if (!looksHistorical) {
    return {
      mode: 'none',
      strictness: 'none',
      coverage: 'none',
      conservativeFallbackActive: false,
      sourceSignals: [],
      missingSignals: [],
      summary: '当前项目不属于历史 grounding 范围。',
    }
  }

  const mode: HistoricalGroundingMode = /架空历史|分歧点|虚构王朝|自定义制度/u.test(aggregateText)
    ? 'alternate_history'
    : /类历史奇幻|历史奇幻|超自然|神谕|妖术|魔法/u.test(aggregateText)
      ? 'pseudo_historical_fantasy'
      : 'historical_realist'

  const strictness: HistoricalGroundingStrictness = mode === 'historical_realist'
    ? 'high'
    : mode === 'alternate_history'
      ? 'medium'
      : 'low'

  const sourceSignals: string[] = []
  if (worldRulesText.length >= 80) sourceSignals.push('world_rules')
  if (backgroundText.length >= 80) sourceSignals.push('project_background')
  if (glossaryTerms.length >= 3) sourceSignals.push('glossary_terms')
  if (/年号|纪年|时代|王朝|礼制|官制|郡县|州府|分歧点|架空/u.test(aggregateText)) sourceSignals.push('era_or_institution')

  const missingSignals = [
    sourceSignals.includes('world_rules') ? '' : 'world_rules',
    sourceSignals.includes('project_background') ? '' : 'project_background',
    sourceSignals.includes('glossary_terms') ? '' : 'glossary_terms',
    sourceSignals.includes('era_or_institution') ? '' : 'era_or_institution',
  ].filter(Boolean)

  const coverage: HistoricalGroundingCoverage = sourceSignals.length >= 3
    ? 'grounded'
    : sourceSignals.length >= 1
      ? 'partial'
      : 'none'

  const conservativeFallbackActive = coverage !== 'grounded'
  const modeLabel = mode === 'historical_realist'
    ? '历史正剧'
    : mode === 'alternate_history'
      ? '架空历史'
      : '类历史奇幻'
  const coverageLabel = coverage === 'grounded' ? '来源较完整' : coverage === 'partial' ? '来源部分覆盖' : '来源缺失'

  return {
    mode,
    strictness,
    coverage,
    conservativeFallbackActive,
    sourceSignals,
    missingSignals,
    summary: `${modeLabel} · ${coverageLabel}${conservativeFallbackActive ? '，已启用保守 fallback。' : '。'}`,
  }
}

function normalizeWorldDynamics(value: unknown, fallback: WorldDynamics): WorldDynamics {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    overview: asText(record.overview) || fallback.overview,
    climateCycles: normalizeArray(record.climateCycles, fallback.climateCycles, (item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const cycle = item as Record<string, unknown>
      const region = asText(cycle.region)
      const pattern = asText(cycle.pattern)
      const seasonalShift = asText(cycle.seasonalShift)
      const hazardTrigger = asText(cycle.hazardTrigger)
      const travelImpact = asText(cycle.travelImpact)
      const resourceImpact = asText(cycle.resourceImpact)
      if (!region && !pattern && !seasonalShift && !hazardTrigger && !travelImpact && !resourceImpact) return null
      return {
        id: asText(cycle.id) || `climate-${index + 1}`,
        region,
        pattern,
        seasonalShift,
        hazardTrigger,
        travelImpact,
        resourceImpact,
      }
    }),
    economyLoops: normalizeArray(record.economyLoops ?? record.economicSystems, fallback.economyLoops, (item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const loop = item as Record<string, unknown>
      const name = asText(loop.name)
      const coreResource = asText(loop.coreResource)
      const circulationPath = asText(loop.circulationPath)
      const controller = asText(loop.controller)
      const scarcityTrigger = asText(loop.scarcityTrigger)
      const volatilityTrigger = asText(loop.volatilityTrigger)
      const storyUse = asText(loop.storyUse)
      if (!name && !coreResource && !circulationPath && !controller && !scarcityTrigger && !volatilityTrigger && !storyUse) return null
      return {
        id: asText(loop.id) || `economy-${index + 1}`,
        name,
        coreResource,
        circulationPath,
        controller,
        scarcityTrigger,
        volatilityTrigger,
        storyUse,
      }
    }),
  }
}

function normalizeTimelineConfig(
  value: unknown,
  fallback: TimelineConfig,
): TimelineConfig {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    calendarType: (asText(record.calendarType) as TimelineCalendarType) || fallback.calendarType,
    eraName: asText(record.eraName) || fallback.eraName,
    epochLabel: asText(record.epochLabel) || fallback.epochLabel,
    baseYearLabel: asText(record.baseYearLabel) || fallback.baseYearLabel,
    displayPattern: asText(record.displayPattern) || fallback.displayPattern,
    relativeZeroLabel: asText(record.relativeZeroLabel) || fallback.relativeZeroLabel,
    recommendedEventTypes: dedupe([
      ...toStringArray(record.recommendedEventTypes),
      ...fallback.recommendedEventTypes,
    ]).slice(0, 12),
    precisionOptions: dedupe([
      ...toStringArray(record.precisionOptions),
      ...fallback.precisionOptions,
    ]).slice(0, 8),
  }
}

function normalizeWritingConstraints(
  value: unknown,
  fallback: WritingConstraints,
  legacy?: Record<string, unknown>,
): WritingConstraints {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  const rawRealismLevel = asText(record.realismLevel) || asText(legacy?.realism_level)
  const realismLevel = rawRealismLevel === 'strict-realism'
    || rawRealismLevel === 'rule-realism'
    || rawRealismLevel === 'stylized-fantasy'
    ? rawRealismLevel
    : fallback.realismLevel

  return {
    antiQuoteEmphasis: typeof record.antiQuoteEmphasis === 'boolean'
      ? record.antiQuoteEmphasis
      : fallback.antiQuoteEmphasis,
    antiConceptSlogans: typeof record.antiConceptSlogans === 'boolean'
      ? record.antiConceptSlogans
      : fallback.antiConceptSlogans,
    antiSymmetricLines: typeof record.antiSymmetricLines === 'boolean'
      ? record.antiSymmetricLines
      : fallback.antiSymmetricLines,
    narrationStyle: asText(record.narrationStyle) || asText(legacy?.logic_constraints) || fallback.narrationStyle,
    dialogueStyle: asText(record.dialogueStyle) || asText(legacy?.honorifics) || fallback.dialogueStyle,
    forbiddenPhrases: dedupe([
      ...toStringArray(record.forbiddenPhrases),
      ...toStringArray(legacy?.forbidden_elements),
      ...fallback.forbiddenPhrases,
    ]).slice(0, 12),
    extraRules: dedupe([
      ...toStringArray(record.extraRules),
      ...toStringArray(legacy?.special_terms),
      ...fallback.extraRules,
    ]).slice(0, 12),
    realismLevel,
    sciencePolicy: asText(record.sciencePolicy) || asText(legacy?.science_policy) || fallback.sciencePolicy,
    physicsPolicy: asText(record.physicsPolicy) || asText(legacy?.physics_policy) || fallback.physicsPolicy,
    commonSenseFocus: dedupe([
      ...toStringArray(record.commonSenseFocus),
      ...toStringArray(legacy?.common_sense_focus),
      ...fallback.commonSenseFocus,
    ]).slice(0, 8),
    contextAlignmentFocus: dedupe([
      ...toStringArray(record.contextAlignmentFocus),
      ...toStringArray(legacy?.context_alignment_focus),
      ...fallback.contextAlignmentFocus,
    ]).slice(0, 8),
  }
}

export function normalizeWorldRules(raw: unknown, genreName?: string | null): GenreWorldRules {
  const base = getBuiltinGenreRules(genreName)
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}

  return {
    version: 2,
    genreProfile: normalizeGenreProfile(record.genreProfile, base.genreProfile, genreName, record),
    powerSystems: normalizePowerSystems(record.powerSystems, base.powerSystems, record),
    speciesSystem: normalizeSpecies(record.speciesSystem, base.speciesSystem),
    factionSystem: normalizeFactions(record.factionSystem, base.factionSystem),
    characterEcology: normalizeCharacterEcology(record.characterEcology, base.characterEcology),
    mapBlueprint: normalizeMapBlueprint(record.mapBlueprint, base.mapBlueprint, record),
    worldDynamics: normalizeWorldDynamics(record.worldDynamics, base.worldDynamics),
    timelineConfig: normalizeTimelineConfig(
      record.timelineConfig,
      getDefaultTimelineConfig(base.genreProfile.key),
    ),
    writingConstraints: normalizeWritingConstraints(record.writingConstraints, base.writingConstraints, record),
  }
}

export function parseWorldRulesJson(raw?: string | null, genreName?: string | null): GenreWorldRules {
  if (!raw) return getBuiltinGenreRules(genreName)

  try {
    return normalizeWorldRules(JSON.parse(raw) as unknown, genreName)
  } catch {
    return getBuiltinGenreRules(genreName)
  }
}

export function stringifyWorldRules(rules: GenreWorldRules): string {
  return JSON.stringify(normalizeWorldRules(rules, rules.genreProfile.name))
}

export function getFactionNameOptions(rules: GenreWorldRules): string[] {
  return dedupe(rules.factionSystem.map((faction) => faction.name))
}

export function getSpeciesNameOptions(rules: GenreWorldRules): string[] {
  return dedupe(rules.speciesSystem.map((species) => species.name))
}

export function getEntityTypeOptions(rules: GenreWorldRules): string[] {
  return dedupe(rules.speciesSystem.map((species) => species.entityType))
}

export function getPowerSystemNameOptions(rules: GenreWorldRules): string[] {
  return dedupe(rules.powerSystems.map((system) => system.name))
}

export function getMapNodeTypeOptions(rules: GenreWorldRules): string[] {
  return dedupe(rules.mapBlueprint.levels.flatMap((level) => level.nodeTypes))
}

export function getMapBlueprintDepth(rules: GenreWorldRules): number {
  return Math.max(...rules.mapBlueprint.levels.map((level) => level.depth), 1)
}

export function getBlueprintLevelByDepth(rules: GenreWorldRules, depth: number): MapBlueprintLevel | undefined {
  return rules.mapBlueprint.levels.find((level) => level.depth === depth)
}

export function buildCharacterEcologySummary(rules: GenreWorldRules): string {
  const lines = rules.characterEcology.slots.map((slot) => {
    const extra = [
      slot.entityType ? `实体=${slot.entityType}` : '',
      slot.species ? `种族=${slot.species}` : '',
      slot.narrativeFunction ? `作用=${slot.narrativeFunction}` : '',
      slot.contextLink ? `关联=${slot.contextLink}` : '',
      slot.preferredFactions.length > 0 ? `优先势力=${slot.preferredFactions.join('、')}` : '',
      slot.powerBias.length > 0 ? `优先体系=${slot.powerBias.join('、')}` : '',
    ].filter(Boolean).join('；')

    return `- ${slot.label}${extra ? `：${extra}` : ''}`
  })

  return [rules.characterEcology.overview, ...lines].filter(Boolean).join('\n')
}

export function buildMapBlueprintSummary(rules: GenreWorldRules): string {
  const lines = rules.mapBlueprint.levels
    .sort((left, right) => left.depth - right.depth)
    .map((level) => {
      const parts = [
        `${level.depth}级=${level.label}`,
        level.nodeTypes.length > 0 ? `节点类型=${level.nodeTypes.join('、')}` : '',
        level.relationHint ? `作用=${level.relationHint}` : '',
        level.examples.length > 0 ? `例子=${level.examples.join('、')}` : '',
      ].filter(Boolean)

      return `- ${parts.join('；')}`
    })

  return [rules.mapBlueprint.overview, ...lines].filter(Boolean).join('\n')
}

export function buildWorldDynamicsSummary(rules: GenreWorldRules): string {
  const climateLines = rules.worldDynamics.climateCycles.map((cycle) => {
    const parts = [
      cycle.region ? `区域=${cycle.region}` : '',
      cycle.pattern ? `常态=${cycle.pattern}` : '',
      cycle.seasonalShift ? `季节变化=${cycle.seasonalShift}` : '',
      cycle.hazardTrigger ? `灾害触发=${cycle.hazardTrigger}` : '',
      cycle.travelImpact ? `行动影响=${cycle.travelImpact}` : '',
      cycle.resourceImpact ? `资源影响=${cycle.resourceImpact}` : '',
    ].filter(Boolean)

    return parts.length > 0 ? `- 气候：${parts.join('；')}` : ''
  }).filter(Boolean)

  const economyLines = rules.worldDynamics.economyLoops.map((loop) => {
    const parts = [
      loop.name ? `链路=${loop.name}` : '',
      loop.coreResource ? `核心资源=${loop.coreResource}` : '',
      loop.circulationPath ? `流通=${loop.circulationPath}` : '',
      loop.controller ? `控制者=${loop.controller}` : '',
      loop.scarcityTrigger ? `稀缺触发=${loop.scarcityTrigger}` : '',
      loop.volatilityTrigger ? `波动触发=${loop.volatilityTrigger}` : '',
      loop.storyUse ? `剧情作用=${loop.storyUse}` : '',
    ].filter(Boolean)

    return parts.length > 0 ? `- 经济：${parts.join('；')}` : ''
  }).filter(Boolean)

  return [
    rules.worldDynamics.overview,
    ...climateLines,
    ...economyLines,
  ].filter(Boolean).join('\n')
}

export function buildTimelineConfigSummary(rules: GenreWorldRules): string {
  const config = rules.timelineConfig
  const lines = [
    config.calendarType ? `时间制=${config.calendarType}` : '',
    config.eraName ? `纪年体系=${config.eraName}` : '',
    config.epochLabel ? `时代标签=${config.epochLabel}` : '',
    config.baseYearLabel ? `起始标记=${config.baseYearLabel}` : '',
    config.relativeZeroLabel ? `时间零点=${config.relativeZeroLabel}` : '',
    config.displayPattern ? `展示格式=${config.displayPattern}` : '',
    config.precisionOptions.length > 0 ? `常用精度=${config.precisionOptions.join(' / ')}` : '',
    config.recommendedEventTypes.length > 0 ? `事件类型=${config.recommendedEventTypes.join(' / ')}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

export function buildWritingStyleSummary(writing: WritingConstraints): string {
  return [
    writing.narrationStyle ? `\u53d9\u8ff0=${writing.narrationStyle}` : '',
    writing.dialogueStyle ? `\u5bf9\u767d=${writing.dialogueStyle}` : '',
    writing.forbiddenPhrases.length > 0 ? `\u7981\u7528\u8bcd=${writing.forbiddenPhrases.join('\u3001')}` : '',
    writing.extraRules.length > 0 ? `\u989d\u5916\u7ea6\u675f=${writing.extraRules.join('\u3001')}` : '',
  ].filter(Boolean).join('\n')
}

export function buildRealityConstraintSummary(writing: WritingConstraints): string {
  return [
    `\u771f\u5b9e\u5ea6=${describeRealismLevel(writing.realismLevel)}`,
    writing.sciencePolicy ? `\u79d1\u5b66\u8fb9\u754c=${writing.sciencePolicy}` : '',
    writing.physicsPolicy ? `\u7269\u7406\u8fb9\u754c=${writing.physicsPolicy}` : '',
    writing.commonSenseFocus.length > 0 ? `\u5e38\u8bc6\u91cd\u70b9=${writing.commonSenseFocus.join('\u3001')}` : '',
    writing.contextAlignmentFocus.length > 0 ? `\u4e0a\u4e0b\u6587\u91cd\u70b9=${writing.contextAlignmentFocus.join('\u3001')}` : '',
  ].filter(Boolean).join('\n')
}

export function buildWorldRulesSummary(rules: GenreWorldRules): string {
  const lines: string[] = [
    `题材定位：${rules.genreProfile.name}${rules.genreProfile.subgenre ? ` / ${rules.genreProfile.subgenre}` : ''}`,
    `世界底色：${rules.genreProfile.worldviewTone}`,
    `社会结构：${rules.genreProfile.socialFrame}`,
  ]

  if (rules.genreProfile.narrativeFocus.length > 0) {
    lines.push(`叙事焦点：${rules.genreProfile.narrativeFocus.join('、')}`)
  }

  for (const system of rules.powerSystems.slice(0, 3)) {
    const pieces = [
      system.name,
      system.levels.length > 0 ? `等级=${system.levels.join(' / ')}` : '',
      system.advancementRule ? `晋升=${system.advancementRule}` : '',
      system.limitations ? `限制=${system.limitations}` : '',
      system.cost ? `代价=${system.cost}` : '',
    ].filter(Boolean)
    lines.push(`力量体系：${pieces.join('；')}`)
  }

  if (rules.speciesSystem.length > 0) {
    lines.push(`角色种族：${rules.speciesSystem.slice(0, 6).map((item) => `${item.name}(${item.entityType})`).join('、')}`)
  }

  if (rules.factionSystem.length > 0) {
    lines.push(`核心势力：${rules.factionSystem.slice(0, 6).map((item) => `${item.name}[${item.factionType}]`).join('、')}`)
  }

  const ecology = buildCharacterEcologySummary(rules)
  if (ecology) {
    lines.push(`角色生态：\n${ecology}`)
  }

  const mapSummary = buildMapBlueprintSummary(rules)
  if (mapSummary) {
    lines.push(`地图蓝图：\n${mapSummary}`)
  }

  const dynamicsSummary = buildWorldDynamicsSummary(rules)
  if (dynamicsSummary) {
    lines.push(`环境经济：\n${dynamicsSummary}`)
  }

  const reality = buildRealityConstraintSummary(rules.writingConstraints)
  if (reality) {
    lines.push(`\u771f\u5b9e\u5ea6\u7ea6\u675f:\n${reality}`)
  }

  const writing = buildWritingStyleSummary(rules.writingConstraints)
  if (writing) {
    lines.push(`\u8bed\u8a00\u7ea6\u675f:\n${writing}`)
  }

  return lines.join('\n')
}
