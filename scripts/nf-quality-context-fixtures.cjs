'use strict'

const assert = require('node:assert/strict')
const http = require('node:http')
const { URL } = require('node:url')

const NF00_FIXTURE = Object.freeze({
  novels: Object.freeze([
    Object.freeze({ id: 101, key: 'N1', title: 'NF-00 N1' }),
    Object.freeze({ id: 202, key: 'N2', title: 'NF-00 N2' }),
  ]),
  chapters: Object.freeze([
    Object.freeze({ id: 901, novelId: 101, chapterNum: 3, title: 'N1 第3章' }),
    Object.freeze({ id: 15, novelId: 101, chapterNum: 80, title: 'N1 第80章' }),
    Object.freeze({ id: 3001, novelId: 101, chapterNum: 20, title: 'N1 第20章' }),
    Object.freeze({ id: 902, novelId: 202, chapterNum: 2, title: 'N2 第2章' }),
  ]),
})

function configureIsolatedDatabase(db) {
  db.pragma('busy_timeout = 5000')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
}

function getMigrationIds(db) {
  return db
    .prepare('SELECT id FROM _schema_migrations ORDER BY id')
    .all()
    .map((row) => row.id)
}

function insertNf00Fixture(db) {
  const insertNovel = db.prepare(`
    INSERT INTO novels (id, title, status, context_version)
    VALUES (?, ?, 'draft', 1)
  `)
  const insertChapter = db.prepare(`
    INSERT INTO chapters (id, novel_id, chapter_num, title, content, status)
    VALUES (?, ?, ?, ?, ?, 'outline')
  `)

  const insert = db.transaction(() => {
    for (const novel of NF00_FIXTURE.novels) {
      insertNovel.run(novel.id, novel.title)
    }
    for (const chapter of NF00_FIXTURE.chapters) {
      insertChapter.run(
        chapter.id,
        chapter.novelId,
        chapter.chapterNum,
        chapter.title,
        `fixture:${chapter.title}`,
      )
    }
  })
  insert()

  return {
    novels: Object.fromEntries(NF00_FIXTURE.novels.map((novel) => [novel.key, novel.id])),
    chapters: Object.fromEntries(NF00_FIXTURE.chapters.map((chapter) => [chapter.id, chapter.chapterNum])),
  }
}

function mapChapterRow(row) {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    chapterNum: Number(row.chapter_num),
    title: row.title,
  }
}

function readNf00ChapterRows(db, novelId) {
  return db
    .prepare(`
      SELECT id, novel_id, chapter_num, title
      FROM chapters
      WHERE novel_id = ?
      ORDER BY chapter_num ASC, id ASC
    `)
    .all(novelId)
    .map(mapChapterRow)
}

function verifyNf00Fixture(db) {
  const n1Rows = readNf00ChapterRows(db, 101)
  const n2Rows = readNf00ChapterRows(db, 202)

  assert.deepEqual(n1Rows.map((row) => row.id), [901, 3001, 15])
  assert.deepEqual(n1Rows.map((row) => row.chapterNum), [3, 20, 80])
  assert.notDeepEqual(n1Rows.map((row) => row.id), n1Rows.map((row) => row.chapterNum))
  assert.deepEqual(n2Rows.map((row) => row.id), [902])
  assert.deepEqual(n2Rows.map((row) => row.chapterNum), [2])

  const chapterThree = db
    .prepare(`
      SELECT id, novel_id, chapter_num
      FROM chapters
      WHERE id = ? AND novel_id = ?
    `)
    .get(901, 101)
  assert.deepEqual(chapterThree, { id: 901, novel_id: 101, chapter_num: 3 })

  const n1Ids = db
    .prepare('SELECT id FROM chapters WHERE novel_id = ? ORDER BY id')
    .all(101)
    .map((row) => row.id)
  const n2Ids = db
    .prepare('SELECT id FROM chapters WHERE novel_id = ? ORDER BY id')
    .all(202)
    .map((row) => row.id)
  assert.deepEqual(n1Ids, [15, 901, 3001])
  assert.deepEqual(n2Ids, [902])
  assert.equal(n1Ids.includes(902), false)
  assert.equal(n2Ids.includes(901), false)

  return {
    n1Rows,
    n2Rows,
    chapterThree: {
      id: Number(chapterThree.id),
      novelId: Number(chapterThree.novel_id),
      chapterNum: Number(chapterThree.chapter_num),
    },
  }
}

function normalizeRoute(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) {
    throw new TypeError('stub route must be a non-empty string')
  }
  const route = new URL(pathname, 'http://127.0.0.1').pathname
  return route.startsWith('/') ? route : `/${route}`
}

function normalizeResponse(response) {
  if (typeof response === 'string' || Buffer.isBuffer(response)) {
    return { statusCode: 200, headers: {}, body: response }
  }
  if (!response || typeof response !== 'object') {
    throw new TypeError('stub response must be a string, Buffer, or response object')
  }
  return {
    statusCode: Number(response.statusCode || 200),
    headers: { ...(response.headers || {}) },
    body: response.body === undefined ? '' : response.body,
  }
}

function encodeResponseBody(body) {
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  return Buffer.from(JSON.stringify(body), 'utf8')
}

function isLoopbackHostname(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

function createLoopbackHttpStub() {
  const routes = new Map()
  const requestLog = []
  const attempts = []
  let server = null
  let port = null
  let closed = false

  function register(pathname, response) {
    routes.set(normalizeRoute(pathname), response)
    return api
  }

  async function resolveRoute(route, request) {
    let scripted = route
    if (Array.isArray(scripted)) {
      if (scripted.length === 0) {
        throw new Error(`NF_STUB_RESPONSE_EXHAUSTED: ${request.path}`)
      }
      scripted = scripted.shift()
    }
    if (typeof scripted === 'function') {
      scripted = await scripted(request)
    }
    return normalizeResponse(scripted)
  }

  async function handleRequest(req, res) {
    const parsed = new URL(req.url || '/', 'http://127.0.0.1')
    const chunks = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const request = {
      method: req.method || 'GET',
      path: parsed.pathname,
      query: parsed.search,
      headers: { ...req.headers },
      body: Buffer.concat(chunks).toString('utf8'),
      remoteAddress: req.socket.remoteAddress || null,
    }
    requestLog.push(request)

    if (!isLoopbackHostname(request.remoteAddress || '')) {
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'NF_STUB_NON_LOOPBACK_CLIENT' }))
      return
    }

    const registered = routes.get(request.path)
    try {
      const response = registered === undefined
        ? { statusCode: 404, headers: { 'content-type': 'application/json' }, body: { error: 'NF_STUB_UNREGISTERED_ROUTE', path: request.path } }
        : await resolveRoute(registered, request)
      const body = encodeResponseBody(response.body)
      const headers = { ...response.headers }
      if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-length')) {
        headers['content-length'] = body.length
      }
      res.writeHead(response.statusCode, headers)
      res.end(body)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const body = encodeResponseBody({ error: 'NF_STUB_HANDLER_FAILED', message })
      res.writeHead(500, { 'content-type': 'application/json', 'content-length': body.length })
      res.end(body)
    }
  }

  async function start() {
    if (server) return api
    server = http.createServer((req, res) => {
      void handleRequest(req, res)
    })
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server?.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server?.off('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('NF_STUB_INVALID_ADDRESS'))
          return
        }
        port = address.port
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen({ host: '127.0.0.1', port: 0 })
    })
    return api
  }

  function getBaseUrl() {
    if (!port) throw new Error('NF_STUB_NOT_STARTED')
    return `http://127.0.0.1:${port}`
  }

  function request(target, options = {}) {
    const baseUrl = getBaseUrl()
    const parsed = new URL(target, `${baseUrl}/`)
    const targetPort = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
    const isCurrentStub = isLoopbackHostname(parsed.hostname) && targetPort === port && parsed.protocol === 'http:'
    const attempt = { method: options.method || 'GET', url: parsed.href, blocked: !isCurrentStub }
    attempts.push(attempt)
    if (!isLoopbackHostname(parsed.hostname)) {
      return Promise.reject(new Error(`NF_STUB_EXTERNAL_URL: ${parsed.hostname}`))
    }
    if (!isCurrentStub) {
      return Promise.reject(new Error(`NF_STUB_WRONG_ENDPOINT: ${parsed.href}`))
    }

    return new Promise((resolve, reject) => {
      const body = options.body === undefined || options.body === null
        ? null
        : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body), 'utf8')
      const headers = { ...(options.headers || {}) }
      if (body && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-length')) {
        headers['content-length'] = body.length
      }
      const req = http.request({
        hostname: parsed.hostname,
        port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || 'GET',
        headers,
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8')
          const response = {
            statusCode: res.statusCode || 0,
            headers: { ...res.headers },
            body: responseBody,
          }
          if (response.statusCode >= 400) {
            const error = new Error(`NF_STUB_HTTP_${response.statusCode}: ${parsed.pathname}`)
            error.statusCode = response.statusCode
            error.responseBody = responseBody
            reject(error)
            return
          }
          resolve(response)
        })
      })
      req.once('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }

  async function close() {
    if (!server || closed) return
    closed = true
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error)
          return
        }
        resolve()
      })
    })
    server = null
  }

  const api = {
    register,
    start,
    request,
    close,
    getBaseUrl,
    getRequestLog: () => requestLog.map((entry) => ({ ...entry, headers: { ...entry.headers } })),
    getAttemptLog: () => attempts.map((entry) => ({ ...entry })),
    getRequestCount: (pathname) => requestLog.filter((entry) => entry.path === normalizeRoute(pathname)).length,
  }
  return api
}

module.exports = {
  NF00_FIXTURE,
  configureIsolatedDatabase,
  createLoopbackHttpStub,
  getMigrationIds,
  insertNf00Fixture,
  readNf00ChapterRows,
  verifyNf00Fixture,
}
