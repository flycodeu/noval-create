import * as atlas from '../services/story-atlas.service'
import type { StoryAtlasApplyInput, StoryAtlasQuery } from '../../src/shared/story-atlas'

type Handle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void
export function registerStoryWorkspaceIpc(handle: Handle): void {
  handle('storyAtlas:query', (_event, input) => atlas.queryStoryAtlas(input as StoryAtlasQuery))
  handle('storyAtlas:validate', (_event, input) => atlas.validateStoryAtlasChanges(input as StoryAtlasApplyInput))
  handle('storyAtlas:apply', (_event, input) => atlas.applyStoryAtlasChanges(input as StoryAtlasApplyInput))
}
