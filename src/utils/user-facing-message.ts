import {
  formatUserFacingMessage,
  type UserFacingMessageKey,
  type UserFacingMessageParams,
} from '../shared/user-facing-messages'

export function getUserFacingMessage(
  key: UserFacingMessageKey,
  params: UserFacingMessageParams = {},
) {
  return formatUserFacingMessage(key, params)
}

export function getErrorMessage(
  error: unknown,
  fallbackKey: UserFacingMessageKey,
  params: UserFacingMessageParams = {},
) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return formatUserFacingMessage(fallbackKey, params)
}

export function isUserFacingMessage(
  error: unknown,
  key: UserFacingMessageKey,
  params: UserFacingMessageParams = {},
) {
  return error instanceof Error && error.message === formatUserFacingMessage(key, params)
}
