// Development-only event fixture. This is not imported by the application build.
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import InlineCompletionEditor from '../../src/pages/Novel/AuthorWorkspace/InlineCompletionEditor'
import { installWebElectronBridge } from '../../src/runtime/web-electron-bridge'
import type { Chapter } from '../../src/types'
import '../../src/styles/global.css'
import '../../src/pages/Novel/AuthorWorkspace/author-workspace.css'

installWebElectronBridge()
function Fixture() {
  const params = new URLSearchParams(location.search), novelId = Number(params.get('novelId')), chapterId = Number(params.get('chapterId'))
  const [value, setValue] = useState('船工站在渡口。'), [prevented, setPrevented] = useState('尚未发送'), [paused, setPaused] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const event = (type: 'compositionstart' | 'compositionend') => field.current?.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: '中文输入' }))
  return <main style={{ maxWidth: 850, margin: '30px auto', padding: 20 }}>
    <h1>行内补全组合输入事件回归</h1><p>运行实际编辑组件，模拟浏览器组合输入事件；不模拟操作系统候选窗。只连接指定隔离作品。</p>
    <div style={{ display: 'flex', gap: 12, margin: '20px 0' }}>
      <button onMouseDown={e => e.preventDefault()} onClick={() => event('compositionstart')}>开始组合输入</button>
      <button onMouseDown={e => e.preventDefault()} onClick={() => event('compositionend')}>结束组合输入</button>
      <button onMouseDown={e => e.preventDefault()} onClick={() => { const key = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }); field.current?.dispatchEvent(key); setPrevented(String(key.defaultPrevented)) }}>发送输入法 Tab</button>
      <button onMouseDown={e => e.preventDefault()} onClick={() => setPaused(current => !current)}>{paused ? '恢复辅助' : '暂停辅助'}</button>
    </div><p>输入法按键是否被阻止：<output>{prevented}</output></p>
    <InlineCompletionEditor novelId={novelId} chapter={{ id: chapterId, chapterNum: 1 } as Chapter} value={value} disabled={false} assistDisabled={paused} editorRef={field} onChange={setValue} onSelection={() => {}} />
    <p>当前草稿：<output aria-label="当前草稿">{value}</output></p>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
