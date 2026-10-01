import { describe, expect, it } from 'vitest'
import { isExternalImportedDraft } from './imported-drafts'

describe('external imported drafts', () => {
  it('shows API client drafts without mixing in internal model drafts', () => {
    expect(isExternalImportedDraft({ kind: 'generic_draft', producerType: 'api_client' })).toBe(true)
    expect(isExternalImportedDraft({ kind: 'generic_draft', producerType: 'novelforge_model' })).toBe(false)
    expect(isExternalImportedDraft({ kind: 'generic_draft', producerType: 'human' })).toBe(false)
    expect(isExternalImportedDraft({ kind: 'quality_report', producerType: 'api_client' })).toBe(false)
  })
})
