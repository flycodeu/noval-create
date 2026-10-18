const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const temporaryRoot = path.join(root, '.tmp-tests')
fs.mkdirSync(temporaryRoot, { recursive: true })
const profile = fs.mkdtempSync(path.join(temporaryRoot, 'model-manager-ui-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const rendererErrors = []
const rendererWarnings = []
let activeWindow
let phase = 'setup'

async function main() {
  await app.whenReady()
  await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { ConfigProvider, message } from 'antd';
        import ModelManager from './src/pages/ModelManager';
        import { getAntdThemeConfig } from './src/theme/antd-tokens';
        import './src/styles/global.css';
        import './src/styles/ui-simplification.css';

        // The real production React component runs against deterministic services.
        // No main-process IPC or real NovelForge profile is loaded by this fixture.
        const clone = value => structuredClone(value);
        const masked = '已设置';
        window.calls = [];
        window.discovery = [];
        window.deferModelLists = false;
        window.modelLists = [];
        window.configs = [{ id: 7, name: '已保存的兼容模型', provider: 'custom',
          modelId: 'saved-model', apiKey: masked, baseUrl: 'https://saved.example.test/v1',
          temperature: 0.8, maxTokens: 65536, maxContextTokens: 32000,
          maxConcurrency: 2, isDefault: 1, extraParamsJson: null }];
        window.sourceSettings = { provider: 'auto', tavilyApiKeySet: false,
          braveApiKeySet: false, tavilyEnvSet: false, braveEnvSet: false,
          activeProvider: null, updatedAt: null };
        const record = (kind, input) => window.calls.push({ kind, input: clone(input) });
        window.electron = {
          model: {
            list: () => window.deferModelLists
              ? new Promise(resolve => window.modelLists.push({ resolve }))
              : Promise.resolve(clone(window.configs)),
            discover: input => new Promise((resolve, reject) => {
              record('model.discover', input);
              window.discovery.push({ input: clone(input), resolve, reject });
            }),
            create: async input => {
              record('model.create', input);
              const id = 100 + window.configs.length;
              window.configs.push({ ...clone(input), id, apiKey: input.apiKey ? masked : '', isDefault: 0 });
              return id;
            },
            update: async (id, input) => {
              record('model.update', { id, ...input });
              Object.assign(window.configs.find(row => row.id === id), clone(input), { apiKey: input.apiKey ? masked : '' });
            },
            delete: async id => { record('model.delete', { id }); window.configs = window.configs.filter(row => row.id !== id); },
            setDefault: async id => { for (const row of window.configs) row.isDefault = Number(row.id === id); },
            test: async id => { record('model.test', { id }); return { success: true, latency: 12, info: 'fixture model ready' }; },
          },
          sourceSearch: {
            getSettings: async () => clone(window.sourceSettings),
            updateSettings: async input => {
              record('sourceSearch.updateSettings', input);
              window.sourceSettings = { ...window.sourceSettings, provider: input.provider || 'auto',
                tavilyApiKeySet: Boolean(input.tavilyApiKey), braveApiKeySet: Boolean(input.braveApiKey),
                activeProvider: input.provider === 'disabled' ? null : input.provider === 'brave' ? 'brave' : input.tavilyApiKey ? 'tavily' : null,
                updatedAt: '2026-10-18T00:00:00.000Z' };
              return clone(window.sourceSettings);
            },
            test: async input => {
              record('sourceSearch.test', input);
              return { success: true, providerName: input?.provider === 'brave' ? 'brave' : 'tavily', latency: 18, info: '隔离配置测试成功' };
            },
          },
          zhuque: { getSettings: async () => ({ enabled: false, autoDetect: true, apiKeySet: false }) },
        };
        window.ui = {
          visible: el => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'),
          modal: () => [...document.querySelectorAll('.ant-modal')].find(el => window.ui.visible(el)),
          options: () => [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].filter(el => window.ui.visible(el)),
          button: (text, inModal = false) => [...(inModal ? window.ui.modal() : document).querySelectorAll('button')].find(el => window.ui.visible(el) && el.textContent.replace(/\\s+/g, '') === text.replace(/\\s+/g, '')),
        };
        window.clearMessages = () => message.destroy();
        const theme = getAntdThemeConfig('light');
        // Disable UI motion only in this hidden-window test fixture so capture
        // never records Ant Design's zoom-enter intermediate compositor frame.
        createRoot(document.getElementById('root')).render(
          <ConfigProvider theme={{ ...theme, token: { ...theme.token, motion: false } }}>
            <div className="app-layout" data-ui-system="quiet-workspace" style={{ height: '100vh', overflow: 'auto' }}>
              <main className="main-content"><ModelManager /></main>
            </div>
          </ConfigProvider>
        );
      `,
      loader: 'tsx',
      resolveDir: root,
    },
    alias: { '@': path.join(root, 'src') },
    outfile: path.join(profile, 'fixture.js'),
    bundle: true,
    platform: 'browser',
  })
  fs.writeFileSync(path.join(profile, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>')
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, useContentSize: true, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } })
  activeWindow = win
  win.webContents.on('console-message', (_, level, message) => {
    if (message.startsWith('Warning: [antd: message] Static function can not consume context')) rendererWarnings.push(message)
    else if (level >= 3 && !message.includes('Content-Security-Policy')) rendererErrors.push(message)
  })
  win.webContents.on('render-process-gone', (_, details) => rendererErrors.push('Renderer exited: ' + JSON.stringify(details)))
  const run = code => win.webContents.executeJavaScript(code)
  const wait = async code => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await run(`Boolean(${code})`)) return
      await pause(25)
    }
    throw Error('Timeout during ' + phase + ': ' + code)
  }
  const click = (text, inModal = false) => run(`{ const button = window.ui.button(${JSON.stringify(text)}, ${inModal}); if (!button) throw Error('Missing visible button: ' + ${JSON.stringify(text)}); button.click(); }`)
  const edit = (id, value) => run(`{ const scope = window.ui.modal() || document; const input = scope.querySelector(${JSON.stringify('#' + id)}); if (!input) throw Error('Missing input: ' + ${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); }`)
  const value = id => run(`(window.ui.modal() || document).querySelector(${JSON.stringify('#' + id)})?.value`)
  const openOptions = async id => {
    await run(`{ const scope = window.ui.modal() || document; const input = scope.querySelector(${JSON.stringify('#' + id)}); if (!input) throw Error('Missing select: ' + ${JSON.stringify(id)}); input.closest('.ant-select').querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); input.focus(); }`)
    await wait('window.ui.options().length > 0')
  }
  const choose = async (id, label) => {
    await openOptions(id)
    await wait(`window.ui.options().some(el => el.textContent.trim() === ${JSON.stringify(label)})`)
    await run(`window.ui.options().find(el => el.textContent.trim() === ${JSON.stringify(label)}).click()`)
    await pause(35)
  }
  const calls = kind => run(`window.calls.filter(call => call.kind === ${JSON.stringify(kind)}).map(call => call.input)`)
  const discover = async () => {
    const index = await run('window.discovery.length')
    await click('拉取模型', true)
    await wait(`window.discovery.length === ${index + 1}`)
    return index
  }
  const resolve = (index, models) => run(`window.discovery[${index}].resolve({ models: ${JSON.stringify(models)} })`)
  const modelOptionsContain = model => run(`window.ui.options().some(el => el.textContent.trim() === ${JSON.stringify(model)})`)
  const assertNoOption = async model => {
    await wait('Number(document.querySelector("[data-model-discovery-count]").dataset.modelDiscoveryCount) === 0')
    await run(`{ const input = window.ui.modal().querySelector('#modelId'); input.closest('.ant-select').querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); input.focus(); }`)
    await wait(`!window.ui.options().some(el => el.textContent.trim() === ${JSON.stringify(model)})`)
    assert.equal(await modelOptionsContain(model), false, 'stale candidate is not offered: ' + model)
  }
  const snapshot = async name => {
    await run('window.clearMessages()')
    const [width, height] = win.getContentSize()
    // Hidden windows can return a previous compositor frame. A tiny resize,
    // capture wake-up and two painted frames make screenshots match the DOM.
    win.setContentSize(width + 1, height)
    await pause(70)
    win.setContentSize(width, height)
    await pause(70)
    await win.webContents.capturePage(undefined, { stayHidden: true })
    win.webContents.invalidate()
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await pause(70)
    fs.writeFileSync(path.join(profile, name), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
  }
  const layouts = async prefix => {
    for (const width of [1280, 720]) {
      win.setContentSize(width, 1000)
      await pause(120)
      assert.equal(await run('document.documentElement.scrollWidth > innerWidth + 1'), false, `${prefix}: page overflows at ${width}`)
      assert.equal(await run('document.querySelector(".app-layout").scrollWidth > document.querySelector(".app-layout").clientWidth + 1'), false, `${prefix}: app scroller overflows at ${width}`)
      assert.equal(await run('!!window.ui.modal() && window.ui.modal().getBoundingClientRect().right > innerWidth + 1'), false, `${prefix}: modal overflows at ${width}`)
      assert.equal(await run('!!window.ui.modal() && window.ui.modal().querySelector(".ant-modal-content").scrollWidth > window.ui.modal().querySelector(".ant-modal-content").clientWidth + 1'), false, `${prefix}: modal content overflows at ${width}`)
      await snapshot(`${prefix}-${width}.png`)
    }
    win.setContentSize(1280, 1000)
    await pause(80)
  }

  await win.loadFile(path.join(profile, 'index.html'))
  phase = 'visible search entry and initial model list'
  await wait('document.querySelector("[data-model-config-card]") && window.ui.button("联网搜索配置") && !window.ui.button("联网搜索配置").disabled')
  assert.equal(await run('!!window.ui.button("配置搜索")'), true, 'search configuration is visible without expanding a disclosure')
  assert.equal(await run('window.ui.visible(document.querySelector(".model-manager-source-panel"))'), true)
  assert((await run('document.querySelector(".model-manager-source-panel").textContent')).includes('未配置'))
  await layouts('overview')

  phase = 'new model discovery, explicit selection and save'
  await click('新建配置')
  await wait('window.ui.modal()?.textContent.includes("新建模型配置")')
  await edit('name', '拉取后选择的模型')
  await edit('apiKey', 'sk-fixture-new')
  await edit('baseUrl', 'https://new.example.test/v1')
  await edit('modelId', 'manual-before-discovery')
  const initialDiscovery = await discover()
  const initialRequest = (await calls('model.discover'))[0]
  assert.equal(initialRequest.provider, 'openai')
  assert.equal(initialRequest.apiKey, 'sk-fixture-new')
  assert.equal(initialRequest.baseUrl, 'https://new.example.test/v1')
  assert.equal(initialRequest.configId, undefined)
  await resolve(initialDiscovery, ['remote-first', 'remote-selected'])
  await wait('window.ui.options().some(el => el.textContent.trim() === "remote-selected")')
  assert.equal(await value('modelId'), 'manual-before-discovery', 'discovery must not silently replace the selected model')
  await snapshot('model-discovery-options-1280.png')
  await run('window.ui.options().find(el => el.textContent.trim() === "remote-selected").click()')
  await wait('window.ui.modal().querySelector("#modelId").value === "remote-selected"')
  await layouts('model-picker')
  await click('保存', true)
  await wait('!window.ui.modal() && document.body.textContent.includes("拉取后选择的模型")')
  assert.equal((await calls('model.create'))[0].modelId, 'remote-selected')

  phase = 'slow post-save refresh locks editor transitions until the saved form is hydrated'
  await run('document.querySelector("[data-model-config-card]").click()')
  await click('编辑模型')
  await wait('window.ui.modal()?.textContent.includes("已保存的兼容模型")')
  await run('window.deferModelLists = true')
  await click('保存', true)
  await wait('window.modelLists.length === 1 && !window.ui.modal()')
  assert.equal(await run('window.ui.button("新建配置").disabled'), true, 'new editor stays disabled through post-save refresh')
  assert.equal(await run('window.ui.button("编辑模型").disabled'), true, 'edit action stays disabled through post-save refresh')
  assert.equal(await run('[...document.querySelectorAll("[data-model-config-card]")].every(el => el.getAttribute("aria-disabled") === "true" && el.tabIndex === -1)'), true)
  await click('新建配置')
  await run('{ const card = document.querySelectorAll("[data-model-config-card]")[1]; card.click(); card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }')
  assert.equal(await run('!!window.ui.modal()'), false, 'clicks cannot open a new session while saved-form hydration is pending')
  assert.equal(await run('document.querySelector("[data-model-config-card].admin-sidebar-item--active").textContent.includes("已保存的兼容模型")'), true, 'mouse and keyboard cannot replace the pending selection')
  await run('window.deferModelLists = false; window.modelLists[0].resolve(structuredClone(window.configs))')
  await wait('!window.ui.button("新建配置").disabled')
  await click('新建配置')
  await wait('window.ui.modal()?.textContent.includes("新建模型配置")')
  assert.equal(await value('name'), '', 'new session keeps its blank name after prior save refresh completes')
  assert.equal(await value('modelId'), 'gpt-4o', 'new session uses its own provider default, not the old saved model')
  assert.equal(await value('apiKey'), '', 'new session never receives the saved credential mask')
  await click('取消', true)
  await wait('!window.ui.modal()')

  phase = 'saved credentials remain masked for discovery'
  await run('document.querySelector("[data-model-config-card]").click()')
  await click('编辑模型')
  await wait('window.ui.modal()?.textContent.includes("已保存的兼容模型")')
  assert.equal(await value('apiKey'), '已设置')
  const savedDiscovery = await discover()
  const savedRequest = (await calls('model.discover')).at(-1)
  assert.equal(savedRequest.configId, 7)
  assert.equal(savedRequest.provider, 'custom')
  assert([undefined, '已设置'].includes(savedRequest.apiKey), 'only a mask or omitted key is sent with configId')
  await resolve(savedDiscovery, ['saved-choice', 'saved-choice-two'])
  await wait('window.ui.options().some(el => el.textContent.trim() === "saved-choice")')
  assert.equal(await value('modelId'), 'saved-model')

  phase = 'cleared saved key cannot test the old credentials'
  await edit('apiKey', '')
  await click('测试连接', true)
  await wait('document.querySelector(".ant-message")?.textContent.includes("请先保存配置")')
  assert.equal((await calls('model.test')).length, 0, 'clearing a saved key is a draft change, not permission to test the old key')
  await edit('apiKey', '已设置')
  const restoredDiscovery = await discover()
  await resolve(restoredDiscovery, ['saved-choice', 'saved-choice-two'])
  await wait('window.ui.options().some(el => el.textContent.trim() === "saved-choice")')

  phase = 'URL change clears old models and rejects late results'
  await edit('baseUrl', 'https://url-change.example.test/v1')
  assert.equal(await value('modelId'), 'saved-model')
  await assertNoOption('saved-choice')
  const urlRace = await discover()
  await edit('baseUrl', 'https://url-newer.example.test/v1')
  await resolve(urlRace, ['late-url-model'])
  await pause(80)
  await assertNoOption('late-url-model')

  phase = 'key change clears candidates and rejects late results'
  const keyList = await discover()
  await resolve(keyList, ['key-old-choice'])
  await wait('window.ui.options().some(el => el.textContent.trim() === "key-old-choice")')
  await edit('apiKey', 'sk-fixture-updated')
  await assertNoOption('key-old-choice')
  const keyRace = await discover()
  await edit('apiKey', 'sk-fixture-newer')
  await resolve(keyRace, ['late-key-model'])
  await pause(80)
  await assertNoOption('late-key-model')

  phase = 'provider change clears candidates and rejects late results'
  const providerList = await discover()
  await resolve(providerList, ['provider-old-choice'])
  await wait('window.ui.options().some(el => el.textContent.trim() === "provider-old-choice")')
  const providerRace = await discover()
  await choose('provider', 'OpenAI')
  await resolve(providerRace, ['late-provider-model'])
  await pause(80)
  await assertNoOption('provider-old-choice')
  await assertNoOption('late-provider-model')

  phase = 'failure preserves current model and manual fallback saves'
  await edit('apiKey', 'sk-fixture-manual')
  await edit('modelId', 'manual-kept-on-failure')
  const failedDiscovery = await discover()
  await run(`window.discovery[${failedDiscovery}].reject(new Error('隔离模型列表暂时不可用'))`)
  await wait('document.querySelector("[data-model-discovery-status]")?.textContent.includes("暂时不可用")')
  assert.equal(await value('modelId'), 'manual-kept-on-failure')
  await edit('modelId', 'manual-after-failure')
  await click('保存', true)
  await wait('!window.ui.modal()')
  assert.equal((await calls('model.update')).at(-1).modelId, 'manual-after-failure')

  phase = 'test unsaved search values without persisting'
  await click('联网搜索配置')
  await wait('window.ui.modal()?.textContent.includes("联网搜索配置")')
  await choose('sourceSearch_provider', 'Tavily')
  await edit('sourceSearch_tavilyApiKey', 'tvly-fixture-current')
  await edit('sourceSearch_braveApiKey', 'brave-fixture-current')
  await click('测试连接', true)
  await wait('window.calls.some(call => call.kind === "sourceSearch.test")')
  assert.deepEqual((await calls('sourceSearch.test')).at(-1), { provider: 'tavily', tavilyApiKey: 'tvly-fixture-current', braveApiKey: 'brave-fixture-current' })
  assert.equal((await calls('sourceSearch.updateSettings')).length, 0, 'testing draft search settings does not save keys')
  await wait('window.ui.modal().textContent.includes("隔离配置测试成功")')
  await layouts('search-config')
  await edit('sourceSearch_tavilyApiKey', 'tvly-fixture-edited-after-test')
  await wait('!window.ui.modal().textContent.includes("隔离配置测试成功")')
  assert.equal((await calls('sourceSearch.updateSettings')).length, 0, 'editing a tested draft still does not persist it')
  await click('取消', true)
  await wait('!window.ui.modal()')
  assert((await run('document.querySelector(".model-manager-source-panel").textContent')).includes('未配置'), 'cancel leaves saved key status unchanged')

  phase = 'save search settings and masked readback'
  await click('配置搜索')
  await wait('!!window.ui.modal()')
  assert.equal(await value('sourceSearch_tavilyApiKey'), '', 'cancelled draft is not rehydrated as a saved key')
  await choose('sourceSearch_provider', 'Tavily')
  await edit('sourceSearch_tavilyApiKey', 'tvly-fixture-saved')
  await edit('sourceSearch_braveApiKey', 'brave-fixture-saved')
  await click('保存', true)
  await wait('!window.ui.modal() && window.calls.some(call => call.kind === "sourceSearch.updateSettings")')
  assert.deepEqual((await calls('sourceSearch.updateSettings')).at(-1), { provider: 'tavily', tavilyApiKey: 'tvly-fixture-saved', braveApiKey: 'brave-fixture-saved' })
  assert((await run('document.querySelector(".model-manager-source-panel").textContent')).includes('已保存'))
  await click('配置搜索')
  await wait('!!window.ui.modal()')
  assert.equal(await value('sourceSearch_tavilyApiKey'), '已设置')
  assert.equal(await value('sourceSearch_braveApiKey'), '已设置')
  assert.equal(await run('document.body.textContent.includes("tvly-fixture-saved") || document.body.textContent.includes("brave-fixture-saved")'), false, 'saved secrets are not rendered as text')
  if (rendererErrors.length) console.error('Renderer errors:', JSON.stringify(rendererErrors, null, 2))
  assert.deepEqual(rendererErrors, [], 'no renderer errors')
  win.destroy()
  activeWindow = null
  console.log('PASS model manager UI: discovery/select/manual fallback, masked saved credentials, URL/key/provider invalidation and races, delayed post-save refresh session isolation, draft search testing, save/masked readback, 720/1280 layouts. Screenshots: ' + profile)
  if (rendererWarnings.length) console.log('Known antd static-message context warning recorded; no renderer errors.')
}

main().then(() => app.exit(0)).catch(async error => {
  console.error('FAIL model manager UI during ' + phase, error)
  if (activeWindow && !activeWindow.isDestroyed()) {
    try { fs.writeFileSync(path.join(profile, 'failure.png'), (await activeWindow.webContents.capturePage(undefined, { stayHidden: true })).toPNG()) } catch {}
  }
  console.error('Artifacts: ' + profile)
  app.exit(1)
})
