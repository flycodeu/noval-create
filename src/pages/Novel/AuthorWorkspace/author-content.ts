/** Presentation only: stored drafts, provenance and history remain intact. */
export const AUTHOR_PROCESS_FIELDS = new Set([
  'truthBoundary', 'revision', 'approvalSource', 'approvalMethod', 'approvedAt', 'profileDesignStatus',
])

export function authorFieldKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()).replace(/Json$/, '')
}

export function authorText(value: string): string {
  return value
    .replace(/【\d{4}-\d{2}-\d{2}[^【】\n]*[｜|]作者规划】/gu, '')
    .replaceAll('作者规划不是已发生剧情；既有summary和正文状态不变。未来相识、入场、履历与因果须随正文建立，不提前进入人物或读者知情。', '')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/gu, '\n\n')
    .trim()
}

export function authorValueLabel(value: unknown): unknown {
  return value === 'user_approved_author_design' || value === 'approved_design' ? '作者设定' : value
}
