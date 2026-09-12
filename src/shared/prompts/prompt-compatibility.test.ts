import { beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import * as barrel from '../prompt-library'
import * as commonPrompts from './prompt-common'
import * as assetPrompts from './asset-prompts'
import * as planningPrompts from './planning-prompts'
import * as writingPrompts from './writing-prompts'
import * as reviewPrompts from './review-prompts'

// Load service boundaries through Vitest: static imports would pull the Electron
// database into the composite web project. Their types are checked by typecheck:node.
let electronPrompts: Record<string, unknown>
let storyPrompts: Record<string, unknown>
beforeAll(async () => {
  electronPrompts = await vi.importActual('../../../electron/services/prompts')
  storyPrompts = await vi.importActual('../../../electron/services/story-prompts')
})

const database = vi.hoisted(() => ({ content: '', audit: vi.fn() }))

// Only persistence is stubbed. Both production wrappers and override rendering run unchanged.
vi.mock('../../../electron/database/db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ all: () => database.content ? [{ key: 'fixture', content: database.content }] : [] }) }) }),
    insert: () => ({ values: (value: unknown) => ({ run: () => database.audit(value) }) }),
  }),
}))


// Frozen from eda157d408f9416843b0e695fd8fb2205e2d78d4; generator and full byte-comparison evidence: evidence/NF-17/freeze-baseline.cjs.

const base: Record<string, unknown> = {
  "key": " key：渡口查验\r\n林远持印🗝️ ",
  "label": " label：渡口查验\r\n林远持印🗝️ ",
  "name": " name：渡口查验\r\n林远持印🗝️ ",
  "description": " description：渡口查验\r\n林远持印🗝️ ",
  "category": " category：渡口查验\r\n林远持印🗝️ ",
  "params": [
    "params：守住渡口",
    "params：接住脚步声"
  ],
  "template": " template：渡口查验\r\n林远持印🗝️ ",
  "novelTitle": " novelTitle：渡口查验\r\n林远持印🗝️ ",
  "novelSynopsis": " novelSynopsis：渡口查验\r\n林远持印🗝️ ",
  "genre": "现代悬疑",
  "worldSummary": " worldSummary：渡口查验\r\n林远持印🗝️ ",
  "storyCore": " storyCore：渡口查验\r\n林远持印🗝️ ",
  "gender": " gender：渡口查验\r\n林远持印🗝️ ",
  "surnameHint": " surnameHint：渡口查验\r\n林远持印🗝️ ",
  "speciesSummary": " speciesSummary：渡口查验\r\n林远持印🗝️ ",
  "factionSummary": " factionSummary：渡口查验\r\n林远持印🗝️ ",
  "ecologySummary": " ecologySummary：渡口查验\r\n林远持印🗝️ ",
  "mapSummary": " mapSummary：渡口查验\r\n林远持印🗝️ ",
  "writingConstraints": " writingConstraints：渡口查验\r\n林远持印🗝️ ",
  "attemptNumber": 2,
  "protagonistSummary": " protagonistSummary：渡口查验\r\n林远持印🗝️ ",
  "existingNames": " existingNames：渡口查验\r\n林远持印🗝️ ",
  "count": 8,
  "genderRatio": " genderRatio：渡口查验\r\n林远持印🗝️ ",
  "specialRequirements": " specialRequirements：渡口查验\r\n林远持印🗝️ ",
  "protagonistRule": " protagonistRule：渡口查验\r\n林远持印🗝️ ",
  "lockedName": " lockedName：渡口查验\r\n林远持印🗝️ ",
  "lockedRoleType": " lockedRoleType：渡口查验\r\n林远持印🗝️ ",
  "currentProfile": " currentProfile：渡口查验\r\n林远持印🗝️ ",
  "relatedCharacters": " relatedCharacters：渡口查验\r\n林远持印🗝️ ",
  "relationSummary": "同僚互相提防",
  "characterList": " characterList：渡口查验\r\n林远持印🗝️ ",
  "mapStructure": " mapStructure：渡口查验\r\n林远持印🗝️ ",
  "namedPlaces": " namedPlaces：渡口查验\r\n林远持印🗝️ ",
  "storyGoal": " storyGoal：渡口查验\r\n林远持印🗝️ ",
  "coreConflict": " coreConflict：渡口查验\r\n林远持印🗝️ ",
  "mainPlot": " mainPlot：渡口查验\r\n林远持印🗝️ ",
  "subPlots": " subPlots：渡口查验\r\n林远持印🗝️ ",
  "ending": " ending：渡口查验\r\n林远持印🗝️ ",
  "totalChapters": 8,
  "rhythmSummary": " rhythmSummary：渡口查验\r\n林远持印🗝️ ",
  "background": " background：渡口查验\r\n林远持印🗝️ ",
  "protagonistReference": " protagonistReference：渡口查验\r\n林远持印🗝️ ",
  "targetWords": 3200,
  "rhythmTemplateSection": " rhythmTemplateSection：渡口查验\r\n林远持印🗝️ ",
  "arcName": " arcName：渡口查验\r\n林远持印🗝️ ",
  "arcGoal": " arcGoal：渡口查验\r\n林远持印🗝️ ",
  "arcSummary": " arcSummary：渡口查验\r\n林远持印🗝️ ",
  "arcGrowthLedger": " arcGrowthLedger：渡口查验\r\n林远持印🗝️ ",
  "arcCostLedger": " arcCostLedger：渡口查验\r\n林远持印🗝️ ",
  "arcTargetWords": 8,
  "chapterStart": 8,
  "chapterEnd": 8,
  "previousSummary": " previousSummary：渡口查验\r\n林远持印🗝️ ",
  "characterStates": " characterStates：渡口查验\r\n林远持印🗝️ ",
  "continuitySummary": " continuitySummary：渡口查验\r\n林远持印🗝️ ",
  "openLoops": " openLoops：渡口查验\r\n林远持印🗝️ ",
  "worldRulesSummary": " worldRulesSummary：渡口查验\r\n林远持印🗝️ ",
  "previousChapterOutlines": " previousChapterOutlines：渡口查验\r\n林远持印🗝️ ",
  "designGateDirective": " designGateDirective：渡口查验\r\n林远持印🗝️ ",
  "rhythmSection": " rhythmSection：渡口查验\r\n林远持印🗝️ ",
  "creativeStageSummary": " creativeStageSummary：渡口查验\r\n林远持印🗝️ ",
  "timelineRules": " timelineRules：渡口查验\r\n林远持印🗝️ ",
  "characterSummary": " characterSummary：渡口查验\r\n林远持印🗝️ ",
  "locationSummary": " locationSummary：渡口查验\r\n林远持印🗝️ ",
  "itemSummary": " itemSummary：渡口查验\r\n林远持印🗝️ ",
  "existingEvents": " existingEvents：渡口查验\r\n林远持印🗝️ ",
  "chapterNum": 2,
  "chapterTitle": " chapterTitle：渡口查验\r\n林远持印🗝️ ",
  "chapterGoal": "查扣私盐",
  "hardConstraintContext": "",
  "dialogueVoiceLocks": " dialogueVoiceLocks：渡口查验\r\n林远持印🗝️ ",
  "plotPoints": " plotPoints：渡口查验\r\n林远持印🗝️ ",
  "emotionTone": " emotionTone：渡口查验\r\n林远持印🗝️ ",
  "writingContractSummary": "必须两次交锋",
  "themeChapterTest": " themeChapterTest：渡口查验\r\n林远持印🗝️ ",
  "currentArc": " currentArc：渡口查验\r\n林远持印🗝️ ",
  "worldRules": " worldRules：渡口查验\r\n林远持印🗝️ ",
  "worldStates": " worldStates：渡口查验\r\n林远持印🗝️ ",
  "previousSummaries": " previousSummaries：渡口查验\r\n林远持印🗝️ ",
  "previousChapterContext": " previousChapterContext：渡口查验\r\n林远持印🗝️ ",
  "lastChapterEnding": " lastChapterEnding：渡口查验\r\n林远持印🗝️ ",
  "styleTemplate": "作者样稿：他把印盒推回去，没接话。",
  "sceneWritingBrief": "以验印动作开场；允许一句闲谈；通过停顿表现隐瞒。",
  "dueForeshadows": " dueForeshadows：渡口查验\r\n林远持印🗝️ ",
  "continuityNotes": " continuityNotes：渡口查验\r\n林远持印🗝️ ",
  "timelineSummary": " timelineSummary：渡口查验\r\n林远持印🗝️ ",
  "timelineOpenThreads": " timelineOpenThreads：渡口查验\r\n林远持印🗝️ ",
  "activeThreads": " activeThreads：渡口查验\r\n林远持印🗝️ ",
  "recalledMemory": " recalledMemory：渡口查验\r\n林远持印🗝️ ",
  "chapterBridgePlan": "接住门外脚步声",
  "stepMemorySummary": "从验印结果继续推进",
  "runtimeAssertions": [
    "保持印盒位置"
  ],
  "povGuidance": " povGuidance：渡口查验\r\n林远持印🗝️ ",
  "povRotationGuidance": " povRotationGuidance：渡口查验\r\n林远持印🗝️ ",
  "sensoryGuidance": " sensoryGuidance：渡口查验\r\n林远持印🗝️ ",
  "narrativeRatioGuidance": " narrativeRatioGuidance：渡口查验\r\n林远持印🗝️ ",
  "storyPacingGuidance": " storyPacingGuidance：渡口查验\r\n林远持印🗝️ ",
  "hookContinuityGuidance": " hookContinuityGuidance：渡口查验\r\n林远持印🗝️ ",
  "expressionDedupGuidance": " expressionDedupGuidance：渡口查验\r\n林远持印🗝️ ",
  "summaryHealthGuidance": " summaryHealthGuidance：渡口查验\r\n林远持印🗝️ ",
  "voiceEvolutionGuidance": " voiceEvolutionGuidance：渡口查验\r\n林远持印🗝️ ",
  "promptTier": "standard",
  "rejectedDigests": [
    "rejectedDigests：守住渡口",
    "rejectedDigests：接住脚步声"
  ],
  "longTermMemory": " longTermMemory：渡口查验\r\n林远持印🗝️ ",
  "consistencyNotes": " consistencyNotes：渡口查验\r\n林远持印🗝️ ",
  "arcProgress": " arcProgress：渡口查验\r\n林远持印🗝️ ",
  "arcProgressStatus": " arcProgressStatus：渡口查验\r\n林远持印🗝️ ",
  "arcProgressCheckpoint": " arcProgressCheckpoint：渡口查验\r\n林远持印🗝️ ",
  "scenePlan": "场景1：验印；must_cover：发现印泥异色。",
  "draftContent": "林远打开印盒。\r\n“这不是昨天的颜色。”🗝️",
  "scenePlanSummary": " scenePlanSummary：渡口查验\r\n林远持印🗝️ ",
  "draftTextSummary": " draftTextSummary：渡口查验\r\n林远持印🗝️ ",
  "contractVersionSummary": " contractVersionSummary：渡口查验\r\n林远持印🗝️ ",
  "reviewRiskSummary": " reviewRiskSummary：渡口查验\r\n林远持印🗝️ ",
  "reviewProofSummary": " reviewProofSummary：渡口查验\r\n林远持印🗝️ ",
  "publishGateRiskSummary": " publishGateRiskSummary：渡口查验\r\n林远持印🗝️ ",
  "structuralAlertsSummary": " structuralAlertsSummary：渡口查验\r\n林远持印🗝️ ",
  "reviewNotes": "补足印泥颜色的来源证据。",
  "rewriteDeltaSummary": " rewriteDeltaSummary：渡口查验\r\n林远持印🗝️ ",
  "lockedParagraphs": [
    "“这不是昨天的颜色。”🗝️"
  ],
  "summary": " summary：渡口查验\r\n林远持印🗝️ ",
  "chapterContent": " chapterContent：渡口查验\r\n林远持印🗝️ ",
  "inboundOpenLoops": " inboundOpenLoops：渡口查验\r\n林远持印🗝️ ",
  "inboundDueForeshadows": " inboundDueForeshadows：渡口查验\r\n林远持印🗝️ ",
  "inboundContinuityNotes": " inboundContinuityNotes：渡口查验\r\n林远持印🗝️ ",
  "originalParagraph": " originalParagraph：渡口查验\r\n林远持印🗝️ ",
  "contextBefore": " contextBefore：渡口查验\r\n林远持印🗝️ ",
  "specificRequirements": " specificRequirements：渡口查验\r\n林远持印🗝️ ",
  "genreContext": "现代悬疑",
  "contentType": " contentType：渡口查验\r\n林远持印🗝️ ",
  "existingContent": " existingContent：渡口查验\r\n林远持印🗝️ ",
  "novelContext": " novelContext：渡口查验\r\n林远持印🗝️ ",
  "requirements": " requirements：渡口查验\r\n林远持印🗝️ ",
  "subplot": {
    "name": " name：渡口查验\r\n林远持印🗝️ ",
    "characters": " characters：渡口查验\r\n林远持印🗝️ ",
    "conflict": " conflict：渡口查验\r\n林远持印🗝️ ",
    "mainlineLink": " mainlineLink：渡口查验\r\n林远持印🗝️ ",
    "endChapter": " endChapter：渡口查验\r\n林远持印🗝️ "
  },
  "characters": " characters：渡口查验\r\n林远持印🗝️ ",
  "conflict": " conflict：渡口查验\r\n林远持印🗝️ ",
  "mainlineLink": " mainlineLink：渡口查验\r\n林远持印🗝️ ",
  "endChapter": " endChapter：渡口查验\r\n林远持印🗝️ ",
  "content": " content：渡口查验\r\n林远持印🗝️ ",
  "novelBackground": " novelBackground：渡口查验\r\n林远持印🗝️ ",
  "field": "story_goal",
  "currentContent": " currentContent：渡口查验\r\n林远持印🗝️ ",
  "relatedContext": " relatedContext：渡口查验\r\n林远持印🗝️ ",
  "stage": " stage：渡口查验\r\n林远持印🗝️ ",
  "taskFocus": " taskFocus：渡口查验\r\n林远持印🗝️ ",
  "extraContextLines": [
    "extraContextLines：守住渡口",
    "extraContextLines：接住脚步声"
  ],
  "extraRealityLines": [
    "extraRealityLines：守住渡口",
    "extraRealityLines：接住脚步声"
  ],
  "extraQualityLines": [
    "extraQualityLines：守住渡口",
    "extraQualityLines：接住脚步声"
  ],
  "extraLines": [
    "extraLines：守住渡口",
    "extraLines：接住脚步声"
  ],
  "userBackground": " userBackground：渡口查验\r\n林远持印🗝️ ",
  "worldTemplateSummary": " worldTemplateSummary：渡口查验\r\n林远持印🗝️ ",
  "targetTotalWords": 8,
  "existingArcs": " existingArcs：渡口查验\r\n林远持印🗝️ ",
  "threadsSummary": " threadsSummary：渡口查验\r\n林远持印🗝️ ",
  "existingPowerSystems": " existingPowerSystems：渡口查验\r\n林远持印🗝️ ",
  "existingFactions": " existingFactions：渡口查验\r\n林远持印🗝️ "
}

const variants = ["ordinary","empty","omitted","hard","simple","key","xianxia"] as const

const expected: Record<string, string[]> = {
  buildVariationHint: ["b4d8bbabbb94b7f4f20d75d1b23e20737214a65bed456eaec9923e8cfefee892","e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","b4d8bbabbb94b7f4f20d75d1b23e20737214a65bed456eaec9923e8cfefee892","b4d8bbabbb94b7f4f20d75d1b23e20737214a65bed456eaec9923e8cfefee892","b4d8bbabbb94b7f4f20d75d1b23e20737214a65bed456eaec9923e8cfefee892","b4d8bbabbb94b7f4f20d75d1b23e20737214a65bed456eaec9923e8cfefee892"],
  buildAvoidanceSection: ["a7f96f6cf9974fcf1e34a5a2bff052a4c40f6c1798d2a24351873791be8ea998","e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","a7f96f6cf9974fcf1e34a5a2bff052a4c40f6c1798d2a24351873791be8ea998","a7f96f6cf9974fcf1e34a5a2bff052a4c40f6c1798d2a24351873791be8ea998","a7f96f6cf9974fcf1e34a5a2bff052a4c40f6c1798d2a24351873791be8ea998","a7f96f6cf9974fcf1e34a5a2bff052a4c40f6c1798d2a24351873791be8ea998","a7f96f6cf9974fcf1e34a5a2bff052a4c40f6c1798d2a24351873791be8ea998"],
  buildHumanLanguageRules: ["8935e621c55208b5522497dd4bd9f60ff5c8958410cc74a322a75ac3d7b1ffb8","3cbb21fdfa774a18623f229f222aed62f8b9f6e6cd6394ff4a5a46a6a78ac29d","8935e621c55208b5522497dd4bd9f60ff5c8958410cc74a322a75ac3d7b1ffb8","8935e621c55208b5522497dd4bd9f60ff5c8958410cc74a322a75ac3d7b1ffb8","8935e621c55208b5522497dd4bd9f60ff5c8958410cc74a322a75ac3d7b1ffb8","8935e621c55208b5522497dd4bd9f60ff5c8958410cc74a322a75ac3d7b1ffb8","8935e621c55208b5522497dd4bd9f60ff5c8958410cc74a322a75ac3d7b1ffb8"],
  buildContextAlignmentRules: ["7e309cc094309e4bcd44dd7ca637267b718e0245c4e34525db6a885a1e103003","aae6b1db34ab2187f07bdc7882db2637153fa6aac2bfcd155f8f26242c23820a","7e309cc094309e4bcd44dd7ca637267b718e0245c4e34525db6a885a1e103003","7e309cc094309e4bcd44dd7ca637267b718e0245c4e34525db6a885a1e103003","7e309cc094309e4bcd44dd7ca637267b718e0245c4e34525db6a885a1e103003","7e309cc094309e4bcd44dd7ca637267b718e0245c4e34525db6a885a1e103003","7e309cc094309e4bcd44dd7ca637267b718e0245c4e34525db6a885a1e103003"],
  buildGenreRealityRules: ["fef7f87857826cb30cd97dded2fd6f0709694bf7cc9c00d03c38b34e8dabd3d4","9d2b9e9a8591ee9721e87aaf30985e894dfa6fad705864192531dec7fe6ff357","fdca68ba6eab776167bceba97a6e3f5f1a6d855b99d7f307bd1fcab41e56ce61","fef7f87857826cb30cd97dded2fd6f0709694bf7cc9c00d03c38b34e8dabd3d4","fef7f87857826cb30cd97dded2fd6f0709694bf7cc9c00d03c38b34e8dabd3d4","fef7f87857826cb30cd97dded2fd6f0709694bf7cc9c00d03c38b34e8dabd3d4","630aecb7e65e983f8428ba6b10c8aeb63fff193a708d73895bce35cdb54ba190"],
  buildOutputQualityRules: ["e2e209b4a0d04b304b834275d9c8e27abb5964dfafbc678121766f1679b843dd","d882cffb3e4f28c3d76d069caa8389b6b0ca2ba16a35cf5331b5eb11e584895f","7c1fa708c1d9f57f11e77386b917fc26c64b7b9a7e6418e605a77f8ab1b18a4c","e2e209b4a0d04b304b834275d9c8e27abb5964dfafbc678121766f1679b843dd","e2e209b4a0d04b304b834275d9c8e27abb5964dfafbc678121766f1679b843dd","e2e209b4a0d04b304b834275d9c8e27abb5964dfafbc678121766f1679b843dd","5f0489d89da2183b96baf766a80133cd2b1dbe3835765d5ec5bfa27667180e35"],
  buildHumanizedLongformDesignRules: ["1fb46b7544328319f4b4fc242b4e4a1563bb55da77345a78c396ae958fada2aa","10d3eb03dd95c6522d90a0fbf736d1d1e378721f03ebe0be12c167e5390e4db5","d7a141e5b0c026c255d5a45bdca1407bbfcf2fe5bcf9328e17d0b4bed2ef94c7","1fb46b7544328319f4b4fc242b4e4a1563bb55da77345a78c396ae958fada2aa","1fb46b7544328319f4b4fc242b4e4a1563bb55da77345a78c396ae958fada2aa","1fb46b7544328319f4b4fc242b4e4a1563bb55da77345a78c396ae958fada2aa","2e6761814fd913c84edcf11b4d53f30b964f610077ab49f73331c6a35409f44d"],
  buildStoryAnchorPrompt: ["deb09882808594cdbae89f7eeb622c02be17d368d4e26e39aa1e6e418c3bab07","04d193cb2f1c9a31c2c63b293b08d38af3e685e1fbfa9c52d09fcbd0fa581243","d33b9fc2d8b47484f8224cbe4b5b1c5a43920bf44cd463b41186fe1ba467e915","deb09882808594cdbae89f7eeb622c02be17d368d4e26e39aa1e6e418c3bab07","deb09882808594cdbae89f7eeb622c02be17d368d4e26e39aa1e6e418c3bab07","deb09882808594cdbae89f7eeb622c02be17d368d4e26e39aa1e6e418c3bab07","d250ccfc3110b2eb14eebf156be72524bdda76713a430cc0d7f27175ed491f39"],
  expandBackgroundPrompt: ["0a670a1349c305d06db0d2cb25d925266405f7ecd97c00ed84c50d41f91c2e83","914a477d2ed47bd54395e21f5355573f14e6c247c961a3e6adf0db9887143fc4","c7ff36d12951c7d8a95ffe1a62525a7e8ce41d9bdd8e3e6f3f9fe8af7a12cc8f","0a670a1349c305d06db0d2cb25d925266405f7ecd97c00ed84c50d41f91c2e83","0a670a1349c305d06db0d2cb25d925266405f7ecd97c00ed84c50d41f91c2e83","0a670a1349c305d06db0d2cb25d925266405f7ecd97c00ed84c50d41f91c2e83","ae1d6c2752b87da055908b5814e3f106b9c4a45816189928849ce329ddebd4cd"],
  protagonistPrompt: ["978fcfabf1b73bfde11dc7e103ab1b054548c0d3471af06bca610c444d4c355b","201548a1c9abae670fbe041482c7f94e07fd2c52da9356efe07253cb760e2473","7f88fa0ae5cb0cb1f13e6b9eb31f069cd82d0850785241a0613de920f2fccee0","978fcfabf1b73bfde11dc7e103ab1b054548c0d3471af06bca610c444d4c355b","978fcfabf1b73bfde11dc7e103ab1b054548c0d3471af06bca610c444d4c355b","978fcfabf1b73bfde11dc7e103ab1b054548c0d3471af06bca610c444d4c355b","83ef2ea2e7c2e388e6d857de811c7af1b8fa58e9785cf6fe01064e3c5d71d6e8"],
  batchCharacterPrompt: ["0c7593044de5621ebd4cb0a7f12251f5da8214c8598c82ad365f2cdb3fdf8023","a3ef786a15ac9b0cc3e0b83ec13ab60ed63bc02e63dd4c9cf939c15aba82914b","b5e37af7f81494c5c2c73eea4ee97a3010f0bb7480a641a7d6ae7edcb21bb159","0c7593044de5621ebd4cb0a7f12251f5da8214c8598c82ad365f2cdb3fdf8023","0c7593044de5621ebd4cb0a7f12251f5da8214c8598c82ad365f2cdb3fdf8023","0c7593044de5621ebd4cb0a7f12251f5da8214c8598c82ad365f2cdb3fdf8023","ca4728afe6a23f2a8832aabca36c32571ffa32eeed80c5811c044bbcaf0c40c3"],
  regenerateCharacterPrompt: ["ce6260922444e0febd8c8d9702a2785fc869f78c4669fe0c15eb53bb1f4c0ee4","2b357178adac382063ac284c32abe503b916ab7137aedc0faf8b0ecd5106a323","d1cbd93235ea87fc9818d6be16a42b267313b2387f9d6405ab0d75932f9dcc98","ce6260922444e0febd8c8d9702a2785fc869f78c4669fe0c15eb53bb1f4c0ee4","ce6260922444e0febd8c8d9702a2785fc869f78c4669fe0c15eb53bb1f4c0ee4","ce6260922444e0febd8c8d9702a2785fc869f78c4669fe0c15eb53bb1f4c0ee4","21202390a5567e661bcc8e5402ce68bbd138897c79776804c70e7f489fb17963"],
  characterRelationsPrompt: ["de6ceccc86cf9afa4f29f8d88db05eacc9e0a84659f08f3d73804a2a1420552a","d3da1246991227108e18c8ed56dd0a588f412ee0e54d4409378a2b372e29b76a","cbf09b85777b07346efce52e4544085b05446a718fd0fb88c50f2f332dba25be","de6ceccc86cf9afa4f29f8d88db05eacc9e0a84659f08f3d73804a2a1420552a","de6ceccc86cf9afa4f29f8d88db05eacc9e0a84659f08f3d73804a2a1420552a","de6ceccc86cf9afa4f29f8d88db05eacc9e0a84659f08f3d73804a2a1420552a","3db850bad623274cb13af9fe76338715b7bfc971b3317b53cd6ae99333cbf898"],
  mapGenerationPrompt: ["1dba01d4112b79a2593a9e46317c480b2eb1a5381c17710261707e1ceff7f812","493ceaa5c1e68bcac96907e8c84080e818a00b68aa8d93b9c63286b8f9cea3f8","15df74c1cfff15c244905aa9a5ab65dcc25df90e4e91213234fa9fa8bfa72ef3","1dba01d4112b79a2593a9e46317c480b2eb1a5381c17710261707e1ceff7f812","1dba01d4112b79a2593a9e46317c480b2eb1a5381c17710261707e1ceff7f812","1dba01d4112b79a2593a9e46317c480b2eb1a5381c17710261707e1ceff7f812","d054eaec4a69c6b8f4e35dece563da77235b2149225e6380b5d27b3aeae19216"],
  buildStoryArcPlanningPrompt: ["85f8c64f83ab10e8761ccb5ad0cc7415e024de3827e07e4f8746bb0ce78129f2","d95e1a3b6fcb3e6c2d561bfd6a068c6cf8e04730424bb59b9ffd330d4dafda4a","bacfce26ef8ede013cce780951da3a8286530e121a0a81063effa61870f4ece1","85f8c64f83ab10e8761ccb5ad0cc7415e024de3827e07e4f8746bb0ce78129f2","85f8c64f83ab10e8761ccb5ad0cc7415e024de3827e07e4f8746bb0ce78129f2","85f8c64f83ab10e8761ccb5ad0cc7415e024de3827e07e4f8746bb0ce78129f2","2613c6b170078e2f4d9d3d1affefe8530af047bff06109a2aa60665a25baa844"],
  buildChapterOutlinePlanningPrompt: ["ca2e91367fa5603886f9a70752b5b62fa49490ab3b90ec1b79d6d93185f55c64","04f5b9310f4678b7e8a97590eb29c8e982f5fe7055a7f7b68def34b970a05990","b72c97acc42a8e3458d45244e0bd062adebd8b277c9de41c8492edc50a2e2a75","ca2e91367fa5603886f9a70752b5b62fa49490ab3b90ec1b79d6d93185f55c64","ca2e91367fa5603886f9a70752b5b62fa49490ab3b90ec1b79d6d93185f55c64","ca2e91367fa5603886f9a70752b5b62fa49490ab3b90ec1b79d6d93185f55c64","0a9c6f27da2393f936460e3e8cc5bcc351210961fbfa8cded437792dcf9975b8"],
  buildVolumePlanningPrompt: ["d0234f495a8193916608a8c204b24f6a7ddb892ddad555b7cd20dfccc9307d39","c5c09d144c2a324db24b14125dac4ae4cc506450810228905427702d649d8157","4b91cd6bc254abf444cbab749f689c96be9469e40ff6f4795c261332cd4f0a69","d0234f495a8193916608a8c204b24f6a7ddb892ddad555b7cd20dfccc9307d39","d0234f495a8193916608a8c204b24f6a7ddb892ddad555b7cd20dfccc9307d39","d0234f495a8193916608a8c204b24f6a7ddb892ddad555b7cd20dfccc9307d39","a92b726359077c5a3348097ad10f726cf27508326338545b652ce503fc60dc74"],
  buildTimelineEventsPrompt: ["eb1742a834c67ab0277f3afe551dab723e66a6af68d47851e57642a396f4bf41","7643840db08eaa87f38bf5bf4e5c0ea03d909de62b30d0d2aa34b1bf8d47f764","09bcc4f57a9a29b7b5b048ea9660cf809fdf57d9dd101a243cbdd17e06dcbac7","eb1742a834c67ab0277f3afe551dab723e66a6af68d47851e57642a396f4bf41","eb1742a834c67ab0277f3afe551dab723e66a6af68d47851e57642a396f4bf41","eb1742a834c67ab0277f3afe551dab723e66a6af68d47851e57642a396f4bf41","8f445755951a144ddaf07f2d2194c1778999043b81edb9434745e2758176f1c0"],
  buildScenePlanPrompt: ["2c7692e9263868333f01d29b109a8fe2b0f295f12d41e923eae23b584af686a0","8468f23f68f8714c75ebafbd2a0e53f0f12ea643ab02d86798b993305c4461b7","7cfbdf5d66229de0e312dc2b1c2aa37fc789f19327f82cea3a502359936823a4","c3f6ece7995379cdb799f4c8147876d5bd09de214059291210f1d2a296124bac","2c7692e9263868333f01d29b109a8fe2b0f295f12d41e923eae23b584af686a0","2c7692e9263868333f01d29b109a8fe2b0f295f12d41e923eae23b584af686a0","6aef095356e6110a58f9ec9573815f21b550cfac903cad9422f1e8cc11f4e79f"],
  buildChapterWritingPrompt: ["d105395483eed911a808c405b1d869e8433a49ea7b2b3db32645d4a334a364fe","db2efeeb264daeca40d87a184226672e0735dee80da53d5bc2e52143a0853a10","21efe1d4fb5650cfe7b15b348fb2f1db3a89413e5c3bbc993b4f37f8b465c88f","9fba937d841bfe8cd432bb6f9bd2a5531191689d0af1a8de47bb510534df11f5","d105395483eed911a808c405b1d869e8433a49ea7b2b3db32645d4a334a364fe","d105395483eed911a808c405b1d869e8433a49ea7b2b3db32645d4a334a364fe","efbf110bbd5d818f9e39fac594051147a044e0b59ef716b6762ffe0d7808de47"],
  buildChapterDraftPrompt: ["08b93788b8985e344de050f5767d23245ec8944e1fee0b75cc39fe7dc00b90f3","b950567e3b07d4d7f2a04f99fd311682414a16e42cfa66dc5158a86d36157a38","f772b345846c5d41bbe45da153aa243cf8b8e8bcd0faea68e2c6572d72816134","04c4bf6bf80b1d152fe2cb15ebe0f3fcd0bb6dee7dad0cd02e1d23c9955ec890","08b93788b8985e344de050f5767d23245ec8944e1fee0b75cc39fe7dc00b90f3","08b93788b8985e344de050f5767d23245ec8944e1fee0b75cc39fe7dc00b90f3","32b594dbb0f21d512a72701cae592eec0b0155b619beeb675ec2004fa12f6d47"],
  buildChapterReviewPrompt: ["5e3e43ee4d05e8db034b704122b0a5b209dc38ecd5440da110ceda9fb27a6f1c","c9699e05ae9a8bfc6fc2e1412f04f63599e91cfe3f467a46197819be2f810213","b04b303e8cad7b73bc57fbda4528c2013b570909a73225ec3da5e31f2ea576a1","f9b3aaba659894192e93540b54ab1aec6ee0add1a8c94daaf95c6ae94d6eea4a","5e3e43ee4d05e8db034b704122b0a5b209dc38ecd5440da110ceda9fb27a6f1c","5e3e43ee4d05e8db034b704122b0a5b209dc38ecd5440da110ceda9fb27a6f1c","df51515639b76c891f7ab895f33b88af5aa533cea0505b5229f21a41993adcf6"],
  buildChapterRewritePrompt: ["4665a08095f2391e9387c1f1ebf52f48a1de6cb4af4bef2ab80fc81c1260e465","72f5160cb2d90c57362893ce892f56eb08d4cad8eacf5793c3c101ccec5f8efc","7764be134511cc6e22fbc6d43ee4bbaa73b5ae27cd447664c16e6e6e1bc8a212","77a0e2973bdbf9102e5c8e4acdcbc5a62f4b9b75e89128694bed2420a7e56fe7","4665a08095f2391e9387c1f1ebf52f48a1de6cb4af4bef2ab80fc81c1260e465","4665a08095f2391e9387c1f1ebf52f48a1de6cb4af4bef2ab80fc81c1260e465","e621e4ca39b84a4de3a2a57575a00694b976f790182a279223f206968bc042e1"],
  buildContinuityStatePrompt: ["46043067eb1270e9a45e2fd814a24cdd4239d1893e108387dcfe0288fb765592","d78e4ea9b3af32e59bff4a670718ab4a2f1037c48af3e701e49501af9b991d90","b459a916b23615d8024f70db06f2c5c50c0b6eb14ac7772447bee34a482f7204","46043067eb1270e9a45e2fd814a24cdd4239d1893e108387dcfe0288fb765592","46043067eb1270e9a45e2fd814a24cdd4239d1893e108387dcfe0288fb765592","46043067eb1270e9a45e2fd814a24cdd4239d1893e108387dcfe0288fb765592","a7cc8b8e8507b78c954613769fb3a208fd8e14febde358117e7cb20d95dfd3b7"],
  storyArcsPrompt: ["85f8c64f83ab10e8761ccb5ad0cc7415e024de3827e07e4f8746bb0ce78129f2","76b607cc26570e3dbd5a7775d6d3fece77577679331c7aaed5b8aabde8d6a8b1","bacfce26ef8ede013cce780951da3a8286530e121a0a81063effa61870f4ece1","85f8c64f83ab10e8761ccb5ad0cc7415e024de3827e07e4f8746bb0ce78129f2","85f8c64f83ab10e8761ccb5ad0cc7415e024de3827e07e4f8746bb0ce78129f2","85f8c64f83ab10e8761ccb5ad0cc7415e024de3827e07e4f8746bb0ce78129f2","2613c6b170078e2f4d9d3d1affefe8530af047bff06109a2aa60665a25baa844"],
  chapterOutlinePrompt: ["c4577c10cdbc23d4587daa5509745599041f3823189b909d1af5c204a0a4c322","072d00e3ec3be32a07071f0c3ee6912044cc7896d1d4618e4ffa7abb16dc8e3b","a6e813352bb7992c41a424c831c242f31f5b3ff27c959a45f73bbf89ff8f3768","c4577c10cdbc23d4587daa5509745599041f3823189b909d1af5c204a0a4c322","c4577c10cdbc23d4587daa5509745599041f3823189b909d1af5c204a0a4c322","c4577c10cdbc23d4587daa5509745599041f3823189b909d1af5c204a0a4c322","6ceedeee2a078d5a3beb3cf2a461cdd9aea7dbc3d53da52cc9cc81b8a8503d17"],
  chapterWritingPrompt: ["f86e02d6e287c2e09596dbcc05040133a7882621dbcc0cea97495ce6de0b9deb","746caf99438f42ed5784b410628ed3bd2087bc3a78f95c236f4bb6ed3df49ebc","e256a6db3e217660b302f49f1fa455aa1e4d1898bece3d107082f2af534072b6","03c701c02bac006aecd0f43b60bee3f4ecf4982b873aa6a4fde31302ff74769f","f86e02d6e287c2e09596dbcc05040133a7882621dbcc0cea97495ce6de0b9deb","f86e02d6e287c2e09596dbcc05040133a7882621dbcc0cea97495ce6de0b9deb","660f5a581c1416788baeeacef6d1cf9a1613f314418e98a2046ae28a134264f5"],
  chapterSummaryPrompt: ["b1829f1813ff46a2eceb9f10bc44ef1761cbc3e806f7896fd8ff258d3e3c914c","9605775196587916f3f9923f815b97a65c151ab15d9a2020b0f79f6e5d3af695","b1829f1813ff46a2eceb9f10bc44ef1761cbc3e806f7896fd8ff258d3e3c914c","b1829f1813ff46a2eceb9f10bc44ef1761cbc3e806f7896fd8ff258d3e3c914c","b1829f1813ff46a2eceb9f10bc44ef1761cbc3e806f7896fd8ff258d3e3c914c","b1829f1813ff46a2eceb9f10bc44ef1761cbc3e806f7896fd8ff258d3e3c914c","b1829f1813ff46a2eceb9f10bc44ef1761cbc3e806f7896fd8ff258d3e3c914c"],
  aiCheckPrompt: ["28263633cbc9550c2bb1c288283c1a391ba8036821fc44c486b9ecb4e91ab9a7","6c6f8e96306558a35ba553865812d17a0ce09328bea4f90d9c9bc40b2633cdf5","28263633cbc9550c2bb1c288283c1a391ba8036821fc44c486b9ecb4e91ab9a7","28263633cbc9550c2bb1c288283c1a391ba8036821fc44c486b9ecb4e91ab9a7","28263633cbc9550c2bb1c288283c1a391ba8036821fc44c486b9ecb4e91ab9a7","28263633cbc9550c2bb1c288283c1a391ba8036821fc44c486b9ecb4e91ab9a7","28263633cbc9550c2bb1c288283c1a391ba8036821fc44c486b9ecb4e91ab9a7"],
  rewriteParagraphPrompt: ["b53f9d1ab0d61397c918f7cba11c1d1fa5d821a3fcb2bb9fc00d89bce1cd0539","6c9f60eedee40ffaa1059b6097f5ea1efc9e95fcc5055537da9ee0a63ea3412b","b53f9d1ab0d61397c918f7cba11c1d1fa5d821a3fcb2bb9fc00d89bce1cd0539","b53f9d1ab0d61397c918f7cba11c1d1fa5d821a3fcb2bb9fc00d89bce1cd0539","b53f9d1ab0d61397c918f7cba11c1d1fa5d821a3fcb2bb9fc00d89bce1cd0539","b53f9d1ab0d61397c918f7cba11c1d1fa5d821a3fcb2bb9fc00d89bce1cd0539","1baf22a5c8ba41683f9d987c576f0d7c538d6f3041ba3b24111fac916b11a5f2"],
  genericExpandPrompt: ["8bda16e00e6747405448763465a25165927ede7b0a6ddd67741743d5e320fe01","0b3de1b65b3abbf1f59885e4feff1382c6b87dc3c1e9d1e356cf22491d22406b","8bda16e00e6747405448763465a25165927ede7b0a6ddd67741743d5e320fe01","8bda16e00e6747405448763465a25165927ede7b0a6ddd67741743d5e320fe01","8bda16e00e6747405448763465a25165927ede7b0a6ddd67741743d5e320fe01","8bda16e00e6747405448763465a25165927ede7b0a6ddd67741743d5e320fe01","154c11936bf4e3f370b4d54a4191ece97b1d10b6fd8a37d2065d8f218a0a22b2"],
  subplotExpandPrompt: ["a1cb5b923325e1c388679303dc25a7ed1f6313d9f5dfe342e85aaf4ad004b053","1f2a8dfdddf04dd9f19417bd620a3471fa7eb0b33835f7106fd3fd7b9a156852","a1cb5b923325e1c388679303dc25a7ed1f6313d9f5dfe342e85aaf4ad004b053","a1cb5b923325e1c388679303dc25a7ed1f6313d9f5dfe342e85aaf4ad004b053","a1cb5b923325e1c388679303dc25a7ed1f6313d9f5dfe342e85aaf4ad004b053","a1cb5b923325e1c388679303dc25a7ed1f6313d9f5dfe342e85aaf4ad004b053","f8cd70c1c63028cd88a983ad084edccba48d92e68823635c1c4451ff5797b214"],
  contentScoringPrompt: ["ace8b0f24f468816da8a2003829dd0849349d7474226591b7216e4f87b706231","c6e3697167fc91a4ebc977c1bcb91adfabdd2fbf744e19ec0159b4f23d965731","ace8b0f24f468816da8a2003829dd0849349d7474226591b7216e4f87b706231","ace8b0f24f468816da8a2003829dd0849349d7474226591b7216e4f87b706231","ace8b0f24f468816da8a2003829dd0849349d7474226591b7216e4f87b706231","ace8b0f24f468816da8a2003829dd0849349d7474226591b7216e4f87b706231","d6c933c619fe06bea5023d7e3372d0cdb30325713c36e99894c397ea6ac9a8bd"],
  buildPowerSystemExpandPrompt: ["715289dd2385af13fa511cc387f385aaedc336e6115515797c2baf469e079209","6bfcf284b19cd1dea5e158aeb10c420b9a8ce9f75f8f58e53a796436a3c60918","4cfdae7a50f5422edbfa80530a75285efe213e1fac8ccce45910eb0bf4e3328e","715289dd2385af13fa511cc387f385aaedc336e6115515797c2baf469e079209","715289dd2385af13fa511cc387f385aaedc336e6115515797c2baf469e079209","715289dd2385af13fa511cc387f385aaedc336e6115515797c2baf469e079209","378a6a87073c9a38a7267c938d4bcd672dadb2fe063db8d570639cdeb0f75d17"],
  buildFactionSystemExpandPrompt: ["a68d2e1a23b2f068d0ab7800fa329e7dcca4c5fd43afdfc47e7209744e7dfcf0","90cf48090e1d76be3d0941beadb1bb4c150b43e8d4203c14669a0c23d473a9dd","d400232efa97f49e55a28bd79d39e3b1afcd6f1935583f2f07b96462c7b46536","a68d2e1a23b2f068d0ab7800fa329e7dcca4c5fd43afdfc47e7209744e7dfcf0","a68d2e1a23b2f068d0ab7800fa329e7dcca4c5fd43afdfc47e7209744e7dfcf0","a68d2e1a23b2f068d0ab7800fa329e7dcca4c5fd43afdfc47e7209744e7dfcf0","fb5da16aca6b2592556a76f7140ccf2090959a192592f4c82d26101bff7ccad3"],
}

const runtimeExports = ["GLOBAL_WRITING_RULES","HUMAN_LANGUAGE_RULE_LINES","PROMPT_CATALOG","PROMPT_CATEGORIES","aiCheckPrompt","batchCharacterPrompt","buildAvoidanceSection","buildChapterDraftPrompt","buildChapterOutlinePlanningPrompt","buildChapterReviewPrompt","buildChapterRewritePrompt","buildChapterWritingPrompt","buildContextAlignmentRules","buildContinuityStatePrompt","buildFactionSystemExpandPrompt","buildGenreRealityRules","buildHumanLanguageRules","buildHumanizedLongformDesignRules","buildOutputQualityRules","buildPowerSystemExpandPrompt","buildScenePlanPrompt","buildStoryAnchorPrompt","buildStoryArcPlanningPrompt","buildTimelineEventsPrompt","buildVariationHint","buildVolumePlanningPrompt","chapterOutlinePrompt","chapterSummaryPrompt","chapterWritingPrompt","characterRelationsPrompt","contentScoringPrompt","expandBackgroundPrompt","genericExpandPrompt","mapGenerationPrompt","protagonistPrompt","regenerateCharacterPrompt","rewriteParagraphPrompt","storyArcsPrompt","subplotExpandPrompt"]

const wrappers = [
  {"file":"prompts","mode":"fallback","name":"expandBackgroundPrompt","hash":"0603729ecd41ca6be430ba5c46efc825d72a58ca5f7cce390a5d1d5e6cf99c7d","key":null},
  {"file":"prompts","mode":"fallback","name":"protagonistPrompt","hash":"095997cb7245c5e3a8abb9e5906039ca97a290f649d5ebecd55d4f5d522ec511","key":null},
  {"file":"prompts","mode":"fallback","name":"batchCharacterPrompt","hash":"e4232630f4662c25300687cef4a08fcd1a75da68ba38016f54901cd2e96def0b","key":null},
  {"file":"prompts","mode":"fallback","name":"regenerateCharacterPrompt","hash":"4bc4e102769eb900685b0efc76e49deb920c8c86fcee336bbc9b55dfc3f02130","key":null},
  {"file":"prompts","mode":"fallback","name":"characterRelationsPrompt","hash":"7503594e94e71e316a260cba72f03b327be2f2c5a032f8da25e5b7bd4956aed2","key":null},
  {"file":"prompts","mode":"fallback","name":"mapGenerationPrompt","hash":"4829ba2c8141ec9fd0ba3f743a3a0cdef2bb63b4c357ab4dbb12514330992705","key":null},
  {"file":"prompts","mode":"fallback","name":"storyArcsPrompt","hash":"39d4b132278769cd4a2d8ed0f10cd64836d45b1d0ff81f28e94b132b2d117f38","key":null},
  {"file":"prompts","mode":"fallback","name":"chapterOutlinePrompt","hash":"5e319b61bbabc417d089c9434c964f394a9d696b8b76ef7aa074ddafa49627e3","key":null},
  {"file":"prompts","mode":"fallback","name":"chapterWritingPrompt","hash":"ce0fb822804a04a9b5c5f8ce673f092a1fecb8325158e33094c1c121fe4d78f4","key":null},
  {"file":"prompts","mode":"fallback","name":"chapterSummaryPrompt","hash":"b1829f1813ff46a2eceb9f10bc44ef1761cbc3e806f7896fd8ff258d3e3c914c","key":null},
  {"file":"prompts","mode":"fallback","name":"aiCheckPrompt","hash":"8254d951b64ed3157bd1a6e987977849b4f161e298f84b0149b67cdf6fe2ec54","key":null},
  {"file":"prompts","mode":"fallback","name":"rewriteParagraphPrompt","hash":"b53f9d1ab0d61397c918f7cba11c1d1fa5d821a3fcb2bb9fc00d89bce1cd0539","key":null},
  {"file":"prompts","mode":"fallback","name":"genericExpandPrompt","hash":"b95858261829f30635a4ce9cc203e38184b03933445fb2fc366bd330fb16fc8b","key":null},
  {"file":"prompts","mode":"fallback","name":"subplotExpandPrompt","hash":"728db45893d56639da392ad5e7305d83deabb188c0fc32c0ff6619efcea6cb3f","key":null},
  {"file":"prompts","mode":"fallback","name":"contentScoringPrompt","hash":"1856a1bb77a329f5ff4885621451000a4dbf7f94c24c3d57fc379dbd1836597d","key":null},
  {"file":"prompts","mode":"override","name":"expandBackgroundPrompt","hash":"a7514b24b9e4956eee1be406e13ff03d8300f3fde995821ee9977cb3334564cf","key":"expandBackground"},
  {"file":"prompts","mode":"override","name":"protagonistPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"protagonist"},
  {"file":"prompts","mode":"override","name":"batchCharacterPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"batchCharacter"},
  {"file":"prompts","mode":"override","name":"regenerateCharacterPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"regenerateCharacter"},
  {"file":"prompts","mode":"override","name":"characterRelationsPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"characterRelations"},
  {"file":"prompts","mode":"override","name":"mapGenerationPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"mapGeneration"},
  {"file":"prompts","mode":"override","name":"storyArcsPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"storyArcsLegacy"},
  {"file":"prompts","mode":"override","name":"chapterOutlinePrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"chapterOutlineLegacy"},
  {"file":"prompts","mode":"override","name":"chapterWritingPrompt","hash":"42056844941377189a294bb61f6c7383ff34ad99887a5f5a9a9cfbfbfef48e05","key":"chapterWriting"},
  {"file":"prompts","mode":"override","name":"chapterSummaryPrompt","hash":"e6809cbcabcd7d813b2845f4458424e368a67c5404cffc31d2fbdd68506c0471","key":"chapterSummary"},
  {"file":"prompts","mode":"override","name":"aiCheckPrompt","hash":"e6809cbcabcd7d813b2845f4458424e368a67c5404cffc31d2fbdd68506c0471","key":"aiCheck"},
  {"file":"prompts","mode":"override","name":"rewriteParagraphPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"rewriteParagraph"},
  {"file":"prompts","mode":"override","name":"genericExpandPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"genericExpand"},
  {"file":"prompts","mode":"override","name":"subplotExpandPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"subplotExpand"},
  {"file":"prompts","mode":"override","name":"contentScoringPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"contentScoring"},
  {"file":"story-prompts","mode":"fallback","name":"buildStoryArcPlanningPrompt","hash":"d28426544ba610b266c0c4c9f45d7da990d89941b4be0a46e6838b33a745dd36","key":null},
  {"file":"story-prompts","mode":"fallback","name":"buildChapterOutlinePlanningPrompt","hash":"164d18b57129d5f4b8776552273539a245b09e6a749661fd6bcdeb95db447a44","key":null},
  {"file":"story-prompts","mode":"fallback","name":"buildTimelineEventsPrompt","hash":"d91ea02c69381934783611e60963ffa560233524fa9d44b575acd18a9f5204a0","key":null},
  {"file":"story-prompts","mode":"fallback","name":"buildScenePlanPrompt","hash":"c4b18efa6c7f7083dfa94d377a9fe8ee6dae5002e7902fd706c164e87b9a9dca","key":null},
  {"file":"story-prompts","mode":"fallback","name":"buildChapterWritingPrompt","hash":"50b6e332ee20d4b68c959e05ab420138ce2004b801aefce67393e410475e81c6","key":null},
  {"file":"story-prompts","mode":"fallback","name":"buildChapterDraftPrompt","hash":"306756d0110122bf543e896ea4425460e49afbf583b746215f1ef32489201081","key":null},
  {"file":"story-prompts","mode":"fallback","name":"buildChapterReviewPrompt","hash":"7b438bebcc7bb8a46354cef8c1704028439243d2b7d1302d879fe803ea118306","key":null},
  {"file":"story-prompts","mode":"fallback","name":"buildChapterRewritePrompt","hash":"c4457ef54b83e4dee77b9aea3490d77a880b817e234ee8519e35988847d581a8","key":null},
  {"file":"story-prompts","mode":"fallback","name":"buildContinuityStatePrompt","hash":"46043067eb1270e9a45e2fd814a24cdd4239d1893e108387dcfe0288fb765592","key":null},
  {"file":"story-prompts","mode":"override","name":"buildStoryArcPlanningPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"storyArcs"},
  {"file":"story-prompts","mode":"override","name":"buildChapterOutlinePlanningPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"chapterOutline"},
  {"file":"story-prompts","mode":"override","name":"buildTimelineEventsPrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"timelineEvents"},
  {"file":"story-prompts","mode":"override","name":"buildScenePlanPrompt","hash":"42056844941377189a294bb61f6c7383ff34ad99887a5f5a9a9cfbfbfef48e05","key":"scenePlan"},
  {"file":"story-prompts","mode":"override","name":"buildChapterWritingPrompt","hash":"42056844941377189a294bb61f6c7383ff34ad99887a5f5a9a9cfbfbfef48e05","key":"chapterWriting"},
  {"file":"story-prompts","mode":"override","name":"buildChapterDraftPrompt","hash":"42056844941377189a294bb61f6c7383ff34ad99887a5f5a9a9cfbfbfef48e05","key":"chapterDraft"},
  {"file":"story-prompts","mode":"override","name":"buildChapterReviewPrompt","hash":"42056844941377189a294bb61f6c7383ff34ad99887a5f5a9a9cfbfbfef48e05","key":"chapterReview"},
  {"file":"story-prompts","mode":"override","name":"buildChapterRewritePrompt","hash":"42056844941377189a294bb61f6c7383ff34ad99887a5f5a9a9cfbfbfef48e05","key":"chapterRewrite"},
  {"file":"story-prompts","mode":"override","name":"buildContinuityStatePrompt","hash":"84666472350d4c1f6846f141b30f8399cf4086cd71ffbc9c21cac08c83f18772","key":"continuityState"},
]

const overrideText = "自定义：{novelTitle} / {chapterNum}\n{chapterGoal}\n{runtimeAssertions}\n{unknownField}"

const catalogHash = 'c3a50341e310bae9de7403456c17ade397b53ad38e08c153f62dd3401485e4c1'

type LegacyTypes = [barrel.PromptParamMeta, barrel.PromptCatalogEntry, barrel.ProtagonistPromptInput, barrel.BatchCharacterPromptInput, barrel.RegenerateCharacterPromptInput, barrel.CharacterRelationsPromptInput, barrel.MapGenerationPromptInput, barrel.StoryArcPromptInput, barrel.ChapterOutlinePromptInput, barrel.TimelineEventPromptInput, barrel.PromptTier, barrel.ChapterWritingPromptInput, barrel.ScenePlanPromptInput, barrel.ChapterReviewPromptInput, barrel.ChapterRewritePromptInput, barrel.ContinuityPromptInput, barrel.RewriteParagraphPromptInput, barrel.GenericExpandPromptInput, barrel.SubplotExpandPromptInput, barrel.ContentScoringPromptInput, barrel.StoryAnchorField, barrel.StoryAnchorPromptInput, barrel.VariationEntityType, barrel.VolumePlanningPromptInput, barrel.PowerSystemExpandInput, barrel.FactionSystemExpandInput]

function inputFor(variant: string): Record<string, unknown> {
  const input = { ...base }
  if (variant === 'empty') for (const key of Object.keys(input)) {
    if (key === 'field' || key === 'promptTier') continue
    if (typeof input[key] === 'string') input[key] = ''
    else if (typeof input[key] === 'number') input[key] = 0
    else if (Array.isArray(input[key])) input[key] = []
  }
  if (variant === 'omitted') for (const key of ['genre', 'hardConstraintContext', 'sceneWritingBrief', 'writingContractSummary', 'relationSummary', 'chapterBridgePlan', 'stepMemorySummary', 'runtimeAssertions', 'promptTier', 'attemptNumber', 'rejectedDigests', 'lockedParagraphs']) delete input[key]
  if (variant === 'hard') input.hardConstraintContext = '章节目标:\n- 查扣私盐\n写作合同/章节合同:\n- 必须两次交锋\n关键人物关系:\n- 同僚互相提防'
  if (variant === 'simple' || variant === 'key') input.promptTier = variant
  if (variant === 'xianxia') Object.assign(input, { genre: '修仙', genreContext: '修仙', chapterNum: 20 })
  return input
}

function argsFor(name: string, variant: string): unknown[] {
  const input = inputFor(variant)
  const empty = variant === 'empty'
  if (name === 'buildVariationHint') return [empty ? 0 : variant === 'omitted' ? 1 : 2, 'character']
  if (name === 'buildAvoidanceSection' || name === 'buildHumanLanguageRules') return [empty ? [] : ['保留对白停顿', '不可补造线索']]
  if (name === 'buildOutputQualityRules') return [empty ? [] : ['保留对白停顿'], input.genre]
  if (name === 'chapterSummaryPrompt') return [input.draftContent]
  if (name === 'aiCheckPrompt') return [input.draftContent, !empty]
  return [input]
}

function digest(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex')
}

function invoke(module: Record<string, unknown>, name: string, variant: string): string {
  const fn = module[name]
  expect(typeof fn, name).toBe('function')
  if (typeof fn !== 'function') throw new Error(`Missing export: ${name}`)
  const result: unknown = Reflect.apply(fn, undefined, argsFor(name, variant))
  expect(typeof result, name).toBe('string')
  if (typeof result !== 'string') throw new Error(`Unexpected return: ${name}`)
  return result
}

beforeEach(() => {
  database.content = ''
  database.audit.mockClear()
})

describe('NF-17 frozen pre-migration UTF-8 output', () => {
  for (const [name, hashes] of Object.entries(expected)) {
    it.each(variants)(`${name} / %s (17-01, 17-02, 17-03)`, variant => {
      expect(digest(invoke(barrel, name, variant))).toBe(hashes[variants.indexOf(variant)])
    })
  }

  it('17-01 preserves every catalog key, parameter, template byte and category', () => {
    expect(digest(JSON.stringify(barrel.PROMPT_CATALOG))).toBe(catalogHash)
    expect(barrel.PROMPT_CATEGORIES).toEqual(['全部', '创作初始化', '人物系统', '大纲规划', '正文编写', '世界构建'])
  })

  it.each(['buildScenePlanPrompt', 'buildChapterWritingPrompt', 'buildChapterDraftPrompt', 'buildChapterReviewPrompt', 'buildChapterRewritePrompt'])('17-03 %s renders covered fields only once', name => {
    const prompt = invoke(barrel, name, 'hard')
    expect(prompt).toContain('【硬约束】\n章节目标:\n- 查扣私盐')
    expect(prompt.match(/查扣私盐/g)).toHaveLength(1)
    expect(prompt.match(/必须两次交锋/g)).toHaveLength(1)
    expect(prompt.match(/同僚互相提防/g)).toHaveLength(1)
  })

  it('17-03 keeps null, empty, literal label and uncovered section behavior', () => {
    expect(barrel.sectionUnlessCovered('目标', null, null)).toBe('')
    expect(barrel.sectionUnlessCovered('目标', '  ', undefined)).toBe('')
    expect(barrel.sectionUnlessCovered('目标', ' 渡口 ', '别的目标:\n- 渡口')).toBe('【目标】\n渡口')
    expect(barrel.sectionUnlessCovered('目标', '渡口', '章节目标:\n- 渡口', ['章节目标'])).toBe('')
    expect(barrel.sectionUnlessCovered('目标[1]', '渡口', '目标[1]:\n- 渡口')).toBe('')
  })
})

describe('17-04 real Electron wrappers and applyPromptOverride (database boundary stubbed)', () => {
  it.each(wrappers)('$file / $name / $mode matches frozen final output', row => {
    database.content = row.mode === 'override' ? overrideText : ''
    const module = row.file === 'prompts' ? electronPrompts : storyPrompts
    const output = invoke(module, row.name, 'ordinary')
    expect(digest(output)).toBe(row.hash)
    if (row.mode === 'fallback') {
      expect(database.audit).not.toHaveBeenCalled()
    } else {
      expect(output).toContain('[MISSING_PARAM:unknownField]')
      expect(database.audit).toHaveBeenCalledTimes(1)
      expect(database.audit).toHaveBeenCalledWith(expect.objectContaining({ key: row.key, action: 'apply' }))
      if (['scenePlan', 'chapterDraft', 'chapterWriting', 'chapterReview', 'chapterRewrite'].includes(row.key || '')) {
        expect(output).toContain('【系统保留规则】')
        expect(output).toContain('【章节衔接桥】\n接住门外脚步声')
        expect(output).toContain('【步骤接力记忆】\n从验印结果继续推进')
        expect(output).toContain('【运行时接力断言】\n保持印盒位置')
      }
    }
  })
})

describe('17-05 compatibility and dependency direction', () => {
  it('keeps all 39 runtime exports and 26 type exports; exposes only the requested section helper', () => {
    expect(Object.keys(barrel).sort()).toEqual([...runtimeExports, 'sectionUnlessCovered'].sort())
    expectTypeOf<LegacyTypes['length']>().toEqualTypeOf<26>()
    const owners = [commonPrompts, assetPrompts, planningPrompts, writingPrompts, reviewPrompts]
    for (const name of Object.keys(expected)) {
      const owner = owners.find(module => name in module)
      expect(owner, name).toBeDefined()
      expect((barrel as Record<string, unknown>)[name]).toBe((owner as Record<string, unknown>)[name])
    }
    expect(barrel.GLOBAL_WRITING_RULES).toBe(commonPrompts.GLOBAL_WRITING_RULES)
    expect(barrel.GLOBAL_WRITING_RULES).toBe(writingPrompts.GLOBAL_WRITING_RULES)
    expect(barrel.sectionUnlessCovered).toBe(commonPrompts.sectionUnlessCovered)
  })

  it('has no runtime code in types, reverse imports, peer imports or duplicated declarations', () => {
    const allowed: Record<string, string[]> = {
      'prompt-types': [],
      'prompt-common': ['../genre-system', './prompt-types'],
      'asset-prompts': ['../genre-system', './prompt-types', './prompt-common'],
      'planning-prompts': ['./prompt-types', './prompt-common'],
      'writing-prompts': ['./prompt-types', './prompt-common'],
      'review-prompts': ['./prompt-types', './prompt-common'],
    }
    const declarations = new Set<string>()
    for (const [name, imports] of Object.entries(allowed)) {
      const source = fs.readFileSync(path.join(__dirname, `${name}.ts`), 'utf8')
      const parsed = ts.createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true)
      for (const statement of parsed.statements) {
        if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
          if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            expect(imports, name).toContain(statement.moduleSpecifier.text)
          }
        } else if (name === 'prompt-types') {
          expect(ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)).toBe(true)
        }
        const names = ts.isVariableStatement(statement)
          ? statement.declarationList.declarations.map(node => node.name.getText(parsed))
          : (ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name
            ? [statement.name.text] : []
        for (const declaration of names) {
          expect(declarations.has(declaration), declaration).toBe(false)
          declarations.add(declaration)
        }
      }
      expect(source).not.toMatch(/\b(?:require|import)\s*\(/)
    }
  })
})
