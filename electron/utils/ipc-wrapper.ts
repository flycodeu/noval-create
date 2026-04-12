import { app, type IpcMainInvokeEvent } from 'electron'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { UserFacingError } from './user-facing-error'

export interface IpcSerializedError {
  code: string
  message: string
  detail?: string
}

export type IpcInvokeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcSerializedError }

type IpcHandler<TArgs extends unknown[] = unknown[], TResult = unknown> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => TResult | Promise<TResult>

function shouldExposeDetail() {
  return !app.isPackaged || process.env.NODE_ENV === 'development'
}

function serializeIpcError(name: string, error: unknown): IpcSerializedError {
  console.error(`[ipc:${name}]`, error)

  if (error instanceof UserFacingError) {
    return {
      code: error.code,
      message: error.message,
      detail: shouldExposeDetail()
        ? (error.cause instanceof Error ? error.cause.stack || error.cause.message : undefined)
        : undefined,
    }
  }

  if (error instanceof Error) {
    return {
      code: 'common.executionFailed',
      message: formatUserFacingMessage('common.executionFailed'),
      detail: shouldExposeDetail() ? (error.stack || error.message) : undefined,
    }
  }

  return {
    code: 'common.executionFailed',
    message: formatUserFacingMessage('common.executionFailed'),
    detail: shouldExposeDetail() ? String(error) : undefined,
  }
}

export function wrapIpcHandler<TArgs extends unknown[], TResult>(
  name: string,
  handler: IpcHandler<TArgs, TResult>,
) {
  return async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<IpcInvokeResult<TResult>> => {
    try {
      return {
        ok: true,
        data: await handler(event, ...args),
      }
    } catch (error) {
      return {
        ok: false,
        error: serializeIpcError(name, error),
      }
    }
  }
}
