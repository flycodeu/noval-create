/**
 * 写作页 JSON 解析统一入口。
 *
 * 约定：
 * - 空输入（undefined / null / ''）视为“还没有数据”，直接返回 fallback，不告警。
 * - JSON.parse 失败视为数据损坏：console.warn 一次（带解析器名），返回 fallback，
 *   避免以前 try/catch 静默吞掉后排查困难。
 * - validate 返回 null 表示结构不符合预期，按原行为返回 fallback（不告警，
 *   因为多数字段允许历史数据缺省）。
 */

const warnedParsers = new Set<string>()

function warnOnce(parserName: string, error: unknown) {
  if (warnedParsers.has(parserName)) return
  warnedParsers.add(parserName)
  console.warn(`[writing-parsers] ${parserName} 解析失败，已回退默认值`, error)
}

/** 仅供测试重置“每个解析器只告警一次”的记录。 */
export function resetSafeParseWarnings() {
  warnedParsers.clear()
}

export function safeParse<T>(
  parserName: string,
  raw: string | null | undefined,
  validate: (parsed: unknown) => T | null,
  fallback: T,
): T {
  if (raw === null || raw === undefined || raw === '') return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    warnOnce(parserName, error)
    return fallback
  }
  try {
    const validated = validate(parsed)
    return validated === null ? fallback : validated
  } catch (error) {
    warnOnce(parserName, error)
    return fallback
  }
}
