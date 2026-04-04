# P2 - getChapter 双重查询冗余

> 优先级：P2（中等问题）
> 影响范围：数据库查询效率
> 实现难度：低

---

## 问题

`chapter.service.ts` 中 `getChapter()` 函数执行了两次完全相同的数据库查询：

```typescript
export function getChapter(id: number) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, id)).all()[0] || null
  if (!chapter) return null
  ensureStoryStructure(chapter.novelId)  // 可能创建分卷/分部
  return db.select().from(chapters).where(eq(chapters.id, id)).all()[0] || null  // ← 完全重复
}
```

第二次查询的目的可能是在 `ensureStoryStructure` 修改数据后重新获取最新状态，但 `ensureStoryStructure` 只操作 `storyVolumes`/`storyParts` 表，不会修改 `chapters` 表内容，因此第二次查询完全冗余。

在生成管线中 `getChapter` 被频繁调用（每章至少 3-5 次），批量生成 300 章会产生 600-1500 次无效查询。

## 原因

编码时可能想确保 `ensureStoryStructure` 的副作用被反映，但该函数不修改章节本身。

## 解决方式

直接返回第一次查询结果：

```typescript
export function getChapter(id: number) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, id)).all()[0] || null
  if (!chapter) return null
  ensureStoryStructure(chapter.novelId)
  return chapter
}
```

## 是否解决

已解决

## 预期效果

- 每次 `getChapter` 减少一次数据库查询
- 批量生成时累计减少数百到数千次无效查询
