const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const root = path.resolve(__dirname, '..')
const parent = path.join(root, '.tmp-tests')
fs.mkdirSync(parent, { recursive: true })
const profile = fs.mkdtempSync(path.join(parent, 'local-embedding-runtime-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)

const model = 'Xenova/bge-small-zh-v1.5'
const oldModelId = `local:${model}:q8`
const modelSha256 = '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc'

async function main() {
  await app.whenReady()
  const cache = path.join(profile, 'models', 'embeddings')
  const source = process.env.NOVELFORGE_EMBEDDING_FIXTURE_CACHE
    || path.join(root, 'node_modules/@huggingface/transformers/.cache')
  const sourceModel = path.join(source, model)
  if (fs.existsSync(path.join(sourceModel, 'onnx/model_quantized.onnx'))) {
    fs.mkdirSync(path.dirname(path.join(cache, model)), { recursive: true })
    fs.cpSync(sourceModel, path.join(cache, model), { recursive: true })
  }
  const { env, pipeline } = await import('@huggingface/transformers')
  env.cacheDir = cache
  env.localModelPath = cache + path.sep
  env.useBrowserCache = false
  env.allowLocalModels = true
  env.useFSCache = true
  const modelFile = path.join(cache, model, 'onnx/model_quantized.onnx')
  if (!fs.existsSync(modelFile)) {
    assert(process.argv.includes('--download-model'),
      'Provide NOVELFORGE_EMBEDDING_FIXTURE_CACHE or explicitly opt in with --download-model')
    // Only public model files are fetched. No author data or provider key is used.
    env.allowRemoteModels = true
    const fixture = await pipeline('feature-extraction', model, { dtype: 'q8', device: 'cpu' })
    await fixture.dispose()
  }
  assert.equal(createHash('sha256').update(fs.readFileSync(modelFile)).digest('hex'), modelSha256,
    'The compatibility fixture must use the same q8 model weights as the old runtime')
  if (process.argv.includes('--download-model')) {
    // Reuse only public weights in the later packaged-runtime test. This path
    // is fixed inside the ignored test directory, never a formal user profile.
    const reusable = path.join(parent, 'embedding-runtime-model-cache', model)
    fs.mkdirSync(path.dirname(reusable), { recursive: true })
    fs.cpSync(path.join(cache, model), reusable, { recursive: true })
  }
  env.allowRemoteModels = false
  globalThis.fetch = async () => { throw new Error('Offline inference attempted a network request') }

  const database = require('../electron/database/db.ts')
  const embedding = require('../electron/services/embedding.service.ts')
  const settings = require('../electron/services/embedding-settings.service.ts')
  const { LOCAL_EMBEDDING_MODEL_ID } = require('../src/shared/embedding-settings.ts')
  const { getChapterIndexStatus } = require('../electron/services/chapter-index.service.ts')
  database.initDb()
  try {
    settings.setEmbeddingSettings({ mode: 'local', modelConfigId: null, modelId: '' })
    assert.notEqual(LOCAL_EMBEDDING_MODEL_ID, oldModelId)
    assert.equal(settings.embeddingRuntimeIdentity().key, LOCAL_EMBEDDING_MODEL_ID)
    const texts = [
      '矿灯在巷道里晃了一下。叶振按住木楔，要求班组停工复查。',
      'NovelForge 本地检索，保留已保存正文，不混用不同运行时的向量。',
    ]
    const batch = await embedding.embedSemanticTexts(texts)
    assert.equal(batch.source, 'local', 'Failure must not silently pass via keyword fallback')
    assert.equal(batch.dimensions, 512)
    assert.equal(batch.profile, `${LOCAL_EMBEDDING_MODEL_ID}:512`)
    for (const vector of batch.embeddings) {
      assert(vector.every(Number.isFinite))
      assert(Math.abs(Math.hypot(...vector) - 1) < 0.00001)
    }
    const sqlite = database.getSqlite()
    const novelId = Number(sqlite.prepare('INSERT INTO novels(title) VALUES(?)').run('隔离向量兼容测试').lastInsertRowid)
    const chapterId = Number(sqlite.prepare('INSERT INTO chapters(novel_id,chapter_num,content) VALUES(?,?,?)')
      .run(novelId, 1, texts[0]).lastInsertRowid)
    const oldVector = JSON.stringify(batch.embeddings[0])
    sqlite.prepare(`INSERT INTO chapter_embeddings
      (novel_id,chapter_id,fragment_type,fragment_text,embedding_json,model_id,dimensions,embedding_profile,source_hash)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(novelId, chapterId, 'content_excerpt', texts[0], oldVector, oldModelId, 512,
      `${oldModelId}:512`, embedding.hashEmbeddingSource(chapterId, 1, [{ type: 'content_excerpt', text: texts[0] }], oldModelId))
    const oldRows = sqlite.prepare('SELECT * FROM chapter_embeddings WHERE chapter_id=?').all(chapterId)
    const fallback = await embedding.searchSimilarFragments(novelId, '矿灯 木楔', 5, undefined, { proseOnly: true })
    assert.equal(fallback.fallbackReason, 'embedding_profile_mismatch')
    assert(fallback.hits.some(hit => hit.chapterId === chapterId && hit.searchMode === 'keyword'))
    assert.deepEqual(sqlite.prepare('SELECT * FROM chapter_embeddings WHERE chapter_id=?').all(chapterId), oldRows,
      'A read must preserve the old rows until explicit re-indexing')
    assert.equal(getChapterIndexStatus(novelId).vectorIndexedChapterCount, 0)
    const rebuilt = await embedding.generateChapterEmbeddings(novelId, chapterId, undefined, { proseOnly: true })
    assert(rebuilt.applied && rebuilt.vectorizedCount > 0)
    assert.equal(getChapterIndexStatus(novelId).vectorIndexedChapterCount, 1)
    assert(sqlite.prepare('SELECT embedding_profile FROM chapter_embeddings WHERE chapter_id=?').all(chapterId)
      .every(row => row.embedding_profile === batch.profile))
    const result = await embedding.searchSimilarFragments(novelId, texts[0], 1, undefined, { proseOnly: true })
    assert(result.hits.some(hit => hit.chapterId === chapterId && hit.searchMode === 'vector' && hit.similarity > 0.99))
    assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id=?').get(chapterId).content, texts[0])
    console.log(`[local-embedding-runtime] Electron ${process.versions.electron}: offline q8/512 inference, old-profile isolation, keyword fallback and explicit rebuild passed`)
  } finally {
    database.closeDb()
  }
}

main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
