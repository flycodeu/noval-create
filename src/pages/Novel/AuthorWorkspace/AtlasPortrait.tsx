import React from 'react'
import { Button, message } from 'antd'
import type { StoryAtlasEntity } from '../../../shared/story-atlas'
import { getUserFacingMessage } from '../../../utils/user-facing-message'
import { atlasPortraitImage, buildAtlasPortraitPrompt } from './atlas-portrait'

export function AtlasPortrait({ entity, onEdit, disabled }: { entity: StoryAtlasEntity; onEdit: () => void; disabled?: boolean }) {
  const image = atlasPortraitImage(entity.attributes.portraitImage)
  const prompt = typeof entity.attributes.portraitPrompt === 'string' && entity.attributes.portraitPrompt.trim() ? entity.attributes.portraitPrompt : buildAtlasPortraitPrompt(entity)
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); message.success(getUserFacingMessage('workspace.portrait.promptCopied')) }
    catch { message.error(getUserFacingMessage('workspace.portrait.copyFailed')) }
  }
  return <section className="atlas-profile-section atlas-portrait" aria-label="人物肖像">
    <div className="atlas-portrait-heading"><h3>人物肖像</h3></div>
    {image ? <img className="atlas-portrait-image" src={image} alt={`${entity.name}的角色参考像`} /> : <p className="atlas-empty-note">尚未添加角色参考像。</p>}
    <div className="atlas-profile-actions"><Button size="small" disabled={disabled} onClick={onEdit}>{image ? '更换肖像与视觉设定' : '添加肖像与视觉设定'}</Button><Button size="small" onClick={() => void copy()}>复制视觉描述</Button></div>
    <details className="author-disclosure"><summary>视觉描述</summary><p className="atlas-portrait-prompt">{prompt}</p></details>
  </section>
}
