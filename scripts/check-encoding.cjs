const fs = require('fs')
const iconv = require('iconv-lite')
const path = require('path')

const root = path.resolve(__dirname, '..')
const scanDirs = ['src', 'electron', 'scripts']
const scanFiles = ['package.json', 'electron.vite.config.ts']
const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.md', '.cjs', '.mjs', '.yml', '.yaml'])
const issues = []
const replacementChar = String.fromCharCode(0xfffd)
const hanPattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const segmentPattern = /'(?<single>(?:\\.|[^'\\])*)'|"(?<double>(?:\\.|[^"\\])*)"|>(?<jsx>[^<>{\r\n]+)</g
const mojibakePatterns = [
  { label: 'question mark after non-ASCII text', pattern: /[\u0080-\uFFFF]\?(?=[`"'})\],:;])/u },
  { label: 'question mark before template interpolation', pattern: /[\u0080-\uFFFF]\?\{/u },
]

function recoverMojibake(text) {
  try {
    const recovered = iconv.decode(iconv.encode(text, 'gbk'), 'utf8').trim()
    if (recovered === text.trim()) return ''
    if (!recovered || recovered.includes(replacementChar)) return ''
    if (!hanPattern.test(recovered)) return ''
    return recovered
  } catch {
    return ''
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }

    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue
    }

    inspect(fullPath)
  }
}

function findMojibakePatterns(text) {
  return mojibakePatterns
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.label)
}
function containsPrivateUseCharacter(text) {
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)
    if (codePoint >= 0xe000 && codePoint <= 0xf8ff) {
      return true
    }
  }
  return false
}

function findRecoverableMojibake(text) {
  const hits = []

  for (const match of text.matchAll(segmentPattern)) {
    const value = match.groups?.single ?? match.groups?.double ?? match.groups?.jsx ?? ''
    const trimmed = value.trim()
    if (!trimmed || !/[^\u0000-\u007f]/.test(trimmed)) continue

    const recovered = recoverMojibake(value)
    if (!recovered) continue

    hits.push({
      original: trimmed.slice(0, 40),
      recovered: recovered.slice(0, 40),
    })
  }

  return hits
}

function inspect(filePath) {
  const relPath = path.relative(root, filePath)
  const raw = fs.readFileSync(filePath)
  const text = raw.toString('utf8')

  if (text.includes(replacementChar)) {
    issues.push(`${relPath}: contains replacement character U+FFFD`)
  }

  if (/\?{4,}/.test(text)) {
    issues.push(`${relPath}: contains suspicious repeated question marks`)
  }

  if (containsPrivateUseCharacter(text)) {
    issues.push(`${relPath}: contains private-use Unicode characters that often indicate mojibake`)
  }

  const mojibakeHits = findMojibakePatterns(text)
  if (mojibakeHits.length > 0) {
    issues.push(`${relPath}: contains suspicious mojibake fragments (${mojibakeHits.join(', ')})`)
  }

  const recoverableHits = findRecoverableMojibake(text)
  for (const hit of recoverableHits) {
    issues.push(`${relPath}: contains recoverable mojibake ("${hit.original}" -> "${hit.recovered}")`)
  }

  const utf8RoundTrip = Buffer.from(text, 'utf8')
  if (!raw.equals(utf8RoundTrip)) {
    issues.push(`${relPath}: is not valid UTF-8 text`)
  }
}

for (const dir of scanDirs) {
  walk(path.join(root, dir))
}

for (const file of scanFiles) {
  inspect(path.join(root, file))
}

if (issues.length > 0) {
  console.error('Encoding check failed:')
  for (const issue of issues) {
    console.error(`- ${issue}`)
  }
  process.exit(1)
}

console.log('Encoding check passed.')
