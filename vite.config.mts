import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function splitVendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  if (/[\\/]node_modules[\\/](?:react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) {
    return 'vendor-react'
  }
  if (/[\\/]node_modules[\\/](?:reactflow|@reactflow)[\\/]/.test(id)) {
    return 'vendor-reactflow'
  }
  if (/[\\/]node_modules[\\/]@hello-pangea[\\/]dnd[\\/]/.test(id)) {
    return 'vendor-dnd'
  }
  if (/[\\/]node_modules[\\/]antd[\\/]/.test(id) || /[\\/]node_modules[\\/]@ant-design[\\/]/.test(id)) {
    return 'vendor-antd'
  }
  if (/[\\/]node_modules[\\/]dayjs[\\/]/.test(id)) {
    return 'vendor-dayjs'
  }
  return undefined
}

const backendTarget = `http://127.0.0.1:${process.env.NOVELFORGE_WEB_BACKEND_PORT || 8787}`

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: Number(process.env.NOVELFORGE_WEB_FRONTEND_PORT || 4175),
    strictPort: true,
    proxy: {
      '/rpc': { target: backendTarget, changeOrigin: true },
      '/health': { target: backendTarget, changeOrigin: true },
      '/events': { target: backendTarget, changeOrigin: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: splitVendorChunk,
      },
    },
  },
})
