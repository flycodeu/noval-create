export const DEEPSEEK_V4_MAX_OUTPUT_TOKENS = 384 * 1024

export function getProviderMaxOutputTokens(provider?: string | null): number {
  return (provider || '').trim().toLowerCase() === 'deepseek'
    ? DEEPSEEK_V4_MAX_OUTPUT_TOKENS
    : 1_000_000
}
