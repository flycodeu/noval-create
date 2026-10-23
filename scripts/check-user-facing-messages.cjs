const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'])
const hanPattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const messageMethods = new Set(['success', 'error', 'warning', 'info', 'loading', 'open'])
const notificationFields = new Set(['message', 'description'])

function isExpressionWrapper(node) {
  return node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node))
}

function unwrap(node) {
  while (isExpressionWrapper(node)) node = node.expression
  return node
}

function propertyName(node) {
  if (node && ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) return node.expression.text
  if (node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node))) return node.text
  return undefined
}

function expressionName(expression) {
  const node = unwrap(expression)
  if (!node) return undefined
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return propertyName(node.argumentExpression)
  return undefined
}

// Inspect value-producing syntax only. A formatter call is a boundary: its
// params may contain author content, labels or upstream text rather than an
// inline message. Its implementation is visited independently by the scanner.
function containsInlineHan(expression) {
  const node = unwrap(expression)
  if (!node) return false
  if (ts.isStringLiteralLike(node)) return hanPattern.test(node.text)
  if (ts.isTemplateExpression(node)) {
    return hanPattern.test(node.head.text) || node.templateSpans.some(span =>
      hanPattern.test(span.literal.text) || containsInlineHan(span.expression))
  }
  if (ts.isConditionalExpression(node)) {
    return containsInlineHan(node.whenTrue) || containsInlineHan(node.whenFalse)
  }
  if (ts.isBinaryExpression(node) && [
    ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.CommaToken,
  ].includes(node.operatorToken.kind)) {
    return containsInlineHan(node.left) || containsInlineHan(node.right)
  }
  return false
}

function isErrorName(name) {
  return Boolean(name && (name.endsWith('Error') || /^Error[A-Z]/.test(name)))
}

function directlyThrown(node) {
  let parent = node.parent
  while (isExpressionWrapper(parent)) {
    parent = parent.parent
  }
  return parent && ts.isThrowStatement(parent)
}

function inspect(filePath, text = fs.readFileSync(filePath, 'utf8')) {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
  const issues = []
  const receivers = new Map([['message', 'message'], ['notification', 'notification']])
  const errorClasses = new Set(['Error', 'SyntaxError', 'TypeError', 'RangeError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError'])
  const classes = []

  function collect(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'antd') {
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const original = element.propertyName?.text || element.name.text
          if (original === 'message' || original === 'notification') receivers.set(element.name.text, original)
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        const original = propertyName(element.propertyName) || propertyName(element.name)
        if ((original === 'message' || original === 'notification') && ts.isIdentifier(element.name)) {
          receivers.set(element.name.text, original)
        }
      }
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) classes.push(node)
    ts.forEachChild(node, collect)
  }
  collect(sourceFile)
  function extendsError(node) {
    return node.heritageClauses?.some(clause => clause.token === ts.SyntaxKind.ExtendsKeyword
      && clause.types.some(type => {
        const name = expressionName(type.expression)
        return isErrorName(name) || errorClasses.has(name)
      })) ?? false
  }
  // Resolve locally named intermediate subclasses without a type-checking
  // program or importing/evaluating application code.
  for (let pass = 0; pass < classes.length; pass += 1) {
    let changed = false
    for (const node of classes) {
      if (node.name && !errorClasses.has(node.name.text) && extendsError(node)) {
        errorClasses.add(node.name.text)
        changed = true
      }
    }
    if (!changed) break
  }

  function report(node, reason) {
    const start = node.getStart(sourceFile)
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)
    issues.push({
      filePath, line: line + 1, column: character + 1, start, reason,
      sample: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120),
    })
  }

  function checkValue(node, reason) {
    if (node && containsInlineHan(node)) report(node, reason)
  }

  function checkUiContent(expression, kind) {
    const node = unwrap(expression)
    if (!node) return
    if (kind === 'message' && containsInlineHan(node)) {
      report(node, 'literal message.* call')
      return
    }
    if (ts.isObjectLiteralExpression(node)) {
      const fields = kind === 'notification' ? notificationFields : new Set(['content'])
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && fields.has(propertyName(property.name))) {
          checkValue(property.initializer, `literal ${kind} field`)
        } else if (ts.isSpreadAssignment(property)) {
          checkUiContent(property.expression, kind)
        }
      }
    } else if (ts.isConditionalExpression(node)) {
      checkUiContent(node.whenTrue, kind)
      checkUiContent(node.whenFalse, kind)
    } else if (ts.isBinaryExpression(node) && [
      ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)) {
      checkUiContent(node.left, kind)
      checkUiContent(node.right, kind)
    }
  }

  function checkErrorArguments(node) {
    for (const argument of node.arguments || []) checkValue(argument, 'literal error message')
  }

  function visit(node) {
    if (ts.isNewExpression(node)) {
      const name = expressionName(node.expression)
      if (isErrorName(name) || errorClasses.has(name)) checkErrorArguments(node)
    } else if (ts.isCallExpression(node)) {
      const expression = unwrap(node.expression)
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
        const kind = receivers.get(expressionName(expression.expression))
        if (kind && messageMethods.has(expressionName(expression))) checkUiContent(node.arguments[0], kind)
      }
      if (expression.kind === ts.SyntaxKind.SuperKeyword) {
        let owner = node.parent
        while (owner && !ts.isClassDeclaration(owner) && !ts.isClassExpression(owner)) owner = owner.parent
        if (owner && extendsError(owner)) checkErrorArguments(node)
      } else if (directlyThrown(node) && (isErrorName(expressionName(expression)) || errorClasses.has(expressionName(expression)))) {
        checkErrorArguments(node)
      }
    } else if (ts.isThrowStatement(node)) {
      checkValue(node.expression, 'literal thrown message')
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return issues.sort((left, right) => left.start - right.start || left.reason.localeCompare(right.reason))
}

function scanWorkspace(workspaceRoot = root) {
  const issues = []
  function walk(directory) {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(filePath)
      else if (textExtensions.has(path.extname(entry.name).toLowerCase())) issues.push(...inspect(filePath))
    }
  }
  for (const directory of ['src', 'electron/services', 'electron/utils']) walk(path.join(workspaceRoot, directory))
  for (const name of ['electron/main.ts', 'electron/preload.ts']) {
    const filePath = path.join(workspaceRoot, name)
    if (fs.existsSync(filePath)) issues.push(...inspect(filePath))
  }
  return issues
}

function main() {
  const issues = scanWorkspace()
  if (!issues.length) {
    console.log('User-facing message check passed.')
    return
  }
  console.error(`User-facing message check failed (${issues.length}):`)
  for (const issue of issues) {
    console.error(`- ${path.relative(root, issue.filePath)}:${issue.line}:${issue.column} ${issue.reason} -> ${issue.sample}`)
  }
  process.exitCode = 1
}

module.exports = { inspect, scanWorkspace }
if (require.main === module) main()
