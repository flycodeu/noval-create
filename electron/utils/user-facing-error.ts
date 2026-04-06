import {
  formatUserFacingMessage,
  type UserFacingMessageKey,
  type UserFacingMessageParams,
} from '../../src/shared/user-facing-messages'

interface UserFacingErrorOptions {
  code?: string
  cause?: unknown
}

export class UserFacingError extends Error {
  readonly code: string
  readonly messageKey: UserFacingMessageKey
  readonly params: UserFacingMessageParams
  override readonly cause?: unknown

  constructor(
    messageKey: UserFacingMessageKey,
    params: UserFacingMessageParams = {},
    options: UserFacingErrorOptions = {},
  ) {
    super(formatUserFacingMessage(messageKey, params))
    this.name = 'UserFacingError'
    this.code = options.code || messageKey
    this.messageKey = messageKey
    this.params = params
    this.cause = options.cause
  }
}

export function createUserFacingError(
  messageKey: UserFacingMessageKey,
  params: UserFacingMessageParams = {},
  options: UserFacingErrorOptions = {},
) {
  return new UserFacingError(messageKey, params, options)
}

export function throwUserFacingError(
  messageKey: UserFacingMessageKey,
  params: UserFacingMessageParams = {},
  options: UserFacingErrorOptions = {},
): never {
  throw createUserFacingError(messageKey, params, options)
}
