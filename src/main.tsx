import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { isElectronRuntime, markRuntimeEnvironment } from './runtime/environment'
import { installWebElectronBridge } from './runtime/web-electron-bridge'
import './styles/global.css'

markRuntimeEnvironment()

if (!isElectronRuntime()) {
  installWebElectronBridge()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
