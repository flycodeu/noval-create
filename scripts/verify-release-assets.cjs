const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function requireAsset(releaseDir, name) {
  const file = path.join(releaseDir, name)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(`Missing or empty release asset: ${name}`)
  }
  return file
}

function readUpdateEntries(metadata) {
  const entries = []
  let current = null
  for (const line of metadata.split(/\r?\n/)) {
    const url = /^\s+- url:\s*['"]?([^'"\r\n]+?)['"]?\s*$/.exec(line)
    if (url) {
      current = { url: url[1], sha512: '' }
      entries.push(current)
      continue
    }
    const hash = /^\s+sha512:\s*['"]?([^'"\r\n]+?)['"]?\s*$/.exec(line)
    if (hash && current && !current.sha512) current.sha512 = hash[1]
  }
  return entries
}

async function sha512File(file) {
  const hash = crypto.createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

async function verifyReleaseAssets(releaseDir, version) {
  const setupName = `NovelForge-Setup-${version}-x64.exe`
  const portableName = `NovelForge-Portable-${version}-x64.exe`
  const setupPath = requireAsset(releaseDir, setupName)
  requireAsset(releaseDir, `${setupName}.blockmap`)
  requireAsset(releaseDir, portableName)
  const metadata = fs.readFileSync(requireAsset(releaseDir, 'latest.yml'), 'utf8')
  const metadataVersion = /^version:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(metadata)?.[1]
  if (metadataVersion !== version) {
    throw new Error(`latest.yml version ${metadataVersion || '(missing)'} does not match ${version}`)
  }

  const updateEntries = readUpdateEntries(metadata)
  const exeEntries = updateEntries.filter((entry) => entry.url.toLowerCase().endsWith('.exe'))
  if (exeEntries.length !== 1 || exeEntries[0].url !== setupName) {
    throw new Error(`latest.yml must offer only the NSIS installer ${setupName}`)
  }
  if (exeEntries[0].sha512 !== await sha512File(setupPath)) {
    throw new Error(`latest.yml SHA-512 does not match ${setupName}`)
  }

  return [setupName, `${setupName}.blockmap`, portableName, 'latest.yml']
}

if (require.main === module) {
  const version = require('../package.json').version
  verifyReleaseAssets(path.resolve(__dirname, '../release'), version)
    .then((files) => process.stdout.write(`[release] Verified ${version}: ${files.join(', ')}\n`))
    .catch((error) => {
      process.stderr.write(`[release] ${error.message}\n`)
      process.exitCode = 1
    })
}

module.exports = { verifyReleaseAssets }
