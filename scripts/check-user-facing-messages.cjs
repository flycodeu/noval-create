const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const scanRoots = [
  path.join(root, 'src'),
  path.join(root, 'electron', 'services'),
  path.join(root, 'electron', 'utils'),
]
const scanFiles = [
  path.join(root, 'electron', 'main.ts'),
  path.join(root, 'electron', 'preload.ts'),
]
const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'])
const issues = []
const hanPattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u

function walk(dir) {
  if (!fs.existsSync(dir)) return

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }

    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) continue
    inspect(fullPath)
  }
}

function getLineNumber(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function pushIssue(filePath, text, index, reason, sample) {
  const relPath = path.relative(root, filePath)
  const line = getLineNumber(text, index)
  issues.push(`${relPath}:${line} ${reason} -> ${sample.trim().slice(0, 80)}`)
}

function scanUiCalls(filePath, text) {
  const literalUiCall = /\bmessage\.(success|error|warning|info)\(\s*([`'"])([\s\S]*?)\2\s*\)/g
  for (const match of text.matchAll(literalUiCall)) {
    const content = match[3] || ''
    if (!hanPattern.test(content)) continue
    pushIssue(filePath, text, match.index || 0, 'literal message.* call', match[0])
  }

  const notificationBlock = /\bnotification\.(success|error|warning|info)\(\s*\{([\s\S]*?)\}\s*\)/g
  const notificationField = /\b(message|description)\s*:\s*([`'"])([\s\S]*?)\2/g
  for (const match of text.matchAll(notificationBlock)) {
    const block = match[2] || ''
    for (const fieldMatch of block.matchAll(notificationField)) {
      const content = fieldMatch[3] || ''
      if (!hanPattern.test(content)) continue
      pushIssue(filePath, text, (match.index || 0) + (fieldMatch.index || 0), 'literal notification field', fieldMatch[0])
    }
  }
}

function scanThrownErrors(filePath, text) {
  const literalThrow = /\bthrow\s+(?:new\s+)?Error\(\s*([`'"])([\s\S]*?)\1\s*\)/g
  for (const match of text.matchAll(literalThrow)) {
    const content = match[2] || ''
    if (!hanPattern.test(content)) continue
    if (content.includes('${')) continue
    pushIssue(filePath, text, match.index || 0, 'literal throw Error', match[0])
  }
}

function inspect(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  if (text.includes('user-message-check: ignore')) return

  scanUiCalls(filePath, text)
  scanThrownErrors(filePath, text)
}

for (const scanRoot of scanRoots) {
  walk(scanRoot)
}

for (const filePath of scanFiles) {
  if (fs.existsSync(filePath)) inspect(filePath)
}

if (issues.length > 0) {
  console.error('User-facing message check failed:')
  for (const issue of issues) {
    console.error(`- ${issue}`)
  }
  process.exit(1)
}

console.log('User-facing message check passed.')
