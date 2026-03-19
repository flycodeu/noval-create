const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const toolsRoot = path.resolve(projectRoot, '.local-tools')
const archiveDir = path.resolve(toolsRoot, 'archives')
const nsisDir = path.resolve(toolsRoot, 'nsis')
const archivePath = path.resolve(archiveDir, 'nsis-3.0.4.1.7z')
const defaultUrl = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z'

function log(message) {
  process.stdout.write(`[setup:nsis] ${message}\n`)
}

function hasBundle(targetDir) {
  return fs.existsSync(path.join(targetDir, 'Bin', 'makensis.exe'))
    && fs.existsSync(path.join(targetDir, 'elevate.exe'))
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
          reject(new Error('Too many redirects while downloading NSIS bundle.'))
          return
        }
        resolve(download(response.headers.location, destination, redirectCount + 1))
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Unexpected status code ${response.statusCode || 'unknown'} while downloading NSIS bundle.`))
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

function extractArchive(sevenZipPath) {
  fs.rmSync(nsisDir, { recursive: true, force: true })
  fs.mkdirSync(nsisDir, { recursive: true })

  const result = spawnSync(sevenZipPath, ['x', archivePath, `-o${nsisDir}`, '-y'], {
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
    throw new Error('Failed to extract the NSIS bundle archive.')
  }
}

async function main() {
  if (hasBundle(nsisDir)) {
    log(`Using existing NSIS bundle at ${nsisDir}`)
    return
  }

  const sevenZipPath = resolveSevenZip()
  if (!sevenZipPath) {
    throw new Error('Unable to find a local 7-Zip executable. Set NOVELFORGE_7Z_PATH to continue.')
  }

  fs.mkdirSync(archiveDir, { recursive: true })
  const bundleUrl = process.env.NOVELFORGE_NSIS_BUNDLE_URL || defaultUrl

  if (!fs.existsSync(archivePath)) {
    log(`Downloading NSIS bundle from ${bundleUrl}`)
    await download(bundleUrl, archivePath)
  } else {
    log(`Reusing cached archive ${archivePath}`)
  }

  log(`Extracting NSIS bundle with ${sevenZipPath}`)
  extractArchive(sevenZipPath)

  if (!hasBundle(nsisDir)) {
    throw new Error('NSIS bundle extraction completed, but required files were not found.')
  }

  log(`NSIS bundle ready at ${nsisDir}`)
}

main().catch((error) => {
  process.stderr.write(`[setup:nsis] ${error.message}\n`)
  process.exit(1)
})
