import { parseProjectBriefDocument, type ProjectBriefDocument } from '../../../shared/project-brief'
import { getUserFacingMessage } from '../../../utils/user-facing-message'

export function parseImportableProjectBriefDraft(output: string): Partial<ProjectBriefDocument> {
  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim())
  } catch {
    throw new Error(getUserFacingMessage('projectBrief.importInvalidJson'))
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(getUserFacingMessage('projectBrief.importObjectRequired'))
  }
  const document = parseProjectBriefDocument(output)
  const patch = Object.fromEntries(
    Object.entries(document).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
  ) as Partial<ProjectBriefDocument>
  if (Object.keys(patch).length === 0) {
    throw new Error(getUserFacingMessage('projectBrief.importNoFields'))
  }
  return patch
}

export function assertDraftContextCurrent(draftVersion: number, projectVersion: number): void {
  if (draftVersion !== projectVersion) {
    throw new Error(getUserFacingMessage('projectBrief.importContextStale'))
  }
}
