const fs = require('node:fs')
const { spawnSync } = require('node:child_process')

const files = process.argv.slice(2)
const timestampUrl = process.env.NOVELFORGE_WINDOWS_TIMESTAMP_URL || 'http://timestamp.digicert.com'

function log(message) {
  process.stdout.write(`[sign:windows] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[sign:windows] ${message}\n`)
  process.exit(1)
}

function resolveSigntool() {
  const candidates = [
    process.env.NOVELFORGE_SIGNTOOL_PATH,
    'D:\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe',
    'D:\\Windows Kits\\10\\bin\\10.0.22000.0\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Microsoft SDKs\\ClickOnce\\SignTool\\signtool.exe',
    'D:\\Software\\Microsoft Visual Studio\\Shared\\NuGetPackages\\microsoft.windows.sdk.buildtools\\10.0.22621.756\\bin\\10.0.22621.0\\x64\\signtool.exe',
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function signFile(signtoolPath, filePath) {
  const certFile = process.env.NOVELFORGE_WINDOWS_CERT_FILE
  const certPassword = process.env.NOVELFORGE_WINDOWS_CERT_PASSWORD || ''
  const certSha1 = process.env.NOVELFORGE_WINDOWS_CERT_SHA1

  const args = ['sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', timestampUrl, '/d', 'NovelForge']

  if (certSha1) {
    args.push('/sha1', certSha1)
  } else if (certFile) {
    args.push('/f', certFile)
    if (certPassword) {
      args.push('/p', certPassword)
    }
  } else {
    fail('Missing NOVELFORGE_WINDOWS_CERT_FILE or NOVELFORGE_WINDOWS_CERT_SHA1.')
  }

  args.push(filePath)

  const result = spawnSync(signtoolPath, args, {
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
    fail(`Signing failed for ${filePath}`)
  }
}

function verifyFile(signtoolPath, filePath) {
  const result = spawnSync(signtoolPath, ['verify', '/pa', '/all', '/v', filePath], {
    encoding: 'utf8',
    shell: false,
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) fail(`Authenticode verification failed for ${filePath}`)
}

if (files.length === 0) {
  fail('Provide at least one file path to sign.')
}

const signtoolPath = resolveSigntool()
if (!signtoolPath) {
  fail('Unable to locate signtool.exe. Set NOVELFORGE_SIGNTOOL_PATH to continue.')
}

if (process.env.NOVELFORGE_WINDOWS_CERT_FILE && !fs.existsSync(process.env.NOVELFORGE_WINDOWS_CERT_FILE)) {
  fail(`Certificate file does not exist: ${process.env.NOVELFORGE_WINDOWS_CERT_FILE}`)
}

for (const file of files) {
  if (!fs.existsSync(file)) {
    fail(`File does not exist: ${file}`)
  }

  log(`Signing ${file} with ${signtoolPath}`)
  signFile(signtoolPath, file)
  log(`Verifying ${file}`)
  verifyFile(signtoolPath, file)
}
