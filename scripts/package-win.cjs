const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const builderEntry = path.resolve(projectRoot, 'node_modules', 'electron-builder', 'cli.js')
const setupNsisScript = path.resolve(__dirname, 'setup-local-nsis.cjs')
const setupNsisResourcesScript = path.resolve(__dirname, 'setup-local-nsis-resources.cjs')
const ensureBuildIconsScript = path.resolve(__dirname, 'ensure-build-icons.cjs')
const signScript = path.resolve(__dirname, 'sign-windows-artifacts.cjs')
const releaseDir = path.resolve(projectRoot, 'release')
const args = new Set(process.argv.slice(2))
const signed = args.has('--signed')

function flushResult(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  if (result.error) {
    process.stderr.write(`${result.error.stack || result.error.message}\n`)
  }
}

function runProcess(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: options.env || process.env,
    shell: false,
    stdio: 'pipe',
  })

  if (!options.silent) {
    flushResult(result)
  }

  return result
}

function runBuilder(builderArgs, env) {
  return runProcess(process.execPath, [builderEntry, ...builderArgs], { env })
}

function runNodeScript(scriptPath, scriptArgs, options = {}) {
  return runProcess(process.execPath, [scriptPath, ...scriptArgs], options)
}

function runNpmScript(scriptName, options = {}) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return runProcess(process.execPath, [npmExecPath, 'run', scriptName], options)
  }

  if (process.platform === 'win32') {
    const commandShell = process.env.ComSpec || 'cmd.exe'
    // Directly spawning npm.cmd can fail with EINVAL on Windows in newer Node runtimes.
    return runProcess(commandShell, ['/d', '/s', '/c', `npm run ${scriptName}`], options)
  }

  return runProcess('npm', ['run', scriptName], options)
}

function runTestPreflight() {
  process.stdout.write('[package:win] Running npm test before packaging.\n')
  const result = runNpmScript('test')
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function ensureBuildIcons() {
  const result = runNodeScript(ensureBuildIconsScript, [])
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function hasNsisBundle(targetDir) {
  return fs.existsSync(path.join(targetDir, 'Bin', 'makensis.exe'))
    && fs.existsSync(path.join(targetDir, 'elevate.exe'))
}

function resolveNsisDir() {
  const candidates = [
    process.env.NOVELFORGE_NSIS_DIR,
    process.env.ELECTRON_BUILDER_NSIS_DIR,
    path.resolve(projectRoot, '.local-tools', 'nsis'),
  ].filter(Boolean)

  return candidates.find((candidate) => hasNsisBundle(candidate)) || null
}

function ensureNsisDir() {
  const existing = resolveNsisDir()
  if (existing) {
    return existing
  }

  const setupResult = runNodeScript(setupNsisScript, [])
  if (setupResult.status !== 0) {
    process.exit(setupResult.status || 1)
  }

  const ready = resolveNsisDir()
  if (!ready) {
    process.stderr.write('[package:win] NSIS bundle is still unavailable after setup.\n')
    process.exit(1)
  }

  return ready
}

function hasNsisResources(targetDir) {
  return fs.existsSync(path.join(targetDir, 'nsis', 'nsis-resources-3.4.1', 'plugins', 'x86-unicode'))
}

function resolveBuilderCacheDir() {
  const candidates = [
    process.env.NOVELFORGE_ELECTRON_BUILDER_CACHE,
    process.env.ELECTRON_BUILDER_CACHE,
    path.resolve(projectRoot, '.local-tools', 'electron-builder-cache'),
  ].filter(Boolean)

  return candidates.find((candidate) => hasNsisResources(candidate)) || candidates[0] || null
}

function ensureBuilderCacheDir() {
  const existing = resolveBuilderCacheDir()
  if (existing && hasNsisResources(existing)) {
    return existing
  }

  const setupResult = runNodeScript(setupNsisResourcesScript, [])
  if (setupResult.status !== 0) {
    process.exit(setupResult.status || 1)
  }

  const ready = resolveBuilderCacheDir()
  if (!ready || !hasNsisResources(ready)) {
    process.stderr.write('[package:win] NSIS resources cache is still unavailable after setup.\n')
    process.exit(1)
  }

  return ready
}

function createBuildEnv() {
  return {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_BUILDER_NSIS_DIR: ensureNsisDir(),
    ELECTRON_BUILDER_CACHE: ensureBuilderCacheDir(),
  }
}

function collectUnpackedExecutables() {
  const unpackedDir = path.resolve(releaseDir, 'win-unpacked')
  if (!fs.existsSync(unpackedDir)) return []
  const result = []
  const pending = [unpackedDir]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.resolve(current, entry.name)
      if (entry.isDirectory()) pending.push(target)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) result.push(target)
    }
  }
  return result.sort()
}

function collectReleaseExecutables() {
  if (!fs.existsSync(releaseDir)) {
    return []
  }

  return fs.readdirSync(releaseDir)
    .filter((file) => file.endsWith('.exe'))
    .map((file) => path.resolve(releaseDir, file))
}

function signFiles(files) {
  const targets = files.filter(Boolean).filter((file) => fs.existsSync(file))
  if (targets.length === 0) {
    process.stderr.write('[package:win] No Windows executables were found to sign.\n')
    process.exit(1)
  }

  const result = runNodeScript(signScript, targets)
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function cleanReleaseArtifacts() {
  if (!fs.existsSync(releaseDir)) {
    return
  }

  for (const entry of fs.readdirSync(releaseDir)) {
    const target = path.resolve(releaseDir, entry)

    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch (error) {
      process.stderr.write('[package:win] Failed to remove stale release artifact: ' + target + '\n')
      process.stderr.write(String(error && error.stack ? error.stack : error) + '\n')
      process.exit(1)
    }
  }
}

function validateSigningInputs() {
  const hasCertFile = Boolean(process.env.NOVELFORGE_WINDOWS_CERT_FILE)
  const hasCertSha1 = Boolean(process.env.NOVELFORGE_WINDOWS_CERT_SHA1)

  if (!hasCertFile && !hasCertSha1) {
    process.stderr.write('[package:win] Signed packaging requires NOVELFORGE_WINDOWS_CERT_FILE or NOVELFORGE_WINDOWS_CERT_SHA1.\n')
    process.exit(1)
  }
}

function buildUnsigned() {
  cleanReleaseArtifacts()
  const result = runBuilder(['--win'], createBuildEnv())
  process.exit(result.status ?? (result.error ? 1 : 0))
}

function buildSigned() {
  validateSigningInputs()
  cleanReleaseArtifacts()
  const env = createBuildEnv()

  let result = runBuilder(['--win', 'dir'], env)
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  signFiles(collectUnpackedExecutables())

  result = runBuilder(['--prepackaged', path.resolve(releaseDir, 'win-unpacked'), '--win', 'nsis', 'portable'], env)
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  signFiles(collectReleaseExecutables())
  process.exit(0)
}

ensureBuildIcons()
runTestPreflight()

if (signed) {
  buildSigned()
} else {
  buildUnsigned()
}
