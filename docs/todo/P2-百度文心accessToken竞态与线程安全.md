# P2 - 百度文心 accessToken 竞态与线程安全

> 优先级：P2（中等问题）
> 影响范围：百度文心模型在并发场景下的可靠性
> 实现难度：低

---

## 问题

`BaiduAdapter.getAccessToken()` 在 token 过期时发起网络请求获取新 token。如果多个并发请求同时发现 token 过期，会触发多次重复的 token 获取请求，造成：

1. 多次不必要的网络请求
2. 竞态条件：后完成的请求可能覆盖先完成的 token
3. 中间请求可能使用已被替换的 token

```typescript
private async getAccessToken(): Promise<string> {
  if (this.accessToken && Date.now() < this.tokenExpiry) {
    return this.accessToken  // ← 多个并发请求同时通过这个检查
  }
  // ← 多个请求同时发起 token 获取
  const response = await fetch(...)
  this.accessToken = data.access_token  // ← 竞态写入
  ...
}
```

## 原因

缺少 token 刷新的并发控制（锁或 Promise 去重）。

## 解决方式

已改为 Promise 去重模式，并把 token 刷新独立成共享刷新流程：

```typescript
private tokenRefreshPromise: Promise<string> | null = null

private async getAccessToken(): Promise<string> {
  if (this.accessToken && Date.now() < this.tokenExpiry) {
    return this.accessToken
  }
  if (this.tokenRefreshPromise) {
    return this.tokenRefreshPromise
  }
  this.tokenRefreshPromise = this.refreshToken()
  try {
    return await this.tokenRefreshPromise
  } finally {
    this.tokenRefreshPromise = null
  }
}
```

## 是否解决

已解决

## 预期效果

- 并发请求共享同一次 token 刷新，不再重复获取
- 消除竞态条件风险
- 刷新失败后共享 Promise 会被清空，后续请求可以继续触发新的刷新
