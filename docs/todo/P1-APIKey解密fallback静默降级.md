# P1 - API Key 解密 fallback 静默降级

> 优先级：P1（严重）
> 影响范围：模型配置可靠性
> 实现难度：低
> 类别：后端-模型服务

---

## 问题

`decryptApiKey()` 在 `safeStorage` 解密失败时，静默 fall through 到 CryptoJS 解密。如果 key 是用 safeStorage 加密的格式，CryptoJS 解密会得到乱码而非报错，导致后续所有 AI 请求使用错误的 API key 并静默失败。

```typescript
export function decryptApiKey(encrypted: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      // 降级解密 — 无任何日志
    }
  }
  const bytes = CryptoJS.AES.decrypt(encrypted, MACHINE_SALT)
  return bytes.toString(CryptoJS.enc.Utf8)
}
```

## 原因

- `electron/services/model.service.ts:62-72` catch 块完全静默，无日志记录
- 没有区分加密格式（safeStorage vs CryptoJS），降级可能产生乱码而非空字符串
- CryptoJS 解密错误格式数据不一定抛异常，可能返回空字符串或乱码

## 解决方式

1. 在 catch 块中添加 `console.warn()` 日志，记录降级事件
2. CryptoJS 解密后检查结果是否为有效非空字符串
3. 如果两种方式都失败，返回明确的错误信息而非乱码

## 是否解决

已解决

## 预期效果

- 解密降级事件被记录到日志，便于排查
- 不会出现使用乱码 API key 发起请求的情况
- 解密完全失败时给出明确提示
