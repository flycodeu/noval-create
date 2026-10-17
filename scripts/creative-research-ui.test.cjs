const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
fs.mkdirSync(path.join(root, '.tmp-tests'), { recursive: true })
const dir = fs.mkdtempSync(path.join(root, '.tmp-tests', 'research-ui-'))
app.setPath('userData', dir)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
async function main() {
  await app.whenReady()
  await build({ stdin: { contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{ConfigProvider}from'antd';
    import ResearchLibrary from './src/pages/Novel/AuthorWorkspace/ResearchLibrary';
    import{getAntdThemeConfig}from'./src/theme/antd-tokens';
    import './src/styles/global.css';import './src/pages/Novel/AuthorWorkspace/author-workspace.css';
    window.requests=[];window.rows=Array.from({length:7},(_,i)=>({sourceKey:'s'+i,title:'资料来源 '+i,url:'https://example.org/source/'+i,excerpt:'示例来源摘要，仅用于界面验证。可用于人物抉择和生活细节，仍须核对本书设定。',topics:['道教'],query:'道教行旅资料',recordedAt:'2026-10-17T00:00:00Z',verificationStatus:'web_found',canonDecision:'reference_only'}));
    window.electron={sourceSearch:{listResearch:async id=>id===1?window.rows:[],research:(id,request)=>new Promise((resolve,reject)=>window.requests.push({id,request,resolve,reject}))},novel:{get:async id=>({id,title:'界面测试作品',contextVersion:2})}};
    const root=createRoot(document.getElementById('root'));window.paint=(id=1,disabled=false)=>root.render(<ConfigProvider theme={getAntdThemeConfig('light')}><div className="author-workspace"><ResearchLibrary novelId={id} disabled={disabled}/></div></ConfigProvider>);window.paint();
  `, loader: 'tsx', resolveDir: root }, outfile: path.join(dir, 'fixture.js'), bundle: true, platform: 'browser' })
  fs.writeFileSync(path.join(dir, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>')
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } })
  const run = text => win.webContents.executeJavaScript(text)
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async expression => { for (let i = 0; i < 150; i++) { if (await run(expression)) return; await pause(20) } throw Error('Timeout: ' + expression) }
  const input = text => run(`{const el=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));}`)
  const clickSearch = () => run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('搜索并保存参考')).click()")
  await win.loadFile(path.join(dir, 'index.html'))
  await wait('document.querySelectorAll(".research-library__sources article").length===5')
  await run('document.querySelector(".ant-pagination-item-2").click()')
  await wait('document.querySelectorAll(".research-library__sources article").length===2')
  assert((await run('document.body.textContent')).includes('资料来源 6'))
  await input('搜索适合本书的道教观念')
  await clickSearch()
  await wait('window.requests.length===1')
  assert.equal(await run('window.requests[0].request'), '搜索适合本书的道教观念')
  assert.equal(await run('document.querySelector("input").disabled'), true)
  await run("window.rows.unshift({...window.rows[0],sourceKey:'new',title:'新检索来源'});window.requests[0].resolve({diagnostics:['搜索完成：摘要已保存，待核实。']})")
  await wait('document.body.textContent.includes("新检索来源")')
  assert((await run('document.body.textContent')).includes('摘要已保存'))
  assert.equal(await run('document.querySelector(".research-library__sources a").getAttribute("rel")'), 'noreferrer')
  await input('检索故障')
  await clickSearch()
  await wait('window.requests.length===2')
  await run("window.requests[1].reject(new Error('搜索服务暂时不可用'))")
  await wait('document.querySelector("[role=alert]")?.textContent.includes("暂时不可用")')
  assert((await run('document.body.textContent')).includes('新检索来源'), 'failure preserves saved sources')
  await input('延迟结果')
  await clickSearch()
  await wait('window.requests.length===3')
  await run('window.paint(2)')
  await wait('!document.querySelector("input").disabled && document.querySelector("input").value===""')
  await run("window.requests[2].resolve({diagnostics:['旧项目迟到资料']})")
  await pause(100)
  assert(!(await run('document.body.textContent')).includes('旧项目迟到资料'))
  await run('window.paint(1)')
  await wait('document.body.textContent.includes("新检索来源")')
  for (const width of [1280, 720]) {
    win.setContentSize(width, 1000)
    await pause(150)
    assert.equal(await run('document.documentElement.scrollWidth>innerWidth+1'), false, `overflow at ${width}`)
    fs.writeFileSync(path.join(dir, `research-${width}.png`), (await win.webContents.capturePage()).toPNG())
  }
  console.log('PASS research UI: paging, search/save/readback, error retention, project race, 720/1280 responsive layout. Screenshots: ' + dir)
  win.destroy()
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
