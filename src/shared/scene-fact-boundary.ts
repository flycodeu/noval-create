/** Style examples are hints, never proofs of scene visibility. */
function usableNames(names: string[]): string[] { return names.map(name => name.trim()).filter(Boolean) }

/** Named paragraphs stay ahead of the others. Unnamed paragraphs are kept, then the list is capped. */
export function selectStyleParagraphs(paragraphs: string[], viewpointNames: string[], limit = 2): string[] {
  const names = usableNames(viewpointNames)
  const named: string[] = []
  const unnamed: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) continue
    if (names.some(name => paragraph.includes(name))) named.push(paragraph)
    else unnamed.push(paragraph)
  }
  return [...named, ...unnamed].slice(0, limit)
}
