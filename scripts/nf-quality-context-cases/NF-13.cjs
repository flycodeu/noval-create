'use strict'

const assert = require('node:assert/strict')

function createSchema(db) {
  db.exec(`
    CREATE TABLE chapters (id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, chapter_num INTEGER NOT NULL);
    CREATE TABLE chapter_contracts (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, chapter_id INTEGER NOT NULL,
      served_thread_ids_json TEXT, required_asset_refs_json TEXT,
      required_endgame_commitment_ids_json TEXT, required_foreshadow_ids_json TEXT
    );
    CREATE TABLE scene_contracts (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, chapter_id INTEGER NOT NULL,
      required_endgame_commitment_ids_json TEXT, required_foreshadow_ids_json TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, full_name TEXT NOT NULL,
      surname TEXT, given_name TEXT
    );
    CREATE TABLE character_relations (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, char_a_id INTEGER NOT NULL, char_b_id INTEGER NOT NULL,
      relation_type TEXT, relation_label TEXT, description TEXT, interaction_style TEXT
    );
    CREATE TABLE story_items (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, item_name TEXT NOT NULL,
      owner_character_id INTEGER, status TEXT, summary TEXT, updated_at TEXT
    );
    CREATE TABLE story_threads (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT,
      status TEXT, priority TEXT, planted_chapter INTEGER, target_payoff_chapter INTEGER,
      related_character_ids_json TEXT, related_item_ids_json TEXT,
      related_timeline_event_ids_json TEXT, typed_refs_json TEXT, updated_at TEXT
    );
    CREATE TABLE timeline_events (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, event_title TEXT NOT NULL, event_summary TEXT,
      status TEXT, anchor_invalid INTEGER, present_character_ids_json TEXT,
      affected_character_ids_json TEXT, linked_item_ids_json TEXT, typed_refs_json TEXT,
      updated_at TEXT, chapter_start_id INTEGER
    );
    CREATE TABLE endgame_commitments (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT,
      status TEXT, target_resolution_chapter INTEGER, updated_at TEXT
    );
    CREATE TABLE foreshadow_ledger (
      id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, title TEXT NOT NULL, detail TEXT,
      target_payoff_chapter INTEGER, payoff_method TEXT, payoff_scene_action TEXT,
      required_evidence TEXT, reader_visible_outcome TEXT, linked_thread_id INTEGER,
      source_chapter_id INTEGER, updated_at TEXT
    );
  `)
}

function seed(db) {
  db.prepare('INSERT INTO chapters VALUES (?, ?, ?)').run(3, 1, 3)
  db.prepare('INSERT INTO chapters VALUES (?, ?, ?)').run(200, 1, 200)
  db.prepare('INSERT INTO chapters VALUES (?, ?, ?)').run(201, 1, 201)
  db.prepare('INSERT INTO chapter_contracts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    1, 1, 200, '[]', '["item:20"]', '[]', '[91]',
  )
  db.prepare('INSERT INTO scene_contracts VALUES (?, ?, ?, ?, ?)').run(1, 1, 200, '[]', '[91]')
  db.prepare('INSERT INTO characters VALUES (?, ?, ?, ?, ?)').run(1, 1, 'A', '', 'A')
  for (let id = 2; id <= 32; id += 1) {
    db.prepare('INSERT INTO characters VALUES (?, ?, ?, ?, ?)').run(id, 1, `B${id}`, '', `B${id}`)
  }
  db.prepare('INSERT INTO characters VALUES (?, ?, ?, ?, ?)').run(900, 2, '外书人物', '', '外书人物')
  for (let id = 1; id <= 30; id += 1) {
    db.prepare('INSERT INTO character_relations VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, 1, 1, id + 1, 'association', `关联${id}`, `A与B${id + 1}的一跳关系`, '直接',
    )
  }
  db.prepare('INSERT INTO character_relations VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    101, 1, 2, 3, 'association', '二跳关系', 'B2与B3，不应由A递归召回', '间接',
  )
  db.prepare('INSERT INTO story_items VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    20, 1, 'I', 1, 'available', '第三章留下的旧怀表', '2026-09-09 00:00:00',
  )
  db.prepare('INSERT INTO foreshadow_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    91, 1, '旧钥匙的齿痕', '第三章埋设，第二百章开门', 200, '打开密室',
    'A将钥匙插入门锁', '锁芯吻合', '读者看到密室开启', null, 3, '2026-09-09 00:00:00',
  )
  db.prepare('INSERT INTO endgame_commitments VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    70, 1, '归还旧怀表', '第二百章前必须兑现', 'active', 200, '2026-09-09 00:00:00',
  )
  db.prepare('INSERT INTO timeline_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    50, 1, '未来政变', '第二百零一章才发生', 'confirmed', 0, '[1]', '[]', '[]', null,
    '2026-09-09 00:00:00', 201,
  )
}

async function run({ Database, loadTypeScriptModule }) {
  const db = new Database(':memory:')
  try {
    createSchema(db)
    seed(db)
    const relation = loadTypeScriptModule('electron/services/relation-recall.ts')
    const core = loadTypeScriptModule('electron/services/context-recall-core.ts')
    const compiler = loadTypeScriptModule('electron/services/context-compiler.ts')

    const resolved = relation.resolveRelationRecallInput(db, {
      novelId: 1,
      chapterNum: 200,
      mentionedCharacters: ['A'],
      mentionedItems: [],
    })
    const recalled = relation.loadRelationRecallSources(db, {
      novelId: 1,
      chapterNum: 200,
      seedEntityIds: resolved.seedEntityIds,
      explicitContractRefs: resolved.explicitContractRefs,
    })

    const foreshadow = recalled.sources.find((source) => source.sourceKey === 'contract:foreshadow:91')
    assert.ok(foreshadow)
    assert.equal(foreshadow.required, true)
    assert.match(foreshadow.summary, /来源=第3章/)
    assert.ok(recalled.sources.some((source) => source.sourceKey === 'contract:commitment:70' && source.reason === 'due_commitment'))

    const ownerItem = recalled.sources.find((source) => source.sourceKey === 'asset:item:20')
    assert.ok(ownerItem)
    assert.equal(ownerItem.required, true)
    assert.ok(recalled.sources.some((source) => source.sourceKey === 'asset:character_relation:1'))
    assert.equal(recalled.sources.some((source) => source.sourceKey === 'asset:character_relation:101'), false)
    assert.equal(recalled.sources.filter((source) => source.optionalKind === 'relation').length, 8)
    assert.ok(recalled.diagnostics.some((item) => item.code === 'candidate_limit'))

    const semanticDuplicate = {
      sourceType: 'item', sourceId: 20, fragmentKey: 'summary', content: '第三章留下的旧怀表',
      entityRefs: ['A', 'I'], similarity: 0.9, searchMode: 'vector', bucket: 'character',
      stale: false, staleReasons: [], overriddenByConstraint: false,
      entityMatches: ['A'], entityValidated: true,
    }
    const snapshot = core.buildRecallSnapshot([], [{ bucket: 'character', hits: [semanticDuplicate] }], recalled.sources)
    assert.equal(snapshot.recalledMemorySources.filter((source) => core.getRecallSourceKey(source) === 'asset:item:20').length, 1)
    assert.equal(snapshot.recalledMemorySources.find((source) => core.getRecallSourceKey(source) === 'asset:item:20').deterministic, true)

    const rawContext = {
      novel: { id: 1, contextVersion: 4 }, currentChapter: { id: 200, chapterNum: 200 },
      recalledMemorySources: snapshot.recalledMemorySources,
    }
    const context = {
      hardConstraintEntries: [],
      softContextDecisions: [{ label: 'recalledMemory', sourceKind: 'recall', priority: 2, reason: 'budget_fit', allocatedTokens: 100, originalTokens: 100 }],
      recalledMemory: snapshot.recalledMemory,
      contextBudgetReport: { availableContextBudget: 2000, reservedForOutput: 200 },
    }
    const packSources = compiler.buildChapterContextSources({ rawContext, context, stage: 'draft' })
    assert.equal(packSources.filter((source) => source.key === 'asset:item:20').length, 1)
    assert.equal(packSources.find((source) => source.key === 'asset:item:20').sourceVersion, ownerItem.sourceVersion)

    const mixedVisibilitySources = compiler.buildChapterContextSources({
      rawContext: {
        ...rawContext,
        recalledMemorySources: [ownerItem, foreshadow],
      },
      context: {
        ...context,
        recalledMemory: '',
        recalledMemorySources: [ownerItem],
        visibilityReport: {
          purpose: 'writer',
          povCharacterIds: [1],
          unresolvedPovLabels: [],
          decisions: [{
            sourceKey: 'part:recalledMemory',
            channel: 'semantic_memory',
            included: false,
            reason: 'pov_forbidden_fact',
            factIds: [91],
          }],
          requiredMissingSourceKeys: ['contract:foreshadow:91'],
          requiredMissingFactIds: [91],
          sources: [],
        },
      },
      stage: 'draft',
    })
    assert.equal(mixedVisibilitySources.filter((source) => source.key === 'asset:item:20').length, 1)
    assert.equal(mixedVisibilitySources.some((source) => source.key === 'contract:foreshadow:91'), false)

    const rejected = relation.loadRelationRecallSources(db, {
      novelId: 1,
      chapterNum: 200,
      seedEntityIds: [{ type: 'character', id: 900 }],
      explicitContractRefs: [{ type: 'timeline_event', id: 50 }],
    })
    assert.equal(rejected.sources.some((source) => source.sourceKey === 'asset:timeline_event:50'), false)
    assert.equal(rejected.sources.some((source) => source.sourceKey.includes('character:900')), false)
    assert.ok(rejected.diagnostics.some((item) => item.code === 'foreign_entity' && item.reference === 'character:900'))
    assert.ok(rejected.diagnostics.some((item) => item.code === 'future_source' && item.reference.includes('timeline_event:50')))

    return {
      cases: {
        '13-01': 'PASS', '13-02': 'PASS', '13-03': 'PASS',
        '13-04': 'PASS', '13-05': 'PASS', '13-06': 'PASS',
      },
      assertions: [
        'chapter-3 required foreshadow reaches chapter 200 through real SQLite contract references',
        'owner item and one-hop relations are selected without recursive expansion',
        'required sources survive stable optional limits',
        'SQL and semantic hits share one canonical ContextPack source',
        'mixed recalledMemory rejection keeps allowed per-source required recall and drops denied sources',
        'foreign and future entities are rejected with ID-only diagnostics',
      ],
      sqlite: {
        resolverQueries: resolved.queryCount,
        recallQueries: recalled.queryCount,
        candidateCount: recalled.candidateCount,
        selectedCount: recalled.sources.length,
      },
    }
  } finally {
    db.close()
  }
}

module.exports = { run }
