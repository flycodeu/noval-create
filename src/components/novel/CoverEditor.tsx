import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Upload, message } from 'antd'
import { PictureOutlined, UploadOutlined } from '@ant-design/icons'
import type { ModelConfig, Novel } from '../../types'
import { buildCoverPrompt, COVER_SIZES, type GenerateNovelCoverInput } from '../../shared/novel-cover'
import { getErrorMessage, getUserFacingMessage } from '../../utils/user-facing-message'
import { useNovelStore } from '../../stores/novel.store'
import BookCover from './BookCover'
import { importCover } from './import-cover'

// Mount a fresh editor for each book/open, retaining the original cover as the save comparison.
export default function CoverEditor({ novel, onClose, onSaved, onManageModels }: {
  novel: Novel; onClose: () => void; onSaved: (novel: Novel) => void; onManageModels: () => void
}) {
  const [originalCover] = useState(novel.coverImage || null)
  const [image, setImage] = useState<string | null>(originalCover)
  const [prompt, setPrompt] = useState(() => buildCoverPrompt(novel.title, novel.synopsis))
  const [models, setModels] = useState<ModelConfig[]>([])
  const [configId, setConfigId] = useState<number>()
  const [modelId, setModelId] = useState('')
  const [size, setSize] = useState<GenerateNovelCoverInput['size']>('1024x1536')
  const [activity, setActivity] = useState<'import' | 'generate' | 'save' | null>(null)
  const busy = activity !== null
  const [error, setError] = useState('')
  const [modelError, setModelError] = useState('')
  const [loadEpoch, setLoadEpoch] = useState(0)
  const alive = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    void window.electron.model.list().then(rows => { if (current) { setModels(rows.filter(model => ['openai', 'custom'].includes(model.provider))); setModelError('') } })
      .catch(cause => { if (current) setModelError(getErrorMessage(cause, 'cover.loadFailed')) })
    return () => { current = false }
  }, [loadEpoch])
  const perform = async (kind: 'import' | 'generate' | 'save', operation: () => Promise<void>, fallback: 'cover.importFailed' | 'cover.connectionFailed' | 'cover.saveFailed') => {
    if (inFlight.current) return
    inFlight.current = true; setActivity(kind); setError('')
    try { await operation() }
    catch (cause) { if (alive.current) setError(getErrorMessage(cause, fallback)) }
    finally { inFlight.current = false; if (alive.current) setActivity(null) }
  }
  const save = () => perform('save', async () => {
    const saved = await window.electron.novel.setCover(novel.id, { image, expectedCoverImage: originalCover })
    // Merge only cover metadata: a simultaneous narrative refresh must not be overwritten by this response.
    useNovelStore.setState(state => ({ novels: state.novels.map(row => row.id === saved.id ? { ...row, coverImage: saved.coverImage, updatedAt: saved.updatedAt } : row),
      currentNovel: state.currentNovel?.id === saved.id ? { ...state.currentNovel, coverImage: saved.coverImage, updatedAt: saved.updatedAt } : state.currentNovel }))
    if (alive.current) { onSaved(saved); message.success(getUserFacingMessage('cover.saved')); onClose() }
  }, 'cover.saveFailed')
  return <Modal open title={`《${novel.title}》的封面`} width="min(780px, calc(100vw - 24px))" onCancel={() => { if (!inFlight.current) onClose() }}
    keyboard={!busy} maskClosable={!busy} closable={!busy} footer={<Space><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={activity === 'save'} disabled={busy || image === originalCover} onClick={() => void save()}>采用封面</Button></Space>}>
    <div className="novel-cover-dialog">
      <div className="novel-cover-dialog__preview"><BookCover title={novel.title} image={image} genre={novel.genreName} /><span>{image === originalCover ? '当前封面' : '待采用预览'}</span>
        <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} disabled={busy} beforeUpload={file => { void perform('import', async () => { const result = await importCover(file); if (alive.current) setImage(result) }, 'cover.importFailed'); return false }}><Button block icon={<UploadOutlined />} loading={activity === 'import'} disabled={busy}>上传图片</Button></Upload>
        {image && <Button type="text" disabled={busy} onClick={() => setImage(null)}>移除封面</Button>}
      </div>
      <div className="novel-cover-dialog__form">
        <label>图片接口<Select aria-label="图片接口" disabled={busy} placeholder="选择已保存的 OpenAI / 自定义接口" value={configId} onChange={setConfigId} options={models.map(model => ({ value: model.id, label: model.name }))} /></label>
        {modelError && <Alert type="error" message={modelError} action={<Button onClick={() => setLoadEpoch(value => value + 1)}>重试</Button>} />}
        <div className="novel-cover-dialog__pair"><label>图片模型名<Input aria-label="图片模型名" value={modelId} maxLength={200} disabled={busy} onChange={event => setModelId(event.target.value)} placeholder="例如 gpt-image-1" /></label>
          <label>图片尺寸<Select aria-label="图片尺寸" value={size} disabled={busy} onChange={setSize} options={COVER_SIZES.map(value => ({ value, label: value === '1024x1536' ? '竖版 · 2:3' : value === '1024x1792' ? '长竖版 · DALL·E 3' : '方形 · 1:1' }))} /></label></div>
        <label>画面描述<Input.TextArea aria-label="封面画面描述" value={prompt} maxLength={6000} disabled={busy} onChange={event => setPrompt(event.target.value)} autoSize={{ minRows: 5, maxRows: 10 }} /></label>
        <Space wrap><Button icon={<PictureOutlined />} loading={activity === 'generate'} disabled={busy || !configId || !modelId.trim() || !prompt.trim()} onClick={() => void perform('generate', async () => {
          const result = await window.electron.novel.generateCover(novel.id, { configId: configId!, modelId: modelId.trim(), size, prompt: prompt.trim() })
          if (alive.current) setImage(result)
        }, 'cover.connectionFailed')}>生成封面</Button><Button type="link" disabled={busy} onClick={() => { onClose(); onManageModels() }}>管理模型接口</Button></Space>
        <p className="novel-cover-dialog__hint">使用支持图片生成的接口，费用由对应平台收取。生成后先预览，再选择采用。书名由页面排版显示，无需画进图片。</p>
        {error && <Alert type="error" message={error} />}
      </div>
    </div>
  </Modal>
}
