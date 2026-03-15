import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#2E86AB',
          colorBgBase: '#0f1117',
          colorBgContainer: '#1e2235',
          colorBgElevated: '#1a1d27',
          colorBorder: 'rgba(255,255,255,0.1)',
          borderRadius: 10,
          fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif",
        },
        components: {
          Layout: {
            siderBg: '#1a1d27',
            headerBg: '#1a1d27',
            bodyBg: '#0f1117',
          },
          Menu: {
            darkItemBg: '#1a1d27',
            darkSubMenuItemBg: '#151823',
          },
          Card: {
            colorBgContainer: '#1e2235',
          },
          Modal: {
            contentBg: '#1a1d27',
            headerBg: '#1a1d27',
          },
          Input: {
            colorBgContainer: '#252840',
          },
          Select: {
            colorBgContainer: '#252840',
          },
          Table: {
            colorBgContainer: '#1e2235',
            headerBg: '#252840',
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
)
