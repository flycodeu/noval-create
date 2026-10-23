export interface RuntimeIdentity {
  environment: 'formal' | 'test'
  version: string
  source: 'installed' | 'source'
  dataDirectory: string
  executable: string
}
