import type { WebContents } from 'electron'

/**
 * 抽象进度/事件发送通道。
 *
 * Service 层只依赖该端口推送进度与状态事件，不再直接依赖 Electron
 * `WebContents`，从而可以被 IPC、本地 Web 后端、MCP 运行时和测试复用。
 * 任何实现都必须保证 send 永不抛错（UI 窗口可能在任何时刻销毁）。
 */
export interface ProgressSink {
  send(channel: string, payload: unknown): void
}

/**
 * 无操作实现：没有 UI 订阅者时（如后台 worker、测试）传入该实例，
 * 所有进度事件安全丢弃。
 */
export const noopProgressSink: ProgressSink = {
  send() {
    // 无订阅者：忽略进度事件。
  },
}

/**
 * 把 Electron WebContents 适配为 ProgressSink。
 * isDestroyed 检查放在适配器内，Service 层无需关心窗口生命周期。
 */
export function fromWebContents(sender: WebContents | undefined | null): ProgressSink | undefined {
  if (!sender) return undefined
  return {
    send(channel: string, payload: unknown) {
      try {
        if (!sender.isDestroyed()) {
          sender.send(channel, payload)
        }
      } catch {
        // 窗口在 isDestroyed 检查与 send 之间被销毁，安全忽略。
      }
    },
  }
}

/**
 * 兼容旧签名：接受 WebContents 或 ProgressSink，统一归一为 ProgressSink。
 * 用于迁移期把 `sender?: WebContents` 参数替换为 `sink?: ProgressSink`。
 */
export function toProgressSink(source: WebContents | ProgressSink | undefined | null): ProgressSink | undefined {
  if (!source) return undefined
  if (typeof (source as WebContents).isDestroyed === 'function') {
    return fromWebContents(source as WebContents)
  }
  return source as ProgressSink
}
