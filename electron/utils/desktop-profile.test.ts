import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ packaged: true, appData: '', userData: '', appPath: '', exe: '' }))
vi.mock('electron', () => ({ app: {
  get isPackaged() { return state.packaged },
  getPath: (name: string) => ({ appData: state.appData, userData: state.userData, exe: state.exe })[name],
  getAppPath: () => state.appPath,
  getVersion: () => state.packaged ? '2.4.24' : '30.5.1',
} }))
import { applicationVersion, installedExecutable, isTestProfile, registerFormalInstallation, runtimeIdentity } from './desktop-profile'

const roots: string[] = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-profile-'))
  roots.push(root)
  Object.assign(state, { packaged: true, appData: root, userData: path.join(root, 'NovelForge'), appPath: root, exe: path.join(root, 'NovelForge.exe') })
  fs.mkdirSync(state.userData)
  fs.writeFileSync(state.exe, 'fixture')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.4.24' }))
  return root
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('formal desktop identity', () => {
  it('registers only the installed formal owner, never an isolated test executable', () => {
    const root = fixture()
    registerFormalInstallation()
    expect(installedExecutable()).toBe(state.exe)
    state.userData = path.join(root, 'test')
    state.exe = path.join(root, 'test.exe')
    expect(isTestProfile()).toBe(true)
    registerFormalInstallation()
    expect(installedExecutable()).toBe(path.join(root, 'NovelForge.exe'))
    expect(runtimeIdentity()).toMatchObject({ environment: 'test', dataDirectory: state.userData })
  })
  it('uses package version for script-mode source launches', () => {
    fixture()
    state.packaged = false
    expect(applicationVersion()).toBe('2.4.24')
    registerFormalInstallation()
    expect(() => installedExecutable()).toThrow()
  })
  it('fails closed if the installation no longer exists', () => {
    fixture()
    registerFormalInstallation()
    fs.unlinkSync(state.exe)
    expect(() => installedExecutable()).toThrow()
  })
})
