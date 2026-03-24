const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const scanDirs = ['src', 'electron', 'scripts']
const scanFiles = ['package.json', 'electron.vite.config.ts']
const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.md', '.cjs', '.mjs', '.yml', '.yaml'])
const issues = []
const replacementChar = String.fromCharCode(0xfffd)

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

function containsPrivateUseCharacter(text) {
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)
    if (codePoint >= 0xe000 && codePoint <= 0xf8ff) {
      return true
    }
  }
  return false
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
