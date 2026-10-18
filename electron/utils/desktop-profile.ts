import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'

export function sameDirectory(left: string, right: string): boolean {
  const canonical = (value: string) => {
    const resolved = path.resolve(value)
    const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved
    return process.platform === 'win32' ? real.toLowerCase() : real
  }
  return canonical(left) === canonical(right)
}

export function formalDataDirectory(): string {
  return path.join(app.getPath('appData'), 'NovelForge')
}

export function isTestProfile(): boolean {
  return !sameDirectory(app.getPath('userData'), formalDataDirectory())
}

export function applicationVersion(): string {
  // Script-mode Electron reports its own version (e.g. 30.5.1).
  return app.isPackaged ? app.getVersion()
    : (JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { version: string }).version
}

export function runtimeIdentity() {
  return {
    environment: isTestProfile() ? 'test' as const : 'formal' as const,
    version: applicationVersion(),
    source: app.isPackaged ? 'installed' as const : 'source' as const,
    dataDirectory: app.getPath('userData'),
    executable: app.getPath('exe'),
  }
}

export function registerFormalInstallation(): void {
  if (!app.isPackaged || isTestProfile()) return
  fs.writeFileSync(path.join(formalDataDirectory(), 'desktop-install.json'), JSON.stringify({ executable: app.getPath('exe'), version: applicationVersion() }))
}

export function installedExecutable(): string {
  const record = JSON.parse(fs.readFileSync(path.join(formalDataDirectory(), 'desktop-install.json'), 'utf8')) as { executable: string }
  if (!path.isAbsolute(record.executable) || !fs.statSync(record.executable).isFile()
    || sameDirectory(record.executable, process.execPath)) throw new Error(formatUserFacingMessage('runtime.invalidInstalledExecutable'))
  return record.executable
}
