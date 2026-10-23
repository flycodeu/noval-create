import { AUTHOR_USER_FACING_MESSAGES } from './user-facing-messages.author'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { formatUserFacingMessage, USER_FACING_MESSAGES, type UserFacingMessageKey, type UserFacingMessageParams } from './user-facing-messages'
import { RUNTIME_USER_FACING_MESSAGES } from './user-facing-messages.runtime'
import { USER_FACING_SERVICE_MESSAGES } from './user-facing-messages.services'
import { WORKSPACE_USER_FACING_MESSAGES } from './user-facing-messages.workspace'

function catalogShape(fileName: string, variableName: string) {
  const filePath = path.join(__dirname, fileName)
  const source = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true)
  const declarations: ts.VariableDeclaration[] = []
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) declarations.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(declarations, variableName).toHaveLength(1)
  let initializer = declarations[0].initializer
  while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
    initializer = initializer.expression
  }
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) throw new Error('Catalog must be a constant object')
  const keys: string[] = []
  const spreads: string[] = []
  for (const property of initializer.properties) {
    if (ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression)) {
      spreads.push(property.expression.text)
    } else if (ts.isPropertyAssignment(property) && (ts.isStringLiteralLike(property.name) || ts.isIdentifier(property.name))) {
      keys.push(property.name.text)
    } else throw new Error('Catalog entries must have static keys')
  }
  return { keys, spreads }
}

describe('integrated user-facing message catalog', () => {
  it('registers every original and added key exactly once without spread overrides', () => {
    const main = catalogShape('user-facing-messages.ts', 'USER_FACING_MESSAGES')
    const additions = [
      ['user-facing-messages.author.ts', 'AUTHOR_USER_FACING_MESSAGES', AUTHOR_USER_FACING_MESSAGES],
      ['user-facing-messages.runtime.ts', 'RUNTIME_USER_FACING_MESSAGES', RUNTIME_USER_FACING_MESSAGES],
      ['user-facing-messages.services.ts', 'USER_FACING_SERVICE_MESSAGES', USER_FACING_SERVICE_MESSAGES],
      ['user-facing-messages.workspace.ts', 'WORKSPACE_USER_FACING_MESSAGES', WORKSPACE_USER_FACING_MESSAGES],
    ] as const
    expect([...main.spreads].sort()).toEqual(additions.map(([, name]) => name).sort())
    const declaredKeys = [...main.keys]
    for (const [fileName, variableName, catalog] of additions) {
      const shape = catalogShape(fileName, variableName)
      expect(shape.spreads, variableName).toEqual([])
      expect([...shape.keys].sort(), variableName).toEqual(Object.keys(catalog).sort())
      declaredKeys.push(...shape.keys)
      for (const [key, value] of Object.entries(catalog)) {
        expect(USER_FACING_MESSAGES[key as UserFacingMessageKey], key).toBe(value)
      }
    }
    const counts = new Map<string, number>()
    for (const key of declaredKeys) counts.set(key, (counts.get(key) || 0) + 1)
    expect([...counts].filter(([, count]) => count > 1)).toEqual([])
    expect(Object.keys(USER_FACING_MESSAGES).sort()).toEqual([...declaredKeys].sort())
  })

  it('replaces every declared placeholder without losing template text or interpreting replacement tokens', () => {
    for (const [key, template] of Object.entries(USER_FACING_MESSAGES)) {
      const parts = template.split(/(\{\{\w+\}\})/g)
      const params: UserFacingMessageParams = {}
      for (let index = 1; index < parts.length; index += 2) {
        const name = parts[index].slice(2, -2)
        params[name] = `__sentinel_${name}_$&$$__`
      }
      const expected = parts.map((part, index) => index % 2 ? params[part.slice(2, -2)] : part).join('')
      const actual = formatUserFacingMessage(key as UserFacingMessageKey, params)
      expect(actual, key).toBe(expected)
      expect(actual, key).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it.each([
    [0, '0'],
    [-2.5, '-2.5'],
    [true, 'true'],
    [false, 'false'],
    [null, ''],
    [undefined, ''],
  ] as const)('preserves primitive replacement semantics for %s', (value, expected) => {
    expect(formatUserFacingMessage('model.defaultSet', { name: value })).toBe(`已将「${expected}」设为默认模型`)
  })

  it('retains the existing tolerant behavior for omitted and additional params', () => {
    expect(formatUserFacingMessage('model.defaultSet')).toBe('已将「」设为默认模型')
    expect(formatUserFacingMessage('model.saved', { ignored: 'unused' })).toBe('已保存')
  })

  it('does not expand placeholder-looking text inside a dynamic value a second time', () => {
    const destination = 'D:\\作品\\{{foo}} {{path}} $& $$.docx'
    expect(formatUserFacingMessage('novel.exportedTo', { path: destination, foo: 'must-not-replace' }))
      .toBe(`已导出到 ${destination}`)
  })
})
