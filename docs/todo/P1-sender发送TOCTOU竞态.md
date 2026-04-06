# P1 - sender发送TOCTOU竞态

> 优先级：P1（严重）
> 影响范围：流式任务稳定性
> 实现难度：低
> 类别：后端-IPC通信

---

## 问题

在 `notifyStatus()`、`notifyProgress()`、`notifyComplete()` 以及 `runStreamTask()` 的 `onStream` 回调中，先检查 `sender.isDestroyed()` 再调用 `sender.send()`，存在 TOCTOU（Time-of-Check to Time-of-Use）竞态条件。窗口可能在检查和发送之间被销毁，导致抛出异常。

```typescript
if (opts.sender && !opts.sender.isDestroyed()) {
  opts.sender.send('task:stream-chunk', { taskId, chunk })
  // ↑ 窗口可能在 isDestroyed 返回 false 之后、send 执行之前被销毁
}
```

## 原因

- `electron/services/task.service.ts:670-672` notifyStatus
- `electron/services/task.service.ts:676-678` notifyProgress
- `electron/services/task.service.ts:685-687` notifyComplete
- `electron/services/task.service.ts:741-743` onStream 回调
- Electron 的 `WebContents.isDestroyed()` 和 `WebContents.send()` 之间没有原子性保证

## 解决方式

1. 抽取统一的 `safeSend()` 辅助函数，内部用 try-catch 包裹
2. 将所有 `sender.send()` 调用替换为 `safeSend()`
3. catch 块中静默忽略窗口已销毁的异常

## 是否解决

已解决

## 预期效果

- 用户在生成过程中关闭窗口不会导致主进程报错
- 所有 IPC 通知发送都具备容错能力
