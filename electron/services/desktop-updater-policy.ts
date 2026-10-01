// The electron-builder portable launcher sets PORTABLE_EXECUTABLE_FILE for its child.
export function canUseDesktopUpdater(packaged: boolean, platform: string, portableExecutable?: string): boolean {
  return packaged && platform === 'win32' && !portableExecutable
}
