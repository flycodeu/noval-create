const assert = require('node:assert/strict')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')

// Exercise the exact downloader used by electron-builder, in a separate process
// so global-agent's HTTP patches and environment overrides cannot leak to tests.
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
const getRequire = createRequire(builderRequire.resolve('@electron/get'))
const servers = []
const sockets = new Set()
const payload = Buffer.from('NovelForge local dependency proxy fixture\n')
const certificate = fs.readFileSync(path.join(__dirname, 'browser-fixtures/proxy-tls/localhost-cert.pem'))
const privateKey = fs.readFileSync(path.join(__dirname, 'browser-fixtures/proxy-tls/localhost-key.pem'))

async function listen(server) {
  servers.push(server)
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

async function main() {
  let directRequests = 0
  const originPort = await listen(http.createServer((request, response) => {
    directRequests += 1
    response.end(payload)
  }))
  const tlsPort = await listen(https.createServer({ key: privateKey, cert: certificate }, (request, response) => response.end(payload)))
  const httpRequests = []
  const tunnels = []
  function proxy(label) {
    const server = http.createServer((request, response) => {
      httpRequests.push({ label, url: request.url })
      response.end(payload)
    })
    server.on('connect', (request, client, head) => {
      assert.equal(request.url, `127.0.0.1:${tlsPort}`)
      tunnels.push(label)
      const upstream = net.connect(tlsPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      sockets.add(upstream)
      upstream.on('close', () => sockets.delete(upstream))
      upstream.on('error', () => client.destroy())
      client.on('close', () => upstream.destroy())
    })
    return server
  }
  const httpProxyPort = await listen(proxy('http'))
  const httpsProxyPort = await listen(proxy('https'))
  for (const key of Object.keys(process.env)) {
    if (/proxy/i.test(key) || /^npm_config_electron_|^ELECTRON_/i.test(key)) delete process.env[key]
  }
  process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${httpProxyPort}`
  process.env.GLOBAL_AGENT_HTTPS_PROXY = `http://127.0.0.1:${httpsProxyPort}`
  process.env.GLOBAL_AGENT_NO_PROXY = ''
  process.env.ELECTRON_GET_NO_PROGRESS = '1'
  const downloader = builderRequire('@electron/get')
  assert.equal(getRequire('global-agent/package.json').version, '4.1.3')
  downloader.initializeProxy()
  assert.ok(global.GLOBAL_AGENT, 'proxy bootstrap must succeed, not silently fall back')
  const root = path.resolve(__dirname, '..', '.tmp-tests')
  fs.mkdirSync(root, { recursive: true })
  const cacheRoot = fs.mkdtempSync(path.join(root, 'proxy-download-'))
  const artifactName = 'fixture.txt'
  async function download(url) {
    const file = await downloader.downloadArtifact({
      version: '45.0.0', artifactName, isGeneric: true, force: true, cacheRoot,
      checksums: { [artifactName]: createHash('sha256').update(payload).digest('hex') },
      mirrorOptions: { resolveAssetURL: async () => url },
      downloadOptions: { quiet: true, retry: { limit: 0 }, timeout: { request: 5000 }, https: { certificateAuthority: certificate } },
    })
    assert.deepEqual(fs.readFileSync(file), payload)
  }
  const httpUrl = `http://127.0.0.1:${originPort}/${artifactName}`
  const httpsUrl = `https://127.0.0.1:${tlsPort}/${artifactName}`
  await download(httpUrl)
  assert.deepEqual(httpRequests, [{ label: 'http', url: httpUrl }])
  assert.equal(directRequests, 0)
  await download(httpsUrl)
  assert.deepEqual(tunnels, ['https'])
  global.GLOBAL_AGENT.HTTPS_PROXY = null
  await download(httpsUrl)
  assert.deepEqual(tunnels, ['https', 'http'])
  global.GLOBAL_AGENT.NO_PROXY = '127.0.0.1'
  await download(httpUrl)
  await download(httpsUrl)
  assert.equal(directRequests, 1)
  assert.equal(httpRequests.length, 1)
  assert.equal(tunnels.length, 2)
  global.GLOBAL_AGENT.NO_PROXY = null
  global.GLOBAL_AGENT.HTTP_PROXY = null
  await download(httpUrl)
  assert.equal(directRequests, 2)
  console.log('Dependency proxy passed: HTTP, HTTPS CONNECT, HTTPS fallback, NO_PROXY, direct download, SHA256')
}

if (process.argv.includes('--child')) {
  main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  })
} else {
  // global-agent manages the TLS connection, so trust the test CA at process
  // startup, just as corporate proxy users do with NODE_EXTRA_CA_CERTS.
  const result = require('node:child_process').spawnSync(process.execPath, [__filename, '--child'], {
    stdio: 'inherit', timeout: 30000,
    env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(__dirname, 'browser-fixtures/proxy-tls/localhost-cert.pem') },
  })
  if (result.error) console.error(result.error)
  process.exitCode = result.status ?? 1
}
