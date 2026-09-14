const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function firstExisting(candidates) {
  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate)) || null
}

function findOnPath(names) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  for (const name of names) {
    const result = spawnSync(locator, [name], { encoding: 'utf8', shell: false })
    if (result.status === 0) {
      const match = String(result.stdout || '').split(/\r?\n/u).map((item) => item.trim()).find(Boolean)
      if (match && fs.existsSync(match)) return match
    }
  }
  return null
}

function resolveSevenZip(projectRoot) {
  return firstExisting([
    process.env.NOVELFORGE_7Z_PATH,
    path.resolve(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, '7-Zip', '7z.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], '7-Zip', '7z.exe'),
  ]) || findOnPath(['7z.exe', '7za.exe', '7z', '7za'])
}

function resolveSignTool() {
  const configured = firstExisting([process.env.NOVELFORGE_SIGNTOOL_PATH])
  if (configured) return configured

  const fromPath = findOnPath(['signtool.exe', 'signtool'])
  if (fromPath) return fromPath

  const kitsRoot = process.env['ProgramFiles(x86)']
    ? path.join(process.env['ProgramFiles(x86)'], 'Windows Kits', '10', 'bin')
    : null
  if (!kitsRoot || !fs.existsSync(kitsRoot)) return null

  const versionDirs = fs.readdirSync(kitsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)+$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))

  return firstExisting(versionDirs.map((version) => path.join(kitsRoot, version, 'x64', 'signtool.exe')))
}

module.exports = { resolveSevenZip, resolveSignTool }
