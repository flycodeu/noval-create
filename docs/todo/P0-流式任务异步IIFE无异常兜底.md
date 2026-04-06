# P0 - 流式任务异步IIFE无异常兜底

> 优先级：P0（致命）
> 影响范围：Electron 主进程稳定性
> 实现难度：低
> 类别：后端-任务系统

---

## 问题

`runStreamTask()` 的核心逻辑包裹在一个异步 IIFE `(async () => { ... })()` 中，该 IIFE 没有 `.catch()` 处理器。虽然内部有 `try/catch/finally`，但如果 `finally` 块中的 `stopHeartbeat()`、`release()` 或 `abortControllers.delete()` 本身抛出异常，会产生 **unhandled promise rejection**，可能导致 Electron 主进程崩溃。

```typescript
;(async () => {
  try { ... }
  catch { ... }
  finally {
    stopHeartbeat()   // 可能抛异常
    release()         // 可能抛异常
    abortControllers.delete(taskId)
  }
})()  // 无 .catch()
```

## 原因

- `electron/services/task.service.ts:725-787` 异步 IIFE 未添加 `.catch()` 兜底
- `runStreamTask()` 是 fire-and-forget 模式，返回 taskId 后不等待 Promise 完成
- Node.js/Electron 对 unhandled rejection 的默认行为是终止进程

## 解决方式

1. 在 IIFE 末尾添加 `.catch()` 处理器，记录错误日志
2. 确保即使 finally 块异常也不会导致进程崩溃

## 是否解决

已解决

## 预期效果

- 任何异常路径都不会产生 unhandled promise rejection
- 主进程在任务异常时保持稳定运行
- 错误信息被记录到控制台，便于排查
