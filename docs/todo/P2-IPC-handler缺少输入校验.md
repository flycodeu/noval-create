# P2 - IPC handler 缺少输入校验

> 优先级：P2（中等）
> 影响范围：数据完整性、调试体验
> 实现难度：中
> 类别：后端-主进程

---

## 问题

`main.ts` 中大量 `ipcMain.handle` 接收参数后直接传给 service 函数，没有类型校验。如果渲染进程因 bug 传入非法参数（如 `id` 为 undefined、`data` 为 null），会导致数据库错误或未定义行为，且错误信息不明确。

```typescript
ipcMain.handle('chapter:update', (_, id, data, options) => {
  // id, data, options 均未校验类型和合法性
  return chapterService.updateChapter(id, data, options)
})
```

## 原因

- `electron/main.ts` 各 IPC handler 缺少入口校验层
- Electron IPC 序列化可能丢失类型信息（如 `undefined` 变 `null`）

## 解决方式

1. 为关键 IPC handler 添加参数校验（至少校验必填字段存在且类型正确）
2. 校验失败时返回明确的错误信息而非 DB 层面的异常

## 是否解决

已解决

## 预期效果

- 非法 IPC 调用会得到明确的参数错误提示
- 减少因参数错误导致的难以排查的数据库异常
