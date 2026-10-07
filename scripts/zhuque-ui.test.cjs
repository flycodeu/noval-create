const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..')
fs.mkdirSync(path.join(root, '.tmp-tests'), { recursive: true })
const temp = fs.mkdtempSync(path.join(root, '.tmp-tests', 'zhuque-ui-'))
app.setPath('userData', temp); app.disableHardwareAcceleration()
async function main() {
  await app.whenReady()
  const contents = [
    "import React from 'react';import{createRoot}from'react-dom/client';",
    "import ZhuqueSettings from './src/pages/ModelManager/ZhuqueSettings';",
    "import ZhuqueChapterPanel from './src/components/ZhuqueChapterPanel';",
    "window.calls=[];window.electron={zhuque:{getSettings:()=>Promise.resolve({enabled:false,autoDetect:true,apiKeySet:false}),",
    "updateSettings:input=>new Promise(resolve=>window.calls.push({kind:'settings',input,resolve})),",
    "test:()=>Promise.resolve({success:true,info:'测试成功',latency:5}),",
    "getChapterResult:id=>new Promise(resolve=>window.calls.push({kind:'read',id,resolve})),",
    "detectChapter:id=>new Promise(resolve=>window.calls.push({kind:'detect',id,resolve}))}};",
    "const root=createRoot(document.getElementById('root'));window.editor='已保存的正文。';",
    "window.showSettings=()=>root.render(<ZhuqueSettings/>);",
    'window.showChapter=id=>root.render(<ZhuqueChapterPanel chapterId={id} savedContent="已保存的正文。" getContent={()=>window.editor}/>);window.showSettings();',
  ].join('')
  buildSync({ stdin: { contents, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', outfile: path.join(temp, 'fixture.js') })
  fs.writeFileSync(path.join(temp, 'index.html'), '<div id="root"></div><script src="fixture.js"></script>')
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } })
  await win.loadFile(path.join(temp, 'index.html'))
  const run = code => win.webContents.executeJavaScript(code)
  const wait = async code => { for (let i = 0; i < 150; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('Timeout: '+code) }
  const click = text => run("{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+JSON.stringify(text)+");if(!b)throw Error('button absent');b.click();}")
  await wait('!!document.querySelector("[data-zhuque-settings]") && ![...document.querySelectorAll("button")].find(b=>b.textContent.includes("配置朱雀检测")).disabled')
  await click('配置朱雀检测')
  await wait("!!document.querySelector('input[aria-label=\"朱雀 API Key\"]')")
  await run("{const i=document.querySelector('input[aria-label=\"朱雀 API Key\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'fixture-ui-key');i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label=\"启用朱雀检测\"]').click();}")
  await wait("document.querySelector('input[aria-label=\"朱雀 API Key\"]').value==='fixture-ui-key'")
  await run("{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存配置');b.click();b.click();}")
  await wait('window.calls.filter(c=>c.kind==="settings").length===1')
  assert.deepEqual(await run('window.calls[0].input'), { enabled: true, autoDetect: true, apiKey: 'fixture-ui-key' })
  await run('window.calls[0].resolve({enabled:true,autoDetect:true,apiKeySet:true})')
  await wait('document.querySelector("[data-zhuque-settings]").textContent.includes("已保存")')
  await click('配置朱雀检测')
  await wait("document.querySelector('input[aria-label=\"朱雀 API Key\"]').value===''")
  await click('保存配置')
  await wait('window.calls.filter(c=>c.kind==="settings").length===2')
  assert.deepEqual(await run('window.calls[1].input'), { enabled: true, autoDetect: true }, 'blank key preserves local credential without echoing it')
  await run('window.calls[1].resolve({enabled:true,autoDetect:true,apiKeySet:true})')
  await run('window.showChapter(1)')
  await wait('window.calls.some(c=>c.kind==="read"&&c.id===1)')
  await run("window.calls.find(c=>c.kind==='read'&&c.id===1).resolve({enabled:true,autoDetect:true,apiKeySet:true,status:'not_checked'})")
  await wait('document.querySelector("[data-zhuque-chapter]").textContent.includes("尚未检测")')
  await run("window.editor='有未保存修改。'")
  await click('检测正文')
  await wait('document.body.textContent.includes("尚有未保存修改")')
  assert.equal(await run('window.calls.filter(c=>c.kind==="detect").length'), 0)
  await run("window.editor='已保存的正文。'")
  await run("{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='检测正文');b.click();b.click();}")
  await wait('window.calls.filter(c=>c.kind==="detect").length===1')
  await run('window.showChapter(2)')
  await wait('window.calls.some(c=>c.kind==="read"&&c.id===2)')
  await run("window.calls.find(c=>c.kind==='detect').resolve({enabled:true,autoDetect:true,apiKeySet:true,status:'success',report:{metrics:{aiRatio:0.99,suspectedAiRatio:0,humanRatio:0.01,segments:[]}}});window.calls.find(c=>c.kind==='read'&&c.id===2).resolve({enabled:true,autoDetect:true,apiKeySet:true,status:'stale',report:{checkedAt:'2026-10-07T00:00:00Z',metrics:{aiRatio:0.99,suspectedAiRatio:0,humanRatio:0.01,segments:[]}}})")
  await wait('document.body.textContent.includes("旧结果已过期")')
  assert.equal(await run('document.body.textContent.includes("99.0%")'), false, 'old chapter and stale content scores must not be shown as current')
  await click('刷新状态')
  await wait('window.calls.filter(c=>c.kind==="read"&&c.id===2).length===2')
  const currentReport = { chapterId: 2, contentHash: createHash('sha256').update('已保存的正文。').digest('hex'), checkedAt: '2026-10-07T00:00:00Z', status: 'success', metrics: { aiRatio: 0.3, suspectedAiRatio: 0.5, humanRatio: 0.2, segments: [{ label: 2, confidence: 0.8, text: '已保存的正文。' }] } }
  await run('window.calls.filter(c=>c.kind==="read"&&c.id===2)[1].resolve('+JSON.stringify({ enabled: true, autoDetect: true, apiKeySet: true, status: 'success', report: currentReport })+')')
  await wait('document.body.textContent.includes("AI内容 30.0%")')
  assert.equal(await run('document.body.textContent.includes("疑似AI 50.0%") && document.body.textContent.includes("人工内容 20.0%")'), true, 'ratios are separate, not an invented combined AI rate')
  await click('刷新状态')
  await wait('window.calls.filter(c=>c.kind==="read"&&c.id===2).length===3')
  await run('window.calls.filter(c=>c.kind==="read"&&c.id===2)[2].resolve('+JSON.stringify({ enabled: true, autoDetect: true, apiKeySet: true, status: 'running', report: { ...currentReport, contentHash: 'previous-version' } })+')')
  await wait('document.querySelector("[data-zhuque-chapter]").textContent.includes("检测中")')
  assert.equal(await run('document.body.textContent.includes("30.0%")'), false, 'pending detection hides old rates')
  await wait('window.calls.filter(c=>c.kind==="read"&&c.id===2).length===4')
  await run('window.calls.filter(c=>c.kind==="read"&&c.id===2)[3].resolve('+JSON.stringify({ enabled: true, autoDetect: true, apiKeySet: true, status: 'success', report: currentReport })+')')
  await wait('document.body.textContent.includes("AI内容 30.0%")')
  win.destroy()
  console.log('PASS Zhuque UI: actual ReactDOM configure/save/key omission, duplicate submit lock, unsaved-text guard, chapter switch, stale scores, separate ratios and polling with a previous report. Fixture API only.')
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
