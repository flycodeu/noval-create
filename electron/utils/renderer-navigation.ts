/** Only ordinary web links may be handed to the operating system. */
export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch { return false }
}

/** The privileged preload must stay attached to the application's renderer. */
export function isTrustedRendererUrl(value: string, entry: string): boolean {
  try {
    const url = new URL(value), trusted = new URL(entry)
    if (trusted.protocol === 'file:') {
      return url.protocol === 'file:' && url.host === trusted.host && url.pathname === trusted.pathname
    }
    return ['http:', 'https:'].includes(trusted.protocol) && url.origin === trusted.origin
  } catch { return false }
}
