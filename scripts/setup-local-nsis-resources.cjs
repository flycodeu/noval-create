const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const toolsRoot = path.resolve(projectRoot, '.local-tools')
const archiveDir = path.resolve(toolsRoot, 'archives')
const cacheRoot = path.resolve(process.env.NOVELFORGE_ELECTRON_BUILDER_CACHE || process.env.ELECTRON_BUILDER_CACHE || path.resolve(toolsRoot, 'electron-builder-cache'))
const nsisCacheDir = path.resolve(cacheRoot, 'nsis')
const resourceDir = path.resolve(nsisCacheDir, 'nsis-resources-3.4.1')
const tempExtractDir = path.resolve(toolsRoot, 'tmp-nsis-resources')
const archivePath = path.resolve(archiveDir, 'nsis-resources-3.4.1.7z')
const defaultUrl = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z'

function log(message) {
  process.stdout.write(`[setup:nsis-resources] ${message}\n`)
}

function hasResourceBundle(targetDir) {
  return fs.existsSync(path.join(targetDir, 'plugins', 'x86-unicode'))
}

function resolveSevenZip() {
  const candidates = [
    process.env.NOVELFORGE_7Z_PATH,
    'C:\\Program Files\\Nutstore\\bin-7.2.10\\7ZipStandalone\\7za.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVIDIA app\\7z.exe',
    'D:\\Program Files\\ShadowBot\\shadowbot-5.30.37\\7za.exe',
    'D:\\Software\\vmware\\7za.exe',
    'D:\\Program Files\\SmartPSSPlus\\7z.exe',
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function download(url, destination, redirectCount = 0) {
  const client = url.startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const request = client.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.destroy()
        if (redirectCount > 8) {
          reject(new Error('Too many redirects while downloading NSIS resources.'))
          return
        }
        resolve(download(response.headers.location, destination, redirectCount + 1))
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Unexpected status code ${response.statusCode || 'unknown'} while downloading NSIS resources.`))
        return
      }

      const file = fs.createWriteStream(destination)
      response.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    })

    request.on('error', reject)
  })
}

function resolveExtractedRoot(baseDir) {
  if (hasResourceBundle(baseDir)) {
    return baseDir
  }

  const directChild = path.join(baseDir, 'nsis-resources-3.4.1')
  if (hasResourceBundle(directChild)) {
    return directChild
  }

  const childDirs = fs.existsSync(baseDir)
    ? fs.readdirSync(baseDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(baseDir, entry.name))
    : []

  return childDirs.find((candidate) => hasResourceBundle(candidate)) || null
}

function extractArchive(sevenZipPath) {
  fs.rmSync(tempExtractDir, { recursive: true, force: true })
  fs.mkdirSync(tempExtractDir, { recursive: true })
  fs.mkdirSync(nsisCacheDir, { recursive: true })

  const result = spawnSync(sevenZipPath, ['x', archivePath, `-o${tempExtractDir}`, '-y'], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  })

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  if (result.status !== 0) {
    throw new Error('Failed to extract the NSIS resources archive.')
  }

  const extractedRoot = resolveExtractedRoot(tempExtractDir)
  if (!extractedRoot) {
    throw new Error('NSIS resources extraction completed, but the plugins directory was not found.')
  }

  fs.rmSync(resourceDir, { recursive: true, force: true })
  fs.cpSync(extractedRoot, resourceDir, { recursive: true })
  fs.rmSync(tempExtractDir, { recursive: true, force: true })
}

async function main() {
  if (hasResourceBundle(resourceDir)) {
    log(`Using existing NSIS resources at ${resourceDir}`)
    return
  }

  const sevenZipPath = resolveSevenZip()
  if (!sevenZipPath) {
    throw new Error('Unable to find a local 7-Zip executable. Set NOVELFORGE_7Z_PATH to continue.')
  }

  fs.mkdirSync(archiveDir, { recursive: true })
  const bundleUrl = process.env.NOVELFORGE_NSIS_RESOURCES_URL || defaultUrl

  if (!fs.existsSync(archivePath)) {
    log(`Downloading NSIS resources from ${bundleUrl}`)
    await download(bundleUrl, archivePath)
  } else {
    log(`Reusing cached archive ${archivePath}`)
  }

  log(`Extracting NSIS resources with ${sevenZipPath}`)
  extractArchive(sevenZipPath)

  if (!hasResourceBundle(resourceDir)) {
    throw new Error('NSIS resources extraction completed, but the expected cache directory is incomplete.')
  }

  log(`NSIS resources ready at ${resourceDir}`)
}

main().catch((error) => {
  process.stderr.write(`[setup:nsis-resources] ${error.message}\n`)
  process.exit(1)
})
