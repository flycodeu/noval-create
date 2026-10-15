const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { buildSync, build } = require('esbuild')
const root = path.resolve(__dirname, '..')
const tempRoot = path.join(root, '.tmp-tests')
fs.mkdirSync(tempRoot, { recursive: true })
const temp = fs.mkdtempSync(path.join(tempRoot, 'window-chrome-'))
app.setPath('userData', temp)
app.disableHardwareAcceleration()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  await app.whenReady()
  buildSync({ entryPoints: [path.join(root, 'electron/utils/window-close.ts')], bundle: true, platform: 'node', external: ['electron'], outfile: path.join(temp, 'guard.cjs') })
  const { installWindowCloseGuard, confirmWindowClose } = require(path.join(temp, 'guard.cjs'))
  const contents = `
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';
import{ConfigProvider}from'antd';import{getAntdThemeConfig}from'./src/theme/antd-tokens';
import AppLayout from './src/components/Layout';import NovelRouter from './src/pages/Novel';
import './src/styles/global.css';import './src/styles/ui-simplification.css';
const {ipcRenderer}=require('electron');window.operations=[];window.dirty=false;
window.addEventListener('beforeunload',event=>{if(window.dirty){event.preventDefault();event.returnValue='';}});
window.electron={on:()=>{},novel:{list:async()=>[],get:async()=>({id:292,title:'照夜行',totalWords:16214})},
app:{getRuntimeInfo:async()=>({environment:'formal',source:'installed',version:'2.4.26',executable:'D:/Program Files/NovelForge/NovelForge.exe',dataDirectory:'C:/Users/author/AppData/Roaming/NovelForge'})},
windowControls:{minimize:async()=>{window.operations.push('minimize');},toggleMaximize:async()=>false,isMaximized:async()=>false,onMaximizedStateChange:()=>()=>{},
close:()=>ipcRenderer.invoke('fixture:close'),confirmClose:choice=>ipcRenderer.invoke('fixture:confirm',choice),
onCloseRequested:callback=>{const f=(_,value)=>callback(value);ipcRenderer.on('window:close-requested',f);return()=>ipcRenderer.removeListener('window:close-requested',f);}}};
const root=createRoot(document.getElementById('root'));window.paint=(theme,route='/novels/292/writing')=>{document.documentElement.dataset.theme=theme;root.render(<ConfigProvider theme={getAntdThemeConfig(theme)}><MemoryRouter key={route} initialEntries={[route]}><AppLayout><Routes><Route path='/novels/:id/:page' element={<NovelRouter/>}/><Route path='/novels' element={<p style={{padding:32}}>我的小说</p>}/></Routes></AppLayout></MemoryRouter></ConfigProvider>);};window.paint('light');`
  const pageFixture = `import React,{useContext}from'react';import{createPortal}from'react-dom';import{Button}from'antd';import{WorkspaceChromePortalContext}from'./src/components/novel/workspace-layout/workspace-chrome-contract';export default function Page(){const{actionTarget}=useContext(WorkspaceChromePortalContext);return <div className="author-workspace"><span className="author-eyebrow">界面测试 · 示例内容</span><h1>正文</h1><p>章节与修订</p><textarea aria-label="测试草稿" defaultValue="保留未保存的草稿" style={{width:'100%',height:260,background:'var(--bg-surface)',color:'var(--text-primary)',border:'1px solid var(--border-default)',padding:24}}/>{actionTarget&&createPortal(<><Button>检查正文</Button><Button type="primary">保存</Button></>,actionTarget)}</div>}`
  await build({ stdin: { contents, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', external: ['electron'], outfile: path.join(temp, 'fixture.js'), plugins: [{ name: 'fixture-pages', setup(build) {
    build.onResolve({ filter: /AuthorWorkspace\/(Studio|StoryDesign|WorldAndCast|StoryTimeline|Manuscript|Versions)$/ }, args => args.importer.endsWith('Novel\\index.tsx') || args.importer.endsWith('Novel/index.tsx') ? { path: args.path, namespace: 'page-fixture' } : undefined)
    build.onResolve({ filter: /TaskIndicator$/ }, () => ({ path: 'task-fixture', namespace: 'task-fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'page-fixture' }, () => ({ contents: pageFixture, loader: 'tsx', resolveDir: root }))
    build.onLoad({ filter: /.*/, namespace: 'task-fixture' }, () => ({ contents: 'export default ()=>null', loader: 'tsx' }))
  } }] })
  fs.writeFileSync(path.join(temp, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>')
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: true, backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  installWindowCloseGuard(win, () => false, () => {})
  ipcMain.handle('fixture:close', () => { win.close() })
  ipcMain.handle('fixture:confirm', (_, choice) => {
    if (choice === 'minimize') return run("window.operations.push('minimize')")
    confirmWindowClose(win, choice)
  })
  const wait = async code => { for(let i=0;i<150;i++){if(await run(code))return;await pause(25)}throw Error('Timeout: '+code) }
  const click = label => run(`{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)throw Error('Missing button');b.click();}`)
  await win.loadFile(path.join(temp, 'index.html'))
  await wait('!!document.querySelector(".author-window-controls")')
  const rows=[]
  for (const theme of ['light','dark','soft']) for (const width of [1280,960,720]) {
    win.setContentSize(width,900)
    await run(`window.paint('${theme}')`);await pause(200)
    const layout=await run(`(()=>{const header=document.querySelector('.author-shell-header'),close=document.querySelector('.author-window-button--danger'),r=close.getBoundingClientRect();return{height:header.getBoundingClientRect().height,scrollWidth:document.documentElement.scrollWidth,innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,closeVisible:r.left>=0&&r.right<=innerWidth+1,banners:document.querySelectorAll('.runtime-banner').length}})()`)
    assert.equal(layout.banners,0);assert.equal(layout.overflow,false,JSON.stringify({theme,width,...layout}));assert.equal(layout.closeVisible,true);assert(Math.abs(layout.height-56)<1)
    await click('关闭或最小化窗口');await wait('!!document.querySelector(".close-window-dialog .ant-modal-title")');await pause(700)
    const modal=await run(`(()=>{const r=document.querySelector('.close-window-dialog .ant-modal-content').getBoundingClientRect();return{left:r.left,right:r.right,focused:document.activeElement.textContent,text:document.querySelector('.close-window-dialog').textContent}})()`)
    assert(modal.left>=0&&modal.right<=width+1);assert.equal(modal.focused,'继续编辑',JSON.stringify({theme,width,focused:modal.focused}))
    if(width===1280)fs.writeFileSync(path.join(temp,`close-${theme}.png`),(await win.webContents.capturePage()).toPNG())
    await click('继续编辑');await pause(250)
    rows.push({theme,width,...layout,modalWithinViewport:true})
  }
  // Native close (Alt+F4 path), cancel and minimize must leave the draft in place.
  win.close();await wait('document.querySelector(".close-window-dialog")?.textContent.includes("结束本次创作")')
  await run("document.querySelector('.close-window-dialog__choice').click()");await pause(200)
  assert.equal(await run('window.operations.at(-1)'), 'minimize');assert(!win.isDestroyed())
  await run('window.dirty=true');win.close();await pause(100)
  await run("document.querySelector('.close-window-dialog__choice--exit').click()")
  await wait('document.querySelector(".close-window-dialog .ant-modal-title")?.textContent==="先保存，再退出"')
  assert(!win.isDestroyed());assert.equal(await run('document.querySelector("textarea").value'),'保留未保存的草稿')
  assert.equal(await run('!!document.querySelector(".close-window-dialog__choice--exit")'),false)
  await click('继续编辑');await pause(200)
  await click('查看版本与数据位置');await pause(250)
  assert((await run('document.body.textContent')).includes('D:/Program Files/NovelForge/NovelForge.exe'))
  await run("window.paint('light','/novels')");await wait('!!document.querySelector(".app-shell-bar")')
  assert.equal(await run('document.querySelectorAll(".runtime-badge").length'),1)
  await run('window.dirty=false');win.close();await pause(100)
  const closed=new Promise(resolve=>win.once('closed',resolve))
  await run("document.querySelector('.close-window-dialog__choice--exit').click()").catch(()=>{})
  await closed
  fs.writeFileSync(path.join(temp,'verification.json'),JSON.stringify(rows,null,2))
  console.log('PASS window chrome: 3 themes / 3 widths; actual app and novel headers; cancel, minimize, native close, unsaved veto and confirmed exit. Screenshots: '+temp)
  app.exit(0)
}
main().catch(error=>{console.error(error);app.exit(1)})
