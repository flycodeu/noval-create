const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const tempRoot = path.join(root, '.tmp-tests')
const output = path.join(root, 'outputs', `global-interface-${require('../package.json').version}`)
fs.mkdirSync(tempRoot, { recursive: true })
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(tempRoot, 'global-interface-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const rendererErrors = []
const rendererWarnings = []
const networkRequests = []
const measurements = []
let activeWindow
let phase = 'setup'
let lastExpression = ''
const progress = value => { phase = value; console.log('[global-interface-ui] ' + value) }
const bounded = async (promise, label, ms = 20000) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]) }
  finally { clearTimeout(timer) }
}

async function main() {
  await app.whenReady()
  await build({ entryPoints: [path.join(root, 'scripts/fixtures/global-interface-ui.tsx')], alias: { '@': path.join(root, 'src') }, bundle: true, platform: 'browser', outfile: path.join(profile, 'fixture.js') })
  fs.writeFileSync(path.join(profile, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>')
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, useContentSize: true, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } })
  activeWindow = win
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => { networkRequests.push(details.url); callback({ cancel: true }) })
  win.webContents.on('render-process-gone', (_, details) => rendererErrors.push('Renderer exited: ' + JSON.stringify(details)))
  win.webContents.on('console-message', (_, level, text) => {
    if (text.startsWith('Warning: [antd:') && text.includes('Static function can not consume context')) rendererWarnings.push(text)
    else if (level >= 3 && !text.includes('Content-Security-Policy')) rendererErrors.push(text)
  })
  const run = expression => { lastExpression = expression; return bounded(win.webContents.executeJavaScript(expression), 'Renderer expression during ' + phase) }
  const wait = async expression => { for (let i = 0; i < 240; i++) { if (await run(`Boolean(${expression})`)) return; await pause(25) } throw Error('Timeout during ' + phase + ': ' + expression) }
  const click = async (text, scope = 'document') => {
    await wait(`!!window.ui.button(${JSON.stringify(text)}, ${scope})`)
    return run(`{const button=window.ui.button(${JSON.stringify(text)}, ${scope});if(!button)throw Error('Missing visible button: '+${JSON.stringify(text)});button.scrollIntoView({block:'nearest'});button.click()}`)
  }
  const edit = (selector, value) => run(`{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing input: '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))}`)
  const routeReady = {
    '/novels': '.novel-list-page__grid', '/models': '.model-manager-config-card', '/settings': '.app-settings__connection-state.is-ready',
    '/tasks': '.task-center-card', '/templates': '.template-manager-card:not(.template-manager-card--skeleton)', '/prompts': '.prompt-manager-inspector-body',
  }
  const go = async route => {
    await run(`location.hash=${JSON.stringify(route)}`)
    await wait(`location.hash===${JSON.stringify('#' + route)} && !!document.querySelector(${JSON.stringify(routeReady[route])})`)
    if (route === '/models') {
      await run('document.querySelector(".model-manager-config-card").click()')
      await wait('!!document.querySelector(".model-manager-status-actions")')
    }
    await pause(100)
  }
  const assertClean = async () => {
    assert.deepEqual(await run('window.fixture.unexpected'), [], 'every invoked service has an explicit mock')
    assert.deepEqual(await run('window.fixture.errors'), [], 'no uncaught renderer errors')
    assert.deepEqual(rendererErrors, [], 'no error-level renderer console output')
    assert.deepEqual(networkRequests, [], 'UI fixture never accesses network providers')
  }
  const noOverflow = async label => {
    const result = await run(`(()=>{
      const selectors=['html','body','#root','.app-layout','.app-layout__body','.app-layout__content','.novel-list-page','.novel-list-page__shell','.novel-list-page__toolbar','.novel-list-page__grid','.novel-workspace','.novel-hero','.novel-panel','.novel-panel__body','.model-manager-layout','.model-manager-config-card','.model-manager-source-panel','.app-settings','.app-settings__section','.app-settings__details-body','.task-center-list','.task-center-detail','.template-manager-card','.prompt-manager-shell','.prompt-manager-catalog','.prompt-manager-inspector','.prompt-manager-template-stage','.ant-modal-content','.ant-modal-body','.ant-modal-footer','.task-indicator-panel'];
      const offenders=[];for(const selector of selectors)for(const el of document.querySelectorAll(selector)){if(!window.ui.visible(el))continue;if(el.scrollWidth>el.clientWidth+2)offenders.push({selector,width:el.clientWidth,scrollWidth:el.scrollWidth,text:el.textContent.slice(0,100)})}
      const portals=[...document.querySelectorAll('.ant-modal,.task-indicator-popover:not(.ant-popover-hidden)')].filter(window.ui.visible).map(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right}});
      return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,offenders,portals};})()`)
    assert.equal(result.documentWidth <= result.width + 1, true, label + ': root has no horizontal overflow: ' + JSON.stringify(result))
    assert.deepEqual(result.offenders, [], label + ': primary containers have no horizontal overflow: ' + JSON.stringify(result.offenders))
    for (const rect of result.portals) assert(rect.left >= -1 && rect.right <= result.width + 1, label + ': visible portal fits the viewport: ' + JSON.stringify(rect))
    measurements.push({ label, ...result })
  }
  const resize = async (width, height = 1000) => { win.setContentSize(width, height); await pause(170) }
  const snapshot = async name => {
    await run('window.clearMessages()')
    // Give message.destroy() a normal render turn, but do not make toast exit
    // motion a capture prerequisite in a hidden window.
    await pause(120)
    // Hidden BrowserWindows can pause a compositor animation even after the DOM
    // layout is final. Finish finite UI motion and neutralize only the visible
    // portal's capture styles; never change production CSS or force a hidden
    // dialog open. Restore the exact inline styles immediately after capture.
    await run(`{
      const nodes=[...document.querySelectorAll('.ant-modal,.ant-modal-content,.ant-modal-mask')].filter(window.ui.visible);
      const animations=new Set(nodes.flatMap(el=>el.getAnimations()));
      for(const animation of animations)if(Number.isFinite(animation.effect?.getComputedTiming().endTime))animation.finish();
      window.captureStyleState=nodes.map(el=>({el,style:el.getAttribute('style')}));
      for(const el of nodes){el.style.setProperty('animation','none','important');el.style.setProperty('transition','none','important');el.style.setProperty('opacity','1','important');if(el.matches('.ant-modal,.ant-modal-content'))el.style.setProperty('transform','none','important')}
    }`)
    try {
      const [width, height] = win.getContentSize()
      win.setContentSize(width + 1, height); await pause(55); win.setContentSize(width, height); await pause(55)
      const geometry = `(()=>{const modal=window.ui.modal();if(!modal)return null;const rect=modal.getBoundingClientRect(),style=getComputedStyle(modal);return{title:modal.querySelector('.ant-modal-title')?.textContent,left:rect.left,top:rect.top,width:rect.width,height:rect.height,opacity:style.opacity,transform:style.transform}})()`
      let previous = await run(geometry)
      let stable = 0
      for (let attempt = 0; attempt < 30 && stable < 3; attempt++) {
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        const current = await run(geometry)
        stable = JSON.stringify(current) === JSON.stringify(previous) ? stable + 1 : 0
        previous = current
      }
      assert(stable >= 3, name + ': portal geometry must settle before screenshot')
      if (previous) {
        assert(previous.title && previous.width > 280 && previous.height > 100, name + ': screenshot contains the expanded dialog, not a zoom intermediate: ' + JSON.stringify(previous))
        assert.equal(previous.opacity, '1', name + ': dialog is fully opaque before screenshot')
        assert(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(previous.transform), name + ': dialog is no longer scaled by enter motion')
      }
      await win.webContents.capturePage(undefined, { stayHidden: true })
      win.webContents.invalidate()
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await pause(80)
      fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
      measurements.push({ label: 'screenshot ' + name, modal: previous, width, height })
    } finally {
      await run('{for(const {el,style} of window.captureStyleState||[])if(el.isConnected){if(style===null)el.removeAttribute("style");else el.setAttribute("style",style)}delete window.captureStyleState}')
    }
  }
  const closeModal = async () => { await run('window.ui.modal().querySelector(".ant-modal-close").click()'); await wait('!window.ui.modal()'); await pause(230) }
  const modalWidths = async label => {
    await wait('!!window.ui.modal()'); await pause(260)
    for (const width of [1280, 900, 720, 480]) { await resize(width); await noOverflow(label + ' ' + width); if (width === 480 || width === 1280) await snapshot(label + '-' + width) }
    await resize(1280, 720)
    await noOverflow(label + ' laptop 1280x720')
    const vertical = await run(`(()=>{
      const modal=window.ui.modal(),body=modal.querySelector('.ant-modal-body'),footer=modal.querySelector('.ant-modal-footer'),wrap=modal.closest('.ant-modal-wrap');
      const overflowing=body.scrollHeight>body.clientHeight+2||modal.getBoundingClientRect().bottom>innerHeight;
      const scrollable=[body,modal.querySelector('.ant-modal-content'),wrap].filter(el=>el&&el.scrollHeight>el.clientHeight+2&&/auto|scroll/.test(getComputedStyle(el).overflowY));
      footer.scrollIntoView({block:'end'});const rect=footer.getBoundingClientRect();return{overflowing,scrollable:scrollable.map(el=>el.className),footer:{top:rect.top,bottom:rect.bottom},height:innerHeight};})()`)
    assert(vertical.footer.top >= 0 && vertical.footer.bottom <= vertical.height + 1, label + ': footer remains vertically reachable at laptop height: ' + JSON.stringify(vertical))
    if (vertical.overflowing) assert(vertical.scrollable.length > 0, label + ': a real vertical scroller preserves access to long modal content')
    measurements.push({ label: label + ' laptop vertical', ...vertical })
    await resize(480)
  }
  const select = async (label, option) => {
    await run(`{const input=document.querySelector(${JSON.stringify('input[aria-label="' + label + '"]')});if(!input)throw Error('Missing select: '+${JSON.stringify(label)});input.closest('.ant-select').querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))}`)
    const match = `[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].find(el=>el.textContent.trim()===${JSON.stringify(option)})`
    await wait(`!!(${match})`); await run(`(${match}).click()`); await pause(60)
  }

  await win.loadFile(path.join(profile, 'index.html'))
  await wait('!!window.fixture && !!document.querySelector(".novel-list-page__grid") && !!document.querySelector(".runtime-badge--test")')
  await assertClean()
  const labels = { '/novels': '我的小说', '/models': '模型与搜索', '/settings': '应用设置', '/tasks': '运行记录', '/templates': '风格模板', '/prompts': '提示词管理' }
  for (const width of [1280, 900, 720, 480]) {
    await resize(width)
    for (const [route, label] of Object.entries(labels)) {
      progress(route + ' ' + width)
      await go(route)
      assert.equal(await run('document.querySelector(".app-shell-bar__title").textContent'), label, 'window title matches current global section')
      assert.equal(await run('document.body.textContent.includes("页面出现问题")'), false, route + ': page did not crash')
      const small = width <= 720
      assert.equal(await run('getComputedStyle(document.querySelector(".app-layout__sider")).display==="none"'), small, 'desktop navigation changes at actual responsive breakpoint')
      assert.equal(await run('getComputedStyle(document.querySelector(".app-layout__mobile-nav")).display!=="none"'), small, 'mobile navigation is available on narrow widths')
      if (small) {
        const active = await run('[...document.querySelectorAll(".app-layout__mobile-nav [aria-current=page]")].map(el=>el.textContent.trim())')
        assert.deepEqual(active, [label], 'mobile navigation identifies the current page, including advanced tools')
      } else if (['/tasks', '/templates', '/prompts'].includes(route)) {
        assert.equal(await run('document.querySelector(".ant-menu-item-selected")?.textContent.trim()'), label, 'advanced desktop menu opens to expose the current page')
      }
      await noOverflow(route + ' ' + width)
      await assertClean()
      if (width === 1280 || width === 480) await snapshot(route.slice(1) + '-' + width)
    }
  }

  progress('laptop height: navigation and real page scrolling')
  const endSelectors = { '/novels': '.novel-list-page__grid>*:last-child', '/models': '.model-manager-detection-panel', '/settings': '.app-settings__section:last-child', '/tasks': '.task-center-detail-panel', '/templates': '.template-manager-card:not(.template-manager-card--skeleton):last-child', '/prompts': '.prompt-manager-inspector' }
  for (const width of [1280, 900]) {
    await resize(width, 720)
    for (const route of Object.keys(labels)) {
      await go(route)
      const sidebar = await run(`(()=>{const el=document.querySelector('.app-layout__theme-panel'),r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:innerHeight}})()`)
      assert(sidebar.top >= 0 && sidebar.bottom <= sidebar.height + 1, route + ': sidebar theme controls stay visible at ' + width + 'x720')
      await run(`document.querySelector(${JSON.stringify(endSelectors[route])}).scrollIntoView({block:'end'})`)
      await pause(90)
      const bottom = await run(`(()=>{const target=document.querySelector(${JSON.stringify(endSelectors[route])}),r=target.getBoundingClientRect(),main=document.querySelector('.app-layout__content'),s=main.getBoundingClientRect();return{bottom:r.bottom,mainTop:s.top,mainBottom:s.bottom,scrollTop:main.scrollTop,scrollHeight:main.scrollHeight,clientHeight:main.clientHeight}})()`)
      assert(bottom.bottom <= bottom.mainBottom + 2 && bottom.bottom > bottom.mainTop, route + ': page bottom is reachable by actual scrolling at ' + width + 'x720: ' + JSON.stringify(bottom))
      if (bottom.scrollHeight > bottom.clientHeight + 2) assert(bottom.scrollTop > 0, route + ': overflowing page has a working main scroller')
      await noOverflow(route + ' laptop ' + width + 'x720')
      measurements.push({ label: route + ' laptop vertical ' + width, ...bottom })
    }
  }

  progress('real desktop and mobile navigation')
  await resize(1280); await go('/novels')
  await run('{const item=[...document.querySelectorAll(".app-layout-menu .ant-menu-item")].find(el=>el.textContent.trim()==="模型与搜索");if(!item)throw Error("Missing desktop model item");item.click()}')
  await wait('location.hash==="#/models" && !!document.querySelector(".model-manager-config-card")')
  await click('切换为深色主题')
  await wait('document.documentElement.dataset.theme==="dark"')
  assert.equal(await run('document.querySelector("[aria-label=切换为深色主题]").getAttribute("aria-pressed")'), 'true')
  await click('切换为浅色主题')
  await wait('document.documentElement.dataset.theme==="light"')
  await resize(480)
  await click('应用设置', 'document.querySelector(".app-layout__mobile-nav")'); await wait('location.hash==="#/settings"')
  await click('更多工具', 'document.querySelector(".app-layout__mobile-nav")')
  await wait('!!document.querySelector(".ant-dropdown:not(.ant-dropdown-hidden)")')
  await run('{const item=[...document.querySelectorAll(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item")].find(el=>el.textContent.trim()==="提示词管理");if(!item)throw Error("Missing mobile advanced item");item.click()}')
  await wait('location.hash==="#/prompts" && !!document.querySelector(".prompt-manager-inspector-body")')
  assert.equal(await run('document.querySelector(".app-layout__mobile-nav [aria-current=page]")?.textContent.trim()'), '提示词管理')

  progress('new novel dialog and recoverable list error')
  await go('/novels'); await click('新建小说'); await modalWidths('new-novel'); await closeModal()
  assert.equal(await run('window.fixture.calls.some(call=>call.kind==="novel.create")'), false, 'cancelling new novel never creates a record')
  await run('window.fixture.controls.novelListError=true'); await click('刷新作品')
  await wait('document.querySelector(".ant-alert-message")?.textContent==="隔离测试：作品读取失败"')
  await noOverflow('novel list failure 480')
  await run('window.fixture.controls.novelListError=false'); await click('重试')
  await wait('!document.querySelector(".ant-alert-error") && !!document.querySelector(".novel-list-page__grid")')

  progress('model, search and detector dialogs')
  await go('/models'); await click('编辑模型'); await modalWidths('model-editor')
  await click('拉取模型', 'window.ui.modal()'); await wait('document.querySelector("[data-model-discovery-count]")?.dataset.modelDiscoveryCount==="2"')
  await noOverflow('model discovery 480'); await closeModal()
  await click('联网搜索配置'); await modalWidths('source-search'); await closeModal()
  await click('配置朱雀检测'); await modalWidths('zhuque-settings'); await closeModal()

  progress('settings progressive disclosures and retrieval controls')
  await go('/settings')
  assert.equal(await run('document.querySelectorAll(".app-settings details[open]").length'), 0, 'manual diagnostics and export details start collapsed')
  await run('document.querySelector(".app-settings details summary").click()')
  await wait('!!document.querySelector(".app-settings details[open] #codex-cli-path")')
  for (const width of [1280, 900, 720, 480]) { await resize(width); await noOverflow('settings diagnostics ' + width) }
  const customPath = 'D:/Isolated Interface Fixture/Other Codex/codex.exe'
  await edit('#codex-cli-path', customPath)
  await wait('document.body.textContent.includes("路径已修改，等待检查")')
  assert.equal(await run('window.ui.button("复制命令").disabled'), true, 'stale manual command cannot be copied after editing the path')
  await click('检查连接'); await wait('document.body.textContent.includes("配置已登记，创作服务可用")')
  assert.equal(await run('window.fixture.calls.filter(call=>call.kind==="app.getCodexMcpSetupStatus").at(-1).input'), customPath)
  await select('向量检索方式', '独立远程向量接口'); await wait('!!document.querySelector("input[aria-label=向量模型名称]")')
  await noOverflow('remote retrieval controls 480')
  await select('向量接口', '隔离测试 · 创作模型'); await edit('[aria-label="向量模型名称"]', 'isolated-embedding-model')
  await click('保存检索配置'); await wait('document.querySelector(".app-settings [role=status]")?.textContent==="已保存"')
  assert.deepEqual(await run('window.fixture.calls.filter(call=>call.kind==="novelforge.retrieval.settings_set").at(-1).input'), { mode: 'remote', modelConfigId: 7, modelId: 'isolated-embedding-model' })
  await run('{const detail=[...document.querySelectorAll(".app-settings details")].find(el=>el.querySelector("summary")?.textContent==="导出正文");if(!detail)throw Error("Missing export disclosure");detail.querySelector("summary").click()}')
  await noOverflow('settings export disclosure 480')
  await click('选择作品'); await wait('location.hash==="#/novels" && !!document.querySelector(".novel-list-page__grid")')

  progress('template and prompt tools')
  await go('/templates')
  await click('查看内置模板 隔离文风模板'); await modalWidths('template-readonly')
  assert.equal(await run('[...window.ui.modal().querySelectorAll("input,textarea")].every(el=>el.disabled)'), true, 'built-in template fields remain read-only')
  await closeModal(); await click('新建模板'); await modalWidths('template-new'); await closeModal()
  await go('/prompts')
  await run('document.querySelector(".prompt-manager-inspector-disclosure summary").click()')
  await wait('document.querySelector(".prompt-manager-inspector-disclosure").open')
  await noOverflow('prompt parameter disclosure 480')
  await click('展开全文'); await modalWidths('prompt-fulltext'); await closeModal()
  await click('编辑', 'document.querySelector(".prompt-manager-inspector-actions")'); await modalWidths('prompt-edit'); await closeModal()
  assert.equal(await run('window.fixture.calls.some(call=>call.kind==="prompt.save"||call.kind==="template.create")'), false, 'cancelled administrative editors never save')

  progress('task popover: pending, duplicate prevention, failure, retry and completion')
  await run('window.fixture.emit("task:status-change",{taskId:81,status:"running"});window.fixture.emit("task:progress",{taskId:81,progress:{current:1,total:3,percent:33,stage:"review",label:"隔离界面评审"}})')
  await wait('document.querySelector(".task-indicator")?.getAttribute("aria-label")==="1 个任务进行中"')
  await click('1 个任务进行中'); await wait('!!document.querySelector(".task-indicator-panel__row")'); await pause(230)
  for (const width of [1280, 900, 720, 480]) { await resize(width); await noOverflow('task popover ' + width) }
  await click('取消任务', 'document.querySelector(".task-indicator-panel")'); await wait('window.fixture.cancellations.length===1 && !!document.querySelector(".task-indicator-panel__row-actions .ant-btn-loading")')
  await run('{const button=window.ui.button("取消任务",document.querySelector(".task-indicator-panel"));button.click();button.click()}')
  await pause(80)
  assert.equal(await run('window.fixture.calls.filter(call=>call.kind==="task.cancel").length'), 1, 'pending cancel has one service request')
  await run('window.fixture.cancellations[0].reject(new Error("隔离测试：暂时无法取消"))')
  await wait('!document.querySelector(".task-indicator-panel__row-actions .ant-btn-loading") && document.body.textContent.includes("隔离测试：暂时无法取消")')
  assert.equal(await run('document.querySelector(".task-indicator")?.getAttribute("aria-label")'), '1 个任务进行中', 'cancel failure keeps the running task visible')
  await click('取消任务', 'document.querySelector(".task-indicator-panel")'); await wait('window.fixture.cancellations.length===2')
  await run('window.fixture.cancellations[1].resolve()'); await wait('document.querySelector(".task-indicator")?.getAttribute("aria-label")==="任务面板" && document.querySelector(".task-indicator-panel").textContent.includes("当前没有进行中的任务")')
  await click('打开运行记录', 'document.querySelector(".task-indicator-panel")'); await wait('location.hash==="#/tasks" && !document.querySelector(".task-indicator-popover:not(.ant-popover-hidden)")')
  await noOverflow('task completion route 480')

  progress('window close protection modal')
  await click('关闭或最小化窗口'); await modalWidths('window-close'); await click('继续编辑', 'window.ui.modal()'); await wait('!window.ui.modal()')
  await run('window.fixture.requestClose(true)'); await wait('window.ui.modal()?.textContent.includes("先保存，再退出")')
  assert.equal(await run('!!window.ui.modal().querySelector(".close-window-dialog__choice--exit")'), false, 'unsaved-change modal never offers immediate exit')
  await noOverflow('window unsaved protection 480'); await click('继续编辑', 'window.ui.modal()'); await wait('!window.ui.modal()')
  await assertClean()
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ profile, measurements, warnings: [...new Set(rendererWarnings)], serviceCalls: await run('window.fixture.calls.map(call=>call.kind)'), unexpected: [], rendererErrors: [], networkRequests: [] }, null, 2))
  console.log('PASS global interface: production App / 6 global routes / 4 widths; desktop/mobile navigation; settings disclosures; administrative dialogs; isolated task cancel pending/failure/retry/completion. Screenshots: ' + output)
  win.destroy(); app.exit(0)
}

main().catch(async error => {
  console.error('[global-interface-ui] Failed during ' + phase + ':', error)
  console.error('[global-interface-ui] Last expression: ' + lastExpression)
  if (activeWindow && !activeWindow.isDestroyed()) {
    try {
      const diagnostic = await activeWindow.webContents.executeJavaScript('({hash:location.hash,text:document.body.textContent,unexpected:window.fixture?.unexpected,errors:window.fixture?.errors})')
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ phase, diagnostic, rendererErrors, networkRequests }, null, 2))
      fs.writeFileSync(path.join(output, 'failure.png'), (await activeWindow.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    } catch (diagnosticError) { console.error('[global-interface-ui] Failure diagnostics unavailable:', diagnosticError) }
  }
  app.exit(1)
})
