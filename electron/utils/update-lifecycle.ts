import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getSingleWriterLockPath } from './single-writer-lock'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'

const execFileAsync = promisify(execFile)

export const UPDATE_MAINTENANCE_TTL_MS = 10 * 60_000
const MARKER_FILE = 'novelforge-update.json'
interface UpdateMarker { id: string; version: string; expiresAt: number }
export interface UpdateMaintenance { release(): void }

export class UpdateInProgressError extends Error {
  readonly code = 'UPDATE_IN_PROGRESS'
  constructor() {
    super(formatUserFacingMessage('update.inProgress'))
    this.name = 'UpdateInProgressError'
  }
}

function readMarker(directory: string): UpdateMarker | null {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(directory, MARKER_FILE), 'utf8')) as UpdateMarker
    return typeof marker.id === 'string' && typeof marker.version === 'string' && Number.isFinite(marker.expiresAt) ? marker : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

/** Block only the outgoing version, without preventing the newly installed app from opening. */
export function assertNotUpdating(directory: string, version: string): void {
  const marker = readMarker(directory)
  const remaining = marker ? marker.expiresAt - Date.now() : 0
  if (marker?.version === version && remaining > 0 && remaining <= UPDATE_MAINTENANCE_TTL_MS) throw new UpdateInProgressError()
}

export function beginUpdateMaintenance(directory: string, version: string): UpdateMaintenance {
  assertNotUpdating(directory, version)
  const marker: UpdateMarker = { id: randomUUID(), version, expiresAt: Date.now() + UPDATE_MAINTENANCE_TTL_MS }
  fs.mkdirSync(directory, { recursive: true })
  const target = path.join(directory, MARKER_FILE)
  const temporary = `${target}.${marker.id}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(marker), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return {
    release() {
      if (readMarker(directory)?.id !== marker.id) return
      try { fs.unlinkSync(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    },
  }
}

export function assertUpdateStorageReleased(directory: string): void {
  if (fs.existsSync(getSingleWriterLockPath(directory))) {
    throw new Error(formatUserFacingMessage('update.storageNotReleased'))
  }
}

/** Only observe bridges using this installed executable; never terminate other processes. */
export async function waitForMcpBridgesToExit(executablePath: string, timeoutMs = 10_000): Promise<void> {
  if (process.platform !== 'win32') return
  const deadline = Date.now() + timeoutMs
  const script = "$ids = @(Get-CimInstance Win32_Process -Filter \"Name = 'NovelForge.exe'\" -ErrorAction Stop | Where-Object { [String]::Equals($_.ExecutablePath, $env:NOVELFORGE_UPDATE_EXECUTABLE, [StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -match '(^|\\s)--mcp(\\s|$)' } | ForEach-Object { [int]$_.ProcessId }); ConvertTo-Json -InputObject $ids -Compress"
  while (true) {
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 5_000, encoding: 'utf8',
      env: { ...process.env, NOVELFORGE_UPDATE_EXECUTABLE: executablePath },
    })
    const pids: unknown = JSON.parse(result.stdout.trim())
    if (!Array.isArray(pids) || pids.some(pid => !Number.isInteger(pid) || pid <= 0)) throw new Error(formatUserFacingMessage('update.bridgeStateUnknown'))
    if (!pids.length) return
    if (Date.now() >= deadline) throw new Error(formatUserFacingMessage('update.bridgeExitTimeout'))
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}
