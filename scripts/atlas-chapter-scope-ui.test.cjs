const assert=require('node:assert/strict');const fs=require('node:fs'), path=require('node:path')
const {app,BrowserWindow}=require('electron')
const {build}=require('esbuild')
const root=path.resolve(__dirname,'..'), dir=fs.mkdtempSync(path.join(root,'.tmp-tests','ui-chapter-scope-'))
app.setPath('userData',dir);app.disableHardwareAcceleration()
async function main(){
  await app.whenReady()
  const stubs={
    './shared':`import React from 'react'; export const AuthorPage=({children})=><main>{children}</main>;export const EmptyWork=()=>null;export const LoadFailure=()=>null;`,
    './AtlasEntityLibrary':`export const AtlasEntityLibrary=()=>null;`,
    './AtlasEntityProfile':`import React from 'react'; export const AtlasEntityProfile=({entity,onEdit})=><button id="edit-profile" onClick={onEdit}>{entity.summary}</button>;`,
    './AtlasEntityEditor':`export const AtlasEntityEditor=props=>{window.editorProps={entitySummary:props.entity.summary,snapshotChapter:props.snapshot.atChapter,editChapter:props.atChapter};return null};`,
    './AtlasRelationDetails':`export const AtlasRelationDetails=()=>null;`,
    './WorldAtlasGraph':`export const WorldAtlasGraph=()=>null;`,
    './GeographicAtlas':`export const GeographicAtlas=()=>null;`
  }
  await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,useNavigate}from'react-router-dom';import WorldAndCast from './src/pages/Novel/AuthorWorkspace/WorldAndCast';window.requests=[];window.electron={storyAtlas:{query:args=>new Promise((resolve,reject)=>window.requests.push({args,resolve,reject}))},chapter:{list:async()=>[]}};function Harness(){const navigate=useNavigate();window.changeChapter=num=>navigate('/novels/1/narrative-board?tab=characters&atChapter='+num+'&entity=character:1');return <WorldAndCast novelId={1}/>};createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/novels/1/narrative-board?tab=characters&atChapter=1&entity=character:1']}><Harness/></MemoryRouter>);`,loader:'tsx',resolveDir:root},outfile:path.join(dir,'fixture.js'),bundle:true,platform:'browser',plugins:[{name:'child-stubs',setup(build){build.onResolve({filter:/^\.\//},args=>stubs[args.path]&&args.importer.endsWith('WorldAndCast.tsx')?{path:args.path,namespace:'audit-stub'}:undefined);build.onLoad({filter:/.*/,namespace:'audit-stub'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:root}));}}]})
  fs.writeFileSync(path.join(dir,'index.html'),'<div id="root"></div><script src="fixture.js"></script>')
  const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:false,nodeIntegration:false,backgroundThrottling:false}})
  await win.loadFile(path.join(dir,'index.html'))
  const run=s=>win.webContents.executeJavaScript(s)
  const wait=async s=>{for(let i=0;i<100;i++){if(await run(s))return;await new Promise(r=>setTimeout(r,20))}throw Error('Timeout: '+s)}
  await wait('window.requests.length===1')
  await run(`window.requests[0].resolve({novelId:1,atChapter:1,contextVersion:9,entities:[{id:'character:1',kind:'character',name:'陆闻',summary:'第1章旧状态',attributes:{},status:'confirmed',effectiveFromChapter:1,source:{kind:'human'}}],relations:[],diagnostics:[]})`)
  await wait('!!document.querySelector("#edit-profile")')
  await run('window.changeChapter(2)')
  await wait('window.requests.length===2')

  assert.equal(await run('!!document.querySelector("#edit-profile")'),false,'old snapshot hidden synchronously during new chapter fetch')
  assert.equal(await run('!!window.editorProps'),false)
  await run(`window.requests[1].reject(new Error('fixture network failure'))`)
  await new Promise(r=>setTimeout(r,40))
  assert.equal(await run('!!document.querySelector("#edit-profile")'),false,'failed fetch does not restore editable old chapter')
  await run('window.changeChapter(3)')
  await wait('window.requests.length===3')
  await run(`window.requests[2].resolve({novelId:1,atChapter:3,contextVersion:10,entities:[{id:'character:1',kind:'character',name:'陆闻',summary:'第3章新状态',attributes:{},status:'confirmed',effectiveFromChapter:1,source:{kind:'human'}}],relations:[],diagnostics:[]})`)
  await wait('!!document.querySelector("#edit-profile")')
  await run('document.querySelector("#edit-profile").click()')
  await wait('!!window.editorProps')
  const props=await run('window.editorProps')
  assert.equal(props.snapshotChapter,3);assert.equal(props.editChapter,3);assert.equal(props.entitySummary,'第3章新状态')
  console.log('[chapter-scope-ui] pending and failed fetch cannot edit stale snapshot; fresh editor scope matches displayed chapter (real ReactDOM in hidden Electron)')
  win.destroy()
}
main().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)})
