# P3 - 章节复杂度分类仅依赖 emotionTone 文本匹配

> 优先级：P3（改进项）
> 影响范围：章节分类准确度
> 实现难度：低

---

## 问题

`classifyChapterComplexity()` 只通过 `emotionTone` 字段的关键词匹配来判断章节复杂度：

```typescript
function classifyChapterComplexity(chapter): ChapterComplexity {
  const emotionTone = (chapter.emotionTone || '').toLowerCase()
  if (emotionTone.includes('高潮') || ...) return 'key'
  if ((emotionTone.includes('过渡') || ...) && outline.length < 200) return 'simple'
  return 'standard'
}
```

存在以下问题：

1. **emotionTone 可能未填写**：用户不一定为每章设置情绪基调，此时所有章节都被分类为 `standard`，失去了 prompt 分层的意义
2. **缺少结构性信号**：章节是否涉及多角色、是否是故事弧的检查点、是否有大量支线交叉等结构性信号未被考虑
3. **大纲长度 < 200 字作为 simple 条件过于粗糙**：一个 150 字的大纲可能描述了复杂的转折

## 原因

初始实现采用最简策略，后续未迭代。

## 解决方式

扩展分类逻辑，综合考虑：
- `emotionTone` 关键词（现有逻辑保留）
- 故事弧检查点位置（25%/50%/75% 自动标记为 key）
- 大纲中提及的角色数量（>3 个提升复杂度）
- 章节号位置（第1章、最后一章自动标为 key）
- 活跃支线数量
- 当前故事弧的收束章节也自动按关键章节处理

## 是否解决

已解决

## 预期效果

- 章节分类更准确，不再完全依赖用户手动标注
- 关键章节自动获得更丰富的上下文和更严格的审校
