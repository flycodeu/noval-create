import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import NovelList from '../../src/pages/NovelList'
import NovelBookHeading from '../../src/components/novel/NovelBookHeading'
import CoverEditor from '../../src/components/novel/CoverEditor'
import { useNovelStore } from '../../src/stores/novel.store'
import { getAntdThemeConfig } from '../../src/theme/antd-tokens'
import '../../src/styles/global.css'

const w = window as any
const books = [
  { id: 1, title: '异闻录', synopsis: '芦渡有一间不收银钱的客栈。雨夜里，陆闻借到一盏灯，也接下了一桩无人肯认的旧事。', genreName: '志怪悬疑', status: 'writing', totalWords: 38620, updatedAt: '2026-10-25', contextVersion: 7 },
  { id: 2, title: '长街听雨', synopsis: '一封迟到了二十年的家书，把两个素不相识的人带回了旧日长街。', genreName: '都市', status: 'draft', totalWords: 7200, updatedAt: '2026-10-24', contextVersion: 1 },
  { id: 3, title: '星海归途', synopsis: '航道关闭之前，最后一艘返乡的船驶入了无人记录的星域。', genreName: '科幻', status: 'completed', totalWords: 192000, updatedAt: '2026-10-20', contextVersion: 3 },
] as any[]
const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 300
const context = canvas.getContext('2d')!; context.fillStyle = '#294e52'; context.fillRect(0, 0, 200, 300); context.fillStyle = '#ecd4a0'; context.fillRect(85, 150, 30, 45)
w.candidate = canvas.toDataURL('image/png')
w.calls = []; w.saved = []
w.externalCoverChange = () => { books[0].coverImage = null; useNovelStore.setState(state => ({ currentNovel: { ...state.currentNovel!, coverImage: null } })) }
w.electron = { novel: {
  list: async () => structuredClone(books),
  generateCover: async (...args: any[]) => { w.calls.push(args); if (w.deferGenerate) await new Promise(resolve => { w.resolveGenerate = resolve }); if (w.failGenerate) throw Error('图片接口返回 HTTP 401'); return w.candidate },
  setCover: async (id: number, input: any) => { w.lastSaveInput = input; if (w.failSave) throw Error('封面已被其他操作修改'); if (w.deferSave) await new Promise(resolve => { w.resolveSave = resolve }); const novel = books.find(book => book.id === id)!; novel.coverImage = input.image; w.saved.push({ id, ...input }); return structuredClone(novel) },
}, model: { list: async () => [{ id: 1, name: '图片兼容接口', provider: 'custom' }, { id: 2, name: 'Claude 文字接口', provider: 'anthropic' }] } }
useNovelStore.getState().setCurrentNovel(books[0])
function Fixture() {
  const [view, setView] = useState('shelf')
  const [open, setOpen] = useState(true)
  const novel = useNovelStore(state => state.currentNovel)!
  w.paint = (next: string) => { setOpen(true); setView(next) }
  return <ConfigProvider theme={getAntdThemeConfig('light')}><MemoryRouter>
    {view === 'shelf' ? <NovelList /> : <main style={{ padding: 24, maxWidth: 1100, margin: 'auto' }}><NovelBookHeading novel={novel} chapterCount={12} onOpenChapters={() => {}} onManageModels={() => {}} /><textarea id="author-request" aria-label="现有草稿" defaultValue="这段草稿不会因更换封面丢失。" />
      {view === 'editor' && open && <CoverEditor novel={novel} onClose={() => setOpen(false)} onSaved={() => {}} onManageModels={() => {}} />}</main>}
  </MemoryRouter></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
