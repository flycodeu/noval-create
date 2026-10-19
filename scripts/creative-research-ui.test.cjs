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
    import CreativeResearchLibrary from './src/pages/Novel/AuthorWorkspace/CreativeResearchLibrary';
    import{getCreativeResearchSourceKey}from'./src/shared/creative-research';
    import{useNovelStore}from'./src/stores/novel.store';
    import{getAntdThemeConfig}from'./src/theme/antd-tokens';
    import './src/styles/global.css';import './src/pages/Novel/AuthorWorkspace/author-workspace.css';
    window.requests=[];window.agentCalls=[];window.approvalRequests=[];window.currentNovel={id:1,title:'界面测试作品',contextVersion:2,sourceLedgerJson:'[]'};useNovelStore.getState().setCurrentNovel(window.currentNovel);
    window.rows=Array.from({length:7},(_,i)=>({sourceKey:'s'+i,title:'资料来源 '+i,url:'https://example.org/source/'+i,excerpt:'示例来源摘要，仅用于界面验证。可用于人物抉择和生活细节，仍须核对本书设定。',topics:['道教'],query:'道教行旅资料',recordedAt:'2026-10-17T00:00:00Z',verificationStatus:'web_found',canonDecision:'reference_only'}));
    window.electron={
      sourceSearch:{listResearch:async id=>id===1?structuredClone(window.rows):[],research:(id,request)=>new Promise((resolve,reject)=>window.requests.push({id,request,resolve,reject}))},
      novel:{get:async id=>id===1?structuredClone(window.currentNovel):{id,title:'另一作品',contextVersion:1,sourceLedgerJson:'[]'}},
      agentTools:{
        approve:async request=>{window.approvalRequests.push(request);if(window.deferApproval)return new Promise(resolve=>window.resolveApproval=resolve);return{approved:true,approvalId:'ui-approval'}},
        call:async request=>{
          window.agentCalls.push(request)
          if(request.toolId==='novelforge.research.upsert'){
            const draft=request.input.entries[0],entries=JSON.parse(window.currentNovel.sourceLedgerJson),sourceKey=draft.sourceKey||getCreativeResearchSourceKey(draft)
            const saved={...draft,sourceKey,sourceType:'author_created',assetType:'creative_reference',factTitle:draft.title,sourceText:'界面测试参考卡',verificationStatus:'pending',canonDecision:'reference_only',recordedAt:'2026-10-19T00:00:00.000Z',updatedAt:'2026-10-19T00:00:00.000Z'}
            const index=entries.findIndex(entry=>entry.sourceKey===sourceKey);if(index<0)entries.push(saved);else entries[index]=saved
            window.currentNovel.sourceLedgerJson=JSON.stringify(entries)
          }
          if(request.toolId==='novelforge.research.delete')window.currentNovel.sourceLedgerJson=JSON.stringify(JSON.parse(window.currentNovel.sourceLedgerJson).filter(entry=>entry.sourceKey!==request.input.sourceKey))
          return{ok:true,data:{count:1}}
        }
      }
    };
    const root=createRoot(document.getElementById('root'));window.paint=(id=1,disabled=false)=>{if(useNovelStore.getState().currentNovelId!==id)useNovelStore.getState().setCurrentNovel(id===1?window.currentNovel:{id,title:'另一作品',contextVersion:1,sourceLedgerJson:'[]'});root.render(<ConfigProvider theme={getAntdThemeConfig('light')}><div className="author-workspace"><ResearchLibrary novelId={id} disabled={disabled}/><CreativeResearchLibrary novelId={id}/></div></ConfigProvider>)};window.paint();
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
  await wait('!document.querySelector("input").disabled')
  await run("window.rows.unshift({...window.rows[0],sourceKey:'metadata-only',title:'仅标题来源',excerpt:'仅标题来源',excerptKind:'source_metadata'});window.dispatchEvent(new Event('novelforge:creative-completed'))")
  await wait('document.body.textContent.includes("仅来源链接，未返回网页摘要")')
  assert.equal(await run('document.querySelector(".research-library__sources article").querySelectorAll(":scope > p").length'), 0, 'model-backed source metadata is not rendered as a webpage excerpt')
  await input('检索故障')
  await clickSearch()
  await wait('window.requests.length===2')
  await run("window.requests[1].reject(new Error('搜索服务暂时不可用'))")
  await wait('document.querySelector("[role=alert]")?.textContent.includes("暂时不可用")')
  assert((await run('document.body.textContent')).includes('新检索来源'), 'failure preserves saved sources')
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('新建资料卡')).click()")
  const fill = (selector, value) => run(`{const el=document.querySelector(${JSON.stringify(selector)});const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}`)
  await fill('input[placeholder="例如：赎罪为何会变成新的权力"]', '不争与权力边界')
  await fill('textarea[maxlength="2000"]', '主角拒绝垄断渡口的救命药，代价是失去军中晋升。')
  await fill('textarea[placeholder="表层事件之外，它让读者重新理解什么？"]', '克制不是无欲，而是不把他人困境换成自己的权力。')
  await fill('textarea[placeholder="它可以怎样映照本作的世界、人物困境或主线冲突？"]', '在饥荒粮药分配上放弃短期胜利，承担后续朝廷问责。')
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存到创作参考').click()")
  await wait('window.agentCalls.some(call=>call.toolId==="novelforge.research.upsert")')
  assert.equal(await run('window.agentCalls.at(-1).input.entries[0].title'), '不争与权力边界')
  await wait('document.body.textContent.includes("不争与权力边界")')
  assert((await run('document.body.textContent')).includes('仅供启发'))
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('新建资料卡')).click()")
  await fill('input[placeholder="例如：赎罪为何会变成新的权力"]', '不争与权力边界')
  await fill('textarea[maxlength="2000"]', '新的卡片内容不能静默覆盖同身份旧卡。')
  await fill('textarea[placeholder="表层事件之外，它让读者重新理解什么？"]', '重复保存必须明确询问作者。')
  await fill('textarea[placeholder="它可以怎样映照本作的世界、人物困境或主线冲突？"]', '保留上一张卡并明确确认更新。')
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存到创作参考').click()")
  await wait('document.body.textContent.includes("相同标题、分类和出处的资料卡已存在")')
  assert.equal(await run('window.agentCalls.filter(call=>call.toolId==="novelforge.research.upsert").length'), 1, 'duplicate save waits for confirmation')
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='更新现有卡片').click()")
  await wait('window.agentCalls.filter(call=>call.toolId==="novelforge.research.upsert").length===2')
  await wait('document.querySelectorAll(".creative-research__card").length===1')
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
  await wait('document.body.textContent.includes("不争与权力边界")')
  for (const width of [1280, 720]) {
    win.setContentSize(width, 1000)
    await pause(150)
    assert.equal(await run('document.documentElement.scrollWidth>innerWidth+1'), false, `overflow at ${width}`)
    fs.writeFileSync(path.join(dir, `research-${width}.png`), (await win.webContents.capturePage()).toPNG())
  }
  await run('window.deferApproval=true')
  await run("document.querySelector('button[aria-label=\\\"删除不争与权力边界\\\"]').click()")
  await wait('window.approvalRequests.length===1')
  await run('window.paint(2)')
  await run("window.resolveApproval({approved:true,approvalId:'stale-approval'})")
  await pause(100)
  assert.equal(await run('window.agentCalls.filter(call=>call.toolId==="novelforge.research.delete").length'), 0, 'a delayed approval must not delete a card after switching projects')
  await run('window.paint(1);window.deferApproval=false')
  await wait('Boolean(document.querySelector("button[aria-label=\\\"删除不争与权力边界\\\"]"))')
  await run("document.querySelector('button[aria-label=\\\"删除不争与权力边界\\\"]').click()")
  await wait('window.agentCalls.some(call=>call.toolId==="novelforge.research.delete")')
  assert.equal(await run('window.approvalRequests.at(-1).request.input.sourceKey'), await run('window.agentCalls.filter(call=>call.toolId==="novelforge.research.upsert").at(-1).input.entries[0].sourceKey'))
  assert.equal(await run('window.agentCalls.at(-1).approvalId'), 'ui-approval')
  await wait('!document.body.textContent.includes("不争与权力边界")')
  console.log('PASS research UI: external search, author card create/readback, reference-only boundary, approval-protected deletion, project switch, error retention, 720/1280 responsive layout. Screenshots: ' + dir)
  win.destroy()
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
