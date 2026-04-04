# P3 - 场景计划JSON解析失败时直接中止生成

> 优先级：P3（改进项）
> 影响范围：生成管线容错性
> 实现难度：低

---

## 问题

`generateChapterContent()` 在场景规划阶段，如果 AI 返回的 JSON 解析失败，会直接 `throw` 中止整个生成流程：

```typescript
const scenePlanParse = parseAiJsonResult<unknown>(scenePlanResult, 'array', {...})
if (!scenePlanParse.success) {
  throw scenePlanParse.error || new Error('章节场景规划 JSON 解析失败')
}
```

但代码中已有 `buildFallbackScenePlan()` 作为后备方案。在 JSON 解析失败时，完全可以降级使用后备场景计划继续生成，而不是中断整条管线。

## 原因

编码时可能认为解析失败意味着模型输出质量太差，不值得继续。但实际上很多中文模型偶尔会在 JSON 外包裹解释文字（如 "以下是场景计划："），导致格式问题但内容可用。

## 解决方式

在场景计划解析失败时，使用 fallback 而非中止，并保留日志：

```typescript
let scenePlan: ScenePlanStep[]
if (scenePlanParse.success) {
  scenePlan = normalizeScenePlan(scenePlanParse.data, fallbackScenePlan)
} else {
  scenePlan = fallbackScenePlan
  // 可选：记录降级日志
}
```

同样逻辑也适用于审校阶段：

- `scenePlanParse.success === false` 时，回退到 `buildFallbackScenePlan()`
- `reviewParse.success === false` 时，保留 `buildFallbackReviewNotes()` 并继续 rewrite
- `parseAiJsonResult()` 的运行时日志继续保留，但不再把整章任务判成失败

## 是否解决

已解决

## 预期效果

- 场景规划 JSON 解析偶尔失败不再中断整章生成
- 降级使用 fallback 继续完成生成管线
- 审校 JSON 的格式异常也不会把整条章节流水线硬中止
