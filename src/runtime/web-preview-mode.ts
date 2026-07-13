export const WEB_DEMO_PREVIEW_STORAGE_KEY = 'novelforge.webPreview.demo'

/**
 * Demo data is an explicit preview mode only. Production web sessions must
 * never silently replace a real backend response with fabricated data.
 */
export function isWebDemoPreviewEnabled(search: string, storedFlag?: string | null): boolean {
  try {
    const queryFlag = new URLSearchParams(search).get('demo')
    return queryFlag === '1' || storedFlag === '1'
  } catch {
    return false
  }
}
