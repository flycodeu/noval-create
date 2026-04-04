# P2 - JSON解析静默失败丢失数据

> 优先级：P2（中等）
> 影响范围：AI返回结果静默降级
> 实现难度：低
> 类别：后端-错误处理

---

## 问题

`safeParseJson()` 在解析失败时静默返回 `{}`，不记录日志也不通知用户。当AI返回格式异常的JSON时（多余逗号、未闭合引号），系统使用默认值继续运行，**用户不知道昂贵的API调用结果被丢弃**。

例如 `chapter.service.ts:982`：
```typescript
scenePlan = normalizeScenePlan(safeParseJson<unknown>(scenePlanResult), fallbackScenePlan)
```
解析失败时场景计划使用fallback，AI生成的场景计划被静默丢弃。

## 原因

- `electron/utils/json.ts` 的 `safeParseJson()` 无日志输出
- 调用方无法区分"成功解析为空对象"和"解析失败"
- 缺少用户可见的警告通知
- AI输出格式不稳定（尤其是国产模型），JSON解析失败概率不低

## 解决方式

1. **添加解析失败日志**：记录失败的原始文本（前500字符）和错误原因
2. **返回解析状态**：`safeParseJson()` 改为返回 `{ data, success, error }` 三元组
3. **用户通知**：解析失败时在UI显示警告，允许用户查看原始输出并手动修复
4. **自动修复尝试**：在返回空对象前，尝试修复常见JSON格式错误（尾逗号、未闭合引号）

## 是否解决

已解决

## 预期效果

- 所有JSON解析失败有迹可查
- 用户知道哪些API调用结果被丢弃
- 可修复的格式错误自动修复
