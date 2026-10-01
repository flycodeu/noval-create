import { parseProjectBriefDocument, type ProjectBriefDocument } from '../../../shared/project-brief'

export function parseImportableProjectBriefDraft(output: string): Partial<ProjectBriefDocument> {
  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim())
  } catch {
    throw new Error('导入内容不是有效 JSON，请先检查草稿。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('项目立项草稿必须是 JSON 对象。')
  }
  const document = parseProjectBriefDocument(output)
  const patch = Object.fromEntries(
    Object.entries(document).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
  ) as Partial<ProjectBriefDocument>
  if (Object.keys(patch).length === 0) {
    throw new Error('草稿没有可回填的项目立项字段。')
  }
  return patch
}

export function assertDraftContextCurrent(draftVersion: number, projectVersion: number): void {
  if (draftVersion !== projectVersion) {
    throw new Error('这份草稿基于旧版项目资料。请让 Codex 读取当前项目后重新导入，再回填。')
  }
}
