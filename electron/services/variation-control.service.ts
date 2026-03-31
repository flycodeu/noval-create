import type { Message } from '../adapters/base.adapter'

interface VariationMessageOptions {
  attemptNumber: number
  candidateIndex?: number
  totalCandidates?: number
  rejectedDigests?: string[]
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function tokenize(value: string): string[] {
  const normalized = normalizeWhitespace(value).toLowerCase()
  const matches = normalized.match(/[\u4e00-\u9fff]|[a-z0-9]+/g)
  return matches ? matches.filter(Boolean) : []
}

function buildBigrams(tokens: string[]): Set<string> {
  if (tokens.length <= 1) return new Set(tokens)
  const values = new Set<string>()
  for (let index = 0; index < tokens.length - 1; index += 1) {
    values.add(`${tokens[index]}::${tokens[index + 1]}`)
  }
  return values
}

function summarizeRejectedDigest(value: string, maxLength = 140): string {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

export function buildVariationDigest(value: string, maxLength = 180): string {
  return summarizeRejectedDigest(value, maxLength)
}

export function computeCandidateSimilarity(left: string, right: string): number {
  const leftNormalized = normalizeWhitespace(left)
  const rightNormalized = normalizeWhitespace(right)
  if (!leftNormalized || !rightNormalized) return 0
  if (leftNormalized === rightNormalized) return 1

  const leftTokens = buildBigrams(tokenize(leftNormalized))
  const rightTokens = buildBigrams(tokenize(rightNormalized))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0

  let overlap = 0
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1
  })

  return (2 * overlap) / (leftTokens.size + rightTokens.size)
}

export function isCandidateTooSimilar(
  candidate: string,
  existingCandidates: string[],
  threshold = 0.72,
): boolean {
  return existingCandidates.some((existing) => computeCandidateSimilarity(candidate, existing) >= threshold)
}

export function buildVariationMessage({
  attemptNumber,
  candidateIndex,
  totalCandidates,
  rejectedDigests = [],
}: VariationMessageOptions): string {
  if (attemptNumber <= 1 && rejectedDigests.length === 0) return ''

  const lines = [
    `This is attempt ${attemptNumber}.`,
    candidateIndex && totalCandidates
      ? `Generate candidate ${candidateIndex} of ${totalCandidates}.`
      : 'The new output must be meaningfully different from prior attempts.',
    'Keep the same task facts, schema, and output format requirements, but change the angle, structure, emphasis, or expression.',
    'Do not only swap a few words, lightly rename items, or restate the same information.',
    'If the original task requires JSON, return JSON only. If it requires plain text, return plain text only.',
  ]

  if (rejectedDigests.length > 0) {
    lines.push('Avoid these previously rejected directions because they were too similar or unusable:')
    rejectedDigests.slice(0, 3).forEach((digest, index) => {
      lines.push(`${index + 1}. ${summarizeRejectedDigest(digest)}`)
    })
  }

  return lines.join('\n')
}

export function appendVariationMessage(
  messages: Message[],
  options: VariationMessageOptions,
): Message[] {
  const instruction = buildVariationMessage(options)
  if (!instruction) return messages
  return [
    ...messages,
    { role: 'user', content: instruction },
  ]
}
