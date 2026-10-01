const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { test } = require('node:test')
const { verifyReleaseAssets } = require('./verify-release-assets.cjs')

function fixture(t, metadataOverride) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-release-test-'))
  t.after(() => {
    assert.equal(path.dirname(dir), os.tmpdir())
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const version = '1.0.0'
  const setup = `NovelForge-Setup-${version}-x64.exe`
  const portable = `NovelForge-Portable-${version}-x64.exe`
  const bytes = Buffer.from('NSIS fixture')
  const hash = crypto.createHash('sha512').update(bytes).digest('base64')
  fs.writeFileSync(path.join(dir, setup), bytes)
  fs.writeFileSync(path.join(dir, `${setup}.blockmap`), 'blockmap')
  fs.writeFileSync(path.join(dir, portable), 'portable')
  fs.writeFileSync(path.join(dir, 'latest.yml'), metadataOverride?.({ version, setup, portable, hash })
    ?? `version: ${version}\nfiles:\n  - url: ${setup}\n    sha512: ${hash}\npath: ${setup}\nsha512: ${hash}\n`)
  return { dir, version, setup, portable }
}

test('release metadata refers to the exact NSIS asset and SHA-512', async (t) => {
  const { dir, version, setup, portable } = fixture(t)
  assert.deepEqual(await verifyReleaseAssets(dir, version), [setup, `${setup}.blockmap`, portable, 'latest.yml'])
})

test('rejects a portable update or mismatched version', async (t) => {
  const wrongTarget = fixture(t, ({ version, portable, hash }) =>
    `version: ${version}\nfiles:\n  - url: ${portable}\n    sha512: ${hash}\n`)
  await assert.rejects(verifyReleaseAssets(wrongTarget.dir, wrongTarget.version), /only the NSIS installer/)

  const wrongVersion = fixture(t, ({ setup, hash }) =>
    `version: 2.0.0\nfiles:\n  - url: ${setup}\n    sha512: ${hash}\n`)
  await assert.rejects(verifyReleaseAssets(wrongVersion.dir, wrongVersion.version), /version/)
})

test('rejects mismatched hash or missing blockmap', async (t) => {
  const wrongHash = fixture(t, ({ version, setup }) =>
    `version: ${version}\nfiles:\n  - url: ${setup}\n    sha512: invalid\n`)
  await assert.rejects(verifyReleaseAssets(wrongHash.dir, wrongHash.version), /SHA-512/)

  const missingBlockmap = fixture(t)
  fs.unlinkSync(path.join(missingBlockmap.dir, `${missingBlockmap.setup}.blockmap`))
  await assert.rejects(verifyReleaseAssets(missingBlockmap.dir, missingBlockmap.version), /blockmap/)
})
