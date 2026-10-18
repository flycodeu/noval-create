const assert = require('node:assert/strict')
const { test } = require('node:test')
const { inspect } = require('./check-user-facing-messages.cjs')

function check(text, filePath = 'fixture.tsx') {
  return inspect(filePath, text)
}

test('finds Chinese message literals, dynamic templates and inline fallbacks', () => {
  const issues = check([
    "message.success('已保存')",
    'message.error(`失败：${error.message}`)',
    "message.warning(flag ? '缺少标题' : '缺少正文')",
    "message.info(error.message || '加载失败')",
    'message.success(`${flag ? `已完成${count}` : "失败"}`)',
    "message.error({ content: '连接失败', duration: 5 })",
    "message['loading']('正在保存')",
  ].join('\n'))
  assert.equal(issues.length, 7)
  assert.ok(issues.every(issue => issue.reason.startsWith('literal message')))
  assert.deepEqual(issues.map(issue => issue.line), [1, 2, 3, 4, 5, 6, 7])
})

test('finds notification fields without confusing nested objects or other config text', () => {
  const issues = check([
    "notification.error({ message: '保存失败', description: `请检查${field}`, style: { content: '样式注释' } })",
    "notification.open(flag ? { message: '完成' } : { description: error.message ?? '网络错误' })",
    "notification.info({ className: '样式名称', duration: 3 })",
  ].join('\n'))
  assert.equal(issues.length, 4)
  assert.ok(issues.every(issue => issue.reason === 'literal notification field'))
})

test('checks Error options, SyntaxError, code-first custom errors and error subclass super', () => {
  const issues = check([
    "throw new Error('保存失败', { cause })",
    "const failure = new SyntaxError(`解析${field}失败`)",
    "throw new LedgerError('INVALID', '账本内容无效', { cause })",
    "throw Error('执行失败')",
    "throw new Errors.ErrorName('输入无效')",
    "class Failure extends Error { constructor() { super('后台已关闭') } }",
    "class DerivedFailure extends Failure { constructor() { super('服务已停止') } }",
    "throw '非法抛出'",
  ].join('\n'))
  assert.equal(issues.length, 8)
  assert.deepEqual(issues.map(issue => issue.line), [1, 2, 3, 4, 5, 6, 7, 8])
})

test('keeps centralized formatters, English errors and parameter content out of reports', () => {
  assert.deepEqual(check([
    "message.error(getErrorMessage(error, 'common.executionFailed'))",
    "message.success(getUserFacingMessage('task.completed', { title: '作者输入的标题' }))",
    "notification.info({ message: formatUserFacingMessage('notice.title'), description: report.summary })",
    "throw new Error(formatUserFacingMessage('common.invalidParameter', { parameter: '章节' }), { cause })",
    "throw new SyntaxError('Invalid JSON')",
    "class Invalid extends Error { constructor() { super(formatUserFacingMessage('common.invalid')) } }",
    "throwUserFacingError('common.invalid')",
  ].join('\n')), [])
})

test('does not scan comments, prompt strings, logs, JSX text or ordinary super calls', () => {
  assert.deepEqual(check([
    '// message.error("不是消息")',
    '/* throw new Error("不是错误") */',
    'const prompt = `请在输出中使用 message.error("中文说明")`',
    'console.error("保存失败")',
    'const view = <p>保存失败的帮助说明</p>',
    'class Panel extends Component { constructor() { super("正常标题") } }',
    'const messages = { error: "业务字段" }',
  ].join('\n')), [])
})

test('does not let quotes or regular expressions make one call consume later source', () => {
  const text = [
    "message.error(error.message || 'Could not save')",
    "const heading = '中文标题'",
    'const pattern = /throw new Error\("中文不是错误"\)/',
    'const copy = "说明中的 message.info(不是调用)"',
    "message.error('确实失败')",
  ].join('\n')
  const issues = check(text)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].line, 5)
  assert.equal(issues[0].sample, "'确实失败'")
})

test('reports precise one-based line and column positions including CRLF', () => {
  const text = "const a = 1\r\n  message.error('错误')\r\n"
  const [issue] = check(text, 'positions.ts')
  assert.equal(issue.filePath, 'positions.ts')
  assert.equal(issue.line, 2)
  assert.equal(issue.column, 17)
  assert.equal(text.slice(issue.start, issue.start + 4), "'错误'")
})

test('recognizes Ant Design import aliases, destructured APIs and bracket access', () => {
  const issues = check([
    "import { message as toast, notification as notice } from 'antd'",
    "toast.error('保存失败')",
    "notice['warning']({ message: '缺少设置' })",
    'const { message: messageApi, notification: notificationApi } = App.useApp()',
    "messageApi.success('已完成')",
    "notificationApi.info({ description: '请重试' })",
  ].join('\n'))
  assert.equal(issues.length, 4)
})

test('an ignore-looking comment cannot disable reporting and test files are still checked', () => {
  const issues = check('// user-message-check: ignore\nthrow new Error("测试内也要集中消息")', 'fixture.test.ts')
  assert.equal(issues.length, 1)
  assert.equal(issues[0].line, 2)
})

test('checks wrapped thrown calls, escaped Chinese and nested notification config expressions', () => {
  const issues = check([
    'throw ((Error("\\u4fdd\\u5b58\\u5931\\u8d25", { cause })) as Error)',
    'notification.info(flag && { ["message"]: "正在读取", ...{ description: "稍后重试" } })',
    'message.error(flag && { content: "请求失败" })',
  ].join('\n'))
  assert.equal(issues.length, 4)
  assert.deepEqual(issues.map(issue => issue.line), [1, 2, 2, 3])
})
